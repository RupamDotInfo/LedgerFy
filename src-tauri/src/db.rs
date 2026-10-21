//! SQLite connection management and the data-location policy.
//!
//! The database lives in the operating system's per-application *local* data
//! directory, resolved through Tauri's path API. Nothing depends on the
//! current working directory or on running the development server, so a
//! packaged build and a development build find their books in the same place
//! for the same application identifier.
//!
//! The connection is opened with foreign keys enforced, WAL journalling so a
//! reader is never blocked by a writer, a busy timeout so concurrent access
//! waits instead of failing, and full synchronisation because a financial
//! record must survive a power loss.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use rusqlite::Connection;
use tauri::Manager;

use crate::migrations;

pub const DATABASE_FILE: &str = "ledgerfy.sqlite3";

/// How long a statement waits for a competing writer before giving up.
const BUSY_TIMEOUT_MS: u32 = 5_000;

pub struct Database {
    connection: Mutex<Connection>,
    path: PathBuf,
}

impl Database {
    /// Open (or create) the database at `path` and bring the schema up to date.
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("The data folder could not be created: {error}"))?;
        }

        let connection = Connection::open(path).map_err(|error| {
            format!(
                "The workspace database at {} could not be opened: {error}. \
                 The existing file has been left untouched.",
                path.display()
            )
        })?;

        configure(&connection)?;

        let mut connection = connection;
        migrations::migrate(&mut connection)?;

        Ok(Self {
            connection: Mutex::new(connection),
            path: path.to_path_buf(),
        })
    }

    /// An in-memory database, used by tests.
    pub fn open_in_memory() -> Result<Self, String> {
        let connection = Connection::open_in_memory()
            .map_err(|error| format!("An in-memory database could not be created: {error}"))?;
        configure(&connection)?;
        let mut connection = connection;
        migrations::migrate(&mut connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
            path: PathBuf::from(":memory:"),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn lock(&self) -> MutexGuard<'_, Connection> {
        // A poisoned lock means a previous command panicked mid-write. The
        // database itself is still consistent because every write runs in a
        // transaction, so the guard is recovered rather than propagating the
        // panic to the next command.
        match self.connection.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }

    /// Run a closure inside a single transaction.
    pub fn transaction<T, F>(&self, work: F) -> Result<T, String>
    where
        F: FnOnce(&rusqlite::Transaction<'_>) -> Result<T, String>,
    {
        let mut connection = self.lock();
        let transaction = connection
            .transaction()
            .map_err(|error| format!("The transaction could not be started: {error}"))?;
        match work(&transaction) {
            Ok(value) => {
                transaction
                    .commit()
                    .map_err(|error| format!("The transaction could not be committed: {error}"))?;
                Ok(value)
            }
            Err(error) => {
                // Dropping the transaction rolls back every write it made.
                let _ = transaction.rollback();
                Err(error)
            }
        }
    }

    /// Close the current connection so the database file can be replaced.
    ///
    /// The write-ahead log and shared-memory files belong to the connection, so
    /// they are removed with it. Any failure leaves the connection closed and
    /// the caller is expected to reopen or report.
    pub fn close_connection(&self) -> Result<(), String> {
        let mut guard = self.lock();
        let placeholder = Connection::open_in_memory()
            .map_err(|error| format!("A placeholder connection could not be created: {error}"))?;
        let previous = std::mem::replace(&mut *guard, placeholder);
        drop(previous);
        Ok(())
    }

    /// Reopen the database at its own path.
    pub fn reopen(&self) -> Result<(), String> {
        let mut guard = self.lock();
        let connection = Connection::open(&self.path).map_err(|error| {
            format!(
                "The workspace database at {} could not be reopened: {error}",
                self.path.display()
            )
        })?;
        configure(&connection)?;
        *guard = connection;
        Ok(())
    }

    /// The path of the write-ahead log for this database, if one is open.
    pub fn wal_path(&self) -> PathBuf {
        wal_path_for(&self.path)
    }
}

/// The write-ahead log that belongs to a database file.
pub fn wal_path_for(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push("-wal");
    PathBuf::from(name)
}

/// The shared-memory index that belongs to a database file.
pub fn shm_path_for(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push("-shm");
    PathBuf::from(name)
}

/// Apply the connection settings the application depends on.
fn configure(connection: &Connection) -> Result<(), String> {
    connection
        .busy_timeout(std::time::Duration::from_millis(BUSY_TIMEOUT_MS as u64))
        .map_err(|error| format!("The busy timeout could not be set: {error}"))?;

    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|error| format!("Foreign key enforcement could not be enabled: {error}"))?;

    // WAL lets the UI read while a write is in flight. It is only valid on a
    // local filesystem, which is where the database is kept.
    connection
        .pragma_update(None, "journal_mode", "WAL")
        .map_err(|error| format!("Write-ahead logging could not be enabled: {error}"))?;

    // Full synchronisation: a committed financial record is flushed to disk.
    connection
        .pragma_update(None, "synchronous", "FULL")
        .map_err(|error| format!("The synchronisation level could not be set: {error}"))?;

    Ok(())
}

/// The directory the application keeps its data in.
///
/// Local (not roaming) application data: the books belong to this machine and
/// must not follow a user profile to another computer.
pub fn data_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map_err(|error| format!("The application data directory could not be resolved: {error}"))
}

/// The full path of the workspace database.
pub fn database_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(data_directory(app)?.join(DATABASE_FILE))
}

/// The application's workspace state.
///
/// The database may fail to open — an unreadable file, a lock held by another
/// process, a schema from a newer build. The failure is kept and reported
/// rather than being hidden behind a fallback to sample data.
pub struct Workspace {
    database: Mutex<Option<Database>>,
    error: Mutex<Option<String>>,
    path: PathBuf,
}

impl Workspace {
    /// Open the workspace, recording any failure instead of aborting startup.
    pub fn open(app: &tauri::AppHandle) -> Self {
        let path = match database_path(app) {
            Ok(path) => path,
            Err(error) => {
                return Self {
                    database: Mutex::new(None),
                    error: Mutex::new(Some(error)),
                    path: PathBuf::new(),
                }
            }
        };

        match Database::open(&path) {
            Ok(database) => Self {
                database: Mutex::new(Some(database)),
                error: Mutex::new(None),
                path,
            },
            Err(error) => Self {
                database: Mutex::new(None),
                error: Mutex::new(Some(error)),
                path,
            },
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// The recorded initialisation failure, if there was one.
    pub fn initialisation_error(&self) -> Option<String> {
        self.error
            .lock()
            .ok()
            .and_then(|error| error.clone())
    }

    /// Run `work` against the database, or report why it is unavailable.
    pub fn with_database<T, F>(&self, work: F) -> Result<T, String>
    where
        F: FnOnce(&Database) -> Result<T, String>,
    {
        let guard = match self.database.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        match guard.as_ref() {
            Some(database) => work(database),
            None => Err(self.initialisation_error().unwrap_or_else(|| {
                "The workspace database is not available.".to_string()
            })),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn foreign_keys_are_on_for_every_connection() {
        let database = Database::open_in_memory().unwrap();
        let connection = database.lock();
        let enabled: i64 = connection
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .unwrap();
        assert_eq!(enabled, 1);
    }

    #[test]
    fn a_transaction_rolls_back_on_error() {
        let database = Database::open_in_memory().unwrap();
        {
            let connection = database.lock();
            connection
                .execute(
                    "INSERT INTO companies (id, name, country, base_currency, fiscal_year_start, fiscal_year_end, created_at)
                     VALUES ('c1', 'Test', 'India', 'INR', '2026-04-01', '2027-03-31', 'now')",
                    [],
                )
                .unwrap();
        }

        let outcome: Result<(), String> = database.transaction(|transaction| {
            transaction
                .execute(
                    "INSERT INTO companies (id, name, country, base_currency, fiscal_year_start, fiscal_year_end, created_at)
                     VALUES ('c2', 'Rolled back', 'India', 'INR', '2026-04-01', '2027-03-31', 'now')",
                    [],
                )
                .map_err(|error| error.to_string())?;
            Err("deliberate failure".to_string())
        });

        assert!(outcome.is_err());
        let connection = database.lock();
        let count: i64 = connection
            .query_row("SELECT COUNT(*) FROM companies", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1, "the failed transaction must not have been committed");
    }

    #[test]
    fn a_committed_transaction_persists() {
        let database = Database::open_in_memory().unwrap();
        database
            .transaction(|transaction| {
                transaction
                    .execute(
                        "INSERT INTO companies (id, name, country, base_currency, fiscal_year_start, fiscal_year_end, created_at)
                         VALUES ('c1', 'Committed', 'India', 'INR', '2026-04-01', '2027-03-31', 'now')",
                        [],
                    )
                    .map_err(|error| error.to_string())?;
                Ok(())
            })
            .unwrap();

        let connection = database.lock();
        let name: String = connection
            .query_row("SELECT name FROM companies WHERE id = 'c1'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(name, "Committed");
    }
}
