//! Backup and restore of the local workspace database.
//!
//! A backup is created with SQLite's `VACUUM INTO`, which produces a
//! consistent single-file snapshot that includes everything held in the
//! write-ahead log. Copying the `.sqlite3` file on its own while the database
//! is open would not.
//!
//! Every snapshot is reopened and checked before it is reported as a backup.
//! A restore verifies the replacement first, keeps a copy of the current
//! database, and puts the current database back if the replacement fails.

use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use tauri::State;

use crate::db::{self, Database, Workspace};
use crate::entities::BackupInfo;
use crate::migrations;

const BACKUP_DIR: &str = "backups";
const BACKUP_EXTENSION: &str = "sqlite3";

fn backup_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = db::data_directory(app)?.join(BACKUP_DIR);
    fs::create_dir_all(&directory)
        .map_err(|error| format!("The backup folder could not be created: {error}"))?;
    Ok(directory)
}

/// Resolve a caller supplied name inside the backup folder.
fn resolve_in_directory(directory: &Path, name: &str) -> Result<PathBuf, String> {
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("That backup name is not valid.".to_string());
    }
    let candidate = directory.join(name);
    if !candidate.is_file() {
        return Err("That backup no longer exists.".to_string());
    }
    Ok(candidate)
}

/// Open a snapshot and confirm it is a usable database.
fn verify_snapshot(path: &Path) -> Result<(), String> {
    let connection = Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|error| format!("The backup could not be opened: {error}"))?;

    let integrity: String = connection
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|error| format!("The backup could not be checked: {error}"))?;
    if integrity != "ok" {
        return Err(format!("The backup failed its integrity check: {integrity}"));
    }

    let version: i64 = connection
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);
    if version == 0 {
        return Err("The backup does not contain a LedgerFy schema.".to_string());
    }
    if version > migrations::latest_version() {
        return Err(format!(
            "The backup uses schema version {version}, which this build does not understand."
        ));
    }
    Ok(())
}

/// Create a verified snapshot of the live database.
pub fn create_backup(
    app: &tauri::AppHandle,
    database: &Database,
    label: Option<String>,
) -> Result<BackupInfo, String> {
    let directory = backup_directory(app)?;
    let stamp = migrations::now_iso().replace([':', '-'], "");
    let clean_label = label
        .map(|value| {
            value
                .chars()
                .map(|character| {
                    if character.is_ascii_alphanumeric() || character == '-' {
                        character
                    } else {
                        '-'
                    }
                })
                .collect::<String>()
        })
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "workspace".to_string());
    let name = format!("ledgerfy-{clean_label}-{stamp}.{BACKUP_EXTENSION}");
    let target = directory.join(&name);

    {
        let connection = database.lock();
        // VACUUM INTO takes a read snapshot, so it is consistent even while
        // the write-ahead log holds uncommitted pages.
        connection
            .execute("VACUUM INTO ?1", rusqlite::params![target.to_string_lossy()])
            .map_err(|error| format!("The backup could not be created: {error}"))?;
    }

    let verified = verify_snapshot(&target).is_ok();
    if !verified {
        let _ = fs::remove_file(&target);
        return Err("The backup could not be verified and was not kept.".to_string());
    }

    let metadata = fs::metadata(&target).map_err(|error| error.to_string())?;
    Ok(BackupInfo {
        name,
        path: target.to_string_lossy().to_string(),
        size_bytes: metadata.len(),
        created_at: migrations::now_iso(),
        verified,
    })
}

#[tauri::command]
pub fn create_database_backup(
    app: tauri::AppHandle,
    workspace: State<'_, Workspace>,
    label: Option<String>,
) -> Result<BackupInfo, String> {
    let label = label.clone();
    workspace.with_database(|database| create_backup(&app, database, label.clone()))
}

pub fn list_backups(app: &tauri::AppHandle) -> Result<Vec<BackupInfo>, String> {
    let directory = backup_directory(app)?;
    let entries =
        fs::read_dir(&directory).map_err(|error| format!("The backup folder could not be read: {error}"))?;

    let mut backups = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some(BACKUP_EXTENSION) {
            continue;
        }
        let metadata = match fs::metadata(&path) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let created_at = metadata
            .modified()
            .ok()
            .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|value| crate::iso_from_epoch(value.as_secs()))
            .unwrap_or_default();

        backups.push(BackupInfo {
            name: path
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_default(),
            path: path.to_string_lossy().to_string(),
            size_bytes: metadata.len(),
            created_at,
            verified: verify_snapshot(&path).is_ok(),
        });
    }

    backups.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    Ok(backups)
}

#[tauri::command]
pub fn list_database_backups(app: tauri::AppHandle) -> Result<Vec<BackupInfo>, String> {
    list_backups(&app)
}

/// Restore the workspace from a backup.
///
/// The replacement is verified before anything is replaced, the current
/// database is kept as a safety copy, and the current database is put back if
/// the replacement cannot be opened.
#[tauri::command]
pub fn restore_database_backup(
    app: tauri::AppHandle,
    workspace: State<'_, Workspace>,
    name: String,
) -> Result<BackupInfo, String> {
    let directory = backup_directory(&app)?;
    let source = resolve_in_directory(&directory, &name)?;

    // Verify the replacement before the live database is touched.
    verify_snapshot(&source)?;

    let live_path = workspace.path().to_path_buf();
    let safety = directory.join(format!(
        "pre-restore-{}.{BACKUP_EXTENSION}",
        migrations::now_iso().replace([':', '-'], "")
    ));

    // Keep the current database so a failed restore can be undone.
    workspace.with_database(|database| {
        database.close_connection()?;
        if live_path.exists() {
            fs::copy(&live_path, &safety).map_err(|error| {
                format!("The current database could not be preserved: {error}")
            })?;
        }
        Ok(())
    })?;

    let restore = workspace.with_database(|database| {
        for sidecar in [
            db::wal_path_for(&live_path),
            db::shm_path_for(&live_path),
        ] {
            let _ = fs::remove_file(sidecar);
        }
        fs::copy(&source, &live_path)
            .map_err(|error| format!("The backup could not be put in place: {error}"))?;
        database.reopen()?;
        Ok(())
    });

    if let Err(error) = restore {
        // Put the original database back.
        if safety.exists() {
            let _ = fs::copy(&safety, &live_path);
            let _ = workspace.with_database(|database| database.reopen());
        }
        return Err(format!(
            "The restore did not complete and the previous database was kept. {error}"
        ));
    }

    let metadata = fs::metadata(&live_path).map_err(|error| error.to_string())?;
    Ok(BackupInfo {
        name,
        path: live_path.to_string_lossy().to_string(),
        size_bytes: metadata.len(),
        created_at: migrations::now_iso(),
        verified: true,
    })
}

#[tauri::command]
pub fn delete_database_backup(
    app: tauri::AppHandle,
    name: String,
) -> Result<(), String> {
    let directory = backup_directory(&app)?;
    let path = resolve_in_directory(&directory, &name)?;
    fs::remove_file(&path).map_err(|error| format!("The backup could not be deleted: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entities::Company;

    fn temp_directory(name: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!("ledgerfy-backup-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).unwrap();
        directory
    }

    fn sample_company() -> Company {
        Company {
            id: "c1".into(),
            name: "Backup Test".into(),
            legal_name: None,
            country: "India".into(),
            state: Some("Gujarat".into()),
            base_currency: "INR".into(),
            fiscal_year_start: "2026-04-01".into(),
            fiscal_year_end: "2027-03-31".into(),
            gstin: None,
            pan: None,
            address: None,
            phone: None,
            email: None,
            industry: None,
            is_demo: false,
            created_at: "2026-04-01T00:00:00.000Z".into(),
        }
    }

    #[test]
    fn a_snapshot_can_be_created_and_reopened() {
        let directory = temp_directory("snapshot");
        let live = directory.join("ledgerfy.sqlite3");
        let database = Database::open(&live).unwrap();

        {
            let connection = database.lock();
            connection
                .execute(
                    "INSERT INTO companies (id, name, country, base_currency, fiscal_year_start,
                        fiscal_year_end, created_at)
                     VALUES ('c1', 'Backup Test', 'India', 'INR', '2026-04-01', '2027-03-31', 'now')",
                    [],
                )
                .unwrap();
        }

        let snapshot = directory.join("snapshot.sqlite3");
        {
            let connection = database.lock();
            connection
                .execute("VACUUM INTO ?1", rusqlite::params![snapshot.to_string_lossy()])
                .unwrap();
        }

        verify_snapshot(&snapshot).expect("the snapshot must verify");

        let reopened = Connection::open(&snapshot).unwrap();
        let count: i64 = reopened
            .query_row("SELECT COUNT(*) FROM companies", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);

        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn a_corrupted_snapshot_is_rejected() {
        let directory = temp_directory("corrupt");
        let broken = directory.join("broken.sqlite3");
        fs::write(&broken, b"this is not a database").unwrap();
        assert!(verify_snapshot(&broken).is_err());
        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn a_snapshot_without_the_ledgerfy_schema_is_rejected() {
        let directory = temp_directory("foreign");
        let foreign = directory.join("foreign.sqlite3");
        {
            let connection = Connection::open(&foreign).unwrap();
            connection.execute_batch("CREATE TABLE unrelated (id TEXT);").unwrap();
        }
        assert!(verify_snapshot(&foreign).is_err());
        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn a_traversal_name_is_refused() {
        let directory = temp_directory("traversal");
        assert!(resolve_in_directory(&directory, "../outside.sqlite3").is_err());
        assert!(resolve_in_directory(&directory, "sub/inside.sqlite3").is_err());
        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn a_missing_backup_is_reported() {
        let directory = temp_directory("missing");
        assert!(resolve_in_directory(&directory, "nothing.sqlite3").is_err());
        let _ = fs::remove_dir_all(&directory);
    }
}
