//! LedgerFy desktop shell.
//!
//! The shell owns native capability only: where the workspace lives on disk,
//! the local SQLite database behind it, and how backups are created, verified
//! and restored. It deliberately holds no accounting rules — those live in the
//! domain layer of the frontend and are never re-implemented here.

pub mod backup;
pub mod commands;
pub mod db;
pub mod entities;
pub mod migrations;

use serde::Serialize;
use tauri::{Manager, State};

use db::Workspace;

/// Where the application keeps its data.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataLocation {
    pub root: String,
    pub backup_dir: String,
    pub platform: String,
    /// The local workspace database.
    pub database_path: String,
    /// The schema version currently applied to that database.
    pub schema_version: i64,
    /// Set when the database could not be opened.
    pub error: Option<String>,
}

#[tauri::command]
fn data_location(app: tauri::AppHandle, workspace: State<'_, Workspace>) -> DataLocation {
    let root = db::data_directory(&app).unwrap_or_default();
    let backup_dir = root.join("backups");
    let schema_version = workspace
        .with_database(|database| {
            let connection = database.lock();
            Ok(migrations::current_version(&connection).unwrap_or(0))
        })
        .unwrap_or(0);

    DataLocation {
        root: root.to_string_lossy().to_string(),
        backup_dir: backup_dir.to_string_lossy().to_string(),
        platform: std::env::consts::OS.to_string(),
        database_path: workspace.path().to_string_lossy().to_string(),
        schema_version,
        error: workspace.initialisation_error(),
    }
}

#[tauri::command]
fn runtime_info(app: tauri::AppHandle, workspace: State<'_, Workspace>) -> serde_json::Value {
    let version = app.package_info().version.to_string();
    serde_json::json!({
        "version": version,
        "startedAt": iso_from_epoch(started_at()),
        "offline": true,
        "databaseAvailable": workspace.initialisation_error().is_none(),
        "databaseError": workspace.initialisation_error(),
    })
}

/// Open a native save dialog and write the payload to the chosen file.
#[tauri::command]
fn export_to_file(
    app: tauri::AppHandle,
    suggested_name: String,
    payload: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let selected = app
        .dialog()
        .file()
        .set_file_name(&suggested_name)
        .add_filter("LedgerFy export", &["json", "csv", "xml"])
        .blocking_save_file();

    let Some(selected) = selected else {
        return Ok(None);
    };

    let path = selected
        .into_path()
        .map_err(|error| format!("The chosen location could not be resolved: {error}"))?;

    std::fs::write(&path, payload.as_bytes())
        .map_err(|error| format!("The file could not be written: {error}"))?;
    Ok(Some(path.to_string_lossy().to_string()))
}

/// Open a native open dialog and read the chosen file.
#[tauri::command]
fn import_from_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let selected = app
        .dialog()
        .file()
        .add_filter("LedgerFy import", &["json", "csv", "xml"])
        .blocking_pick_file();

    let Some(selected) = selected else {
        return Ok(None);
    };

    let path = selected
        .into_path()
        .map_err(|error| format!("The chosen location could not be resolved: {error}"))?;

    let contents = std::fs::read_to_string(&path)
        .map_err(|error| format!("The file could not be read: {error}"))?;
    Ok(Some(contents))
}

fn started_at() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0)
}

/// Days since the Unix epoch to a calendar date and time.
pub fn iso_from_epoch(seconds: u64) -> String {
    let days = (seconds / 86_400) as i64;
    let rem = (seconds % 86_400) as i64;
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year,
        m,
        d,
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let workspace = Workspace::open(app.handle());

            // The window is created here rather than in the configuration file
            // so an automated check can place it off-screen and reach the
            // webview, without changing how the application behaves for
            // anyone else.
            let mut builder = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::default(),
            )
            .title("LedgerFy")
            .inner_size(1440.0, 900.0)
            .min_inner_size(1024.0, 640.0)
            .resizable(true)
            .center()
            .theme(Some(tauri::Theme::Light))
            .background_color(tauri::window::Color(0xf9, 0xf9, 0xff, 0xff));

            if std::env::var("LEDGERFY_OFFSCREEN").is_ok() {
                builder = builder.position(-32_000.0, -32_000.0).inner_size(1440.0, 900.0);
            }
            if let Ok(port) = std::env::var("LEDGERFY_DEBUG_PORT") {
                builder = builder.additional_browser_args(&format!(
                    "--remote-debugging-port={port}"
                ));
            }
            builder.build()?;

            app.manage(workspace);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            data_location,
            runtime_info,
            export_to_file,
            import_from_file,
            // Database status
            commands::db_status,
            // Companies and periods
            commands::list_companies_cmd,
            commands::get_company_cmd,
            commands::insert_company_cmd,
            commands::delete_company_cmd,
            commands::list_financial_years_cmd,
            commands::insert_financial_year_cmd,
            // Masters
            commands::list_ledgers_cmd,
            commands::save_ledger_cmd,
            commands::delete_ledger_cmd,
            commands::list_items_cmd,
            commands::save_item_cmd,
            commands::list_tax_categories_cmd,
            commands::save_tax_category_cmd,
            commands::list_stock_groups_cmd,
            commands::save_stock_group_cmd,
            commands::list_units_cmd,
            commands::save_unit_cmd,
            commands::list_godowns_cmd,
            commands::save_godown_cmd,
            commands::list_cost_centres_cmd,
            commands::save_cost_centre_cmd,
            commands::list_employees_cmd,
            commands::save_employee_cmd,
            commands::list_currencies_cmd,
            commands::save_currency_cmd,
            commands::list_price_lists_cmd,
            commands::save_price_list_cmd,
            commands::list_price_list_entries_cmd,
            commands::save_price_list_entries_cmd,
            commands::list_payment_terms_cmd,
            commands::save_payment_term_cmd,
            commands::deactivate_ledger_cmd,
            // Vouchers
            commands::list_vouchers_cmd,
            commands::get_voucher_cmd,
            commands::save_voucher_cmd,
            commands::post_voucher_cmd,
            commands::cancel_voucher_cmd,
            commands::delete_voucher_cmd,
            commands::next_voucher_number_cmd,
            // Allocations and advances
            commands::list_allocations_cmd,
            commands::list_advances_cmd,
            // Company profile and numbering
            commands::update_company_cmd,
            commands::get_voucher_numbering_cmd,
            commands::save_voucher_numbering_cmd,
            // Records
            commands::list_stock_movements_cmd,
            commands::next_order_number_cmd,
            commands::list_statement_lines_cmd,
            commands::reconcile_statement_line_cmd,
            commands::list_audit_events_cmd,
            // Inventory
            commands::get_inventory_accounts_cmd,
            commands::save_inventory_accounts_cmd,
            commands::create_opening_stock_cmd,
            commands::list_stock_pools_cmd,
            commands::list_stock_balances_cmd,
            commands::rebuild_stock_balances_cmd,
            // Orders
            commands::save_order_cmd,
            commands::list_orders_cmd,
            commands::get_order_cmd,
            commands::confirm_order_cmd,
            commands::cancel_order_cmd,
            commands::amend_order_cmd,
            // Bills of materials
            commands::list_boms_cmd,
            commands::save_bom_cmd,
            commands::release_bom_cmd,
            // Production
            commands::list_production_orders_cmd,
            commands::get_production_order_cmd,
            commands::save_production_order_cmd,
            commands::release_production_order_cmd,
            // Seeding and backup
            commands::seed_workspace,
            backup::create_database_backup,
            backup::list_database_backups,
            backup::restore_database_backup,
            backup::delete_database_backup,
        ])
        .run(tauri::generate_context!())
        .expect("LedgerFy failed to start");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_from_epoch_formats_utc() {
        assert_eq!(iso_from_epoch(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso_from_epoch(1_700_000_000), "2023-11-14T22:13:20Z");
    }
}
