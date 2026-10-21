//! Tauri commands for the local workspace database.
//!
//! Every write that belongs to one business operation runs inside a single
//! transaction, so a voucher header, its entries, its item and tax lines and
//! its audit event either all commit or all roll back together.
//!
//! No accounting rule lives here. The TypeScript domain computes the entries,
//! the tax split and the allocation; this layer stores and retrieves them.

use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
use tauri::State;

use crate::db::{Database, Workspace};
use crate::entities::*;
use crate::migrations;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

fn db_error(context: &str, error: impl std::fmt::Display) -> String {
    format!("{context}: {error}")
}

fn bool_from_int(value: i64) -> bool {
    value != 0
}

fn int_from_bool(value: bool) -> i64 {
    if value { 1 } else { 0 }
}

/// A unique identifier for an audit event.
///
/// The same voucher can be saved many times, so the identifier cannot be
/// derived from the record alone.
fn unique_id(prefix: &str) -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);

    let counter = COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or(0);
    format!("{prefix}-{nanos:x}-{counter:x}")
}

/// Reject a write that would put a record in a company it does not belong to.
fn ensure_company(connection: &Connection, company_id: &str) -> Result<(), String> {
    let exists: Option<i64> = connection
        .query_row(
            "SELECT 1 FROM companies WHERE id = ?1",
            params![company_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| db_error("The company could not be verified", error))?;
    if exists.is_none() {
        return Err(format!("Company {company_id} does not exist."));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Database status
// ---------------------------------------------------------------------------

pub fn database_status(database: &Database) -> Result<DatabaseStatus, String> {
    let connection = database.lock();
    let schema_version = crate::migrations::current_version(&connection).unwrap_or(0);
    let company_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM companies", [], |row| row.get(0))
        .map_err(|error| db_error("The workspace could not be inspected", error))?;
    Ok(DatabaseStatus {
        path: database.path().to_string_lossy().to_string(),
        initialized: true,
        schema_version,
        company_count,
        error: None,
    })
}

#[tauri::command]
pub fn db_status(workspace: State<'_, Workspace>) -> Result<DatabaseStatus, String> {
    workspace.with_database(database_status)
}

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

fn company_from_row(row: &Row<'_>) -> rusqlite::Result<Company> {
    Ok(Company {
        id: row.get(0)?,
        name: row.get(1)?,
        legal_name: row.get(2)?,
        country: row.get(3)?,
        state: row.get(4)?,
        base_currency: row.get(5)?,
        fiscal_year_start: row.get(6)?,
        fiscal_year_end: row.get(7)?,
        gstin: row.get(8)?,
        pan: row.get(9)?,
        address: row.get(10)?,
        phone: row.get(11)?,
        email: row.get(12)?,
        industry: row.get(13)?,
        is_demo: bool_from_int(row.get(14)?),
        created_at: row.get(15)?,
    })
}

const COMPANY_COLUMNS: &str = "id, name, legal_name, country, state, base_currency, \
     fiscal_year_start, fiscal_year_end, gstin, pan, address, phone, email, industry, is_demo, created_at";

pub fn list_companies(database: &Database) -> Result<Vec<Company>, String> {
    let connection = database.lock();
    let mut statement = connection
        .prepare(&format!("SELECT {COMPANY_COLUMNS} FROM companies ORDER BY name"))
        .map_err(|error| db_error("The company list could not be read", error))?;
    let rows = statement
        .query_map([], company_from_row)
        .map_err(|error| db_error("The company list could not be read", error))?;
    let mut companies = Vec::new();
    for company in rows {
        companies.push(company.map_err(|error| db_error("A company record is unreadable", error))?);
    }
    Ok(companies)
}

#[tauri::command]
pub fn list_companies_cmd(workspace: State<'_, Workspace>) -> Result<Vec<Company>, String> {
    workspace.with_database(list_companies)
}

pub fn get_company(database: &Database, id: &str) -> Result<Option<Company>, String> {
    let connection = database.lock();
    connection
        .query_row(
            &format!("SELECT {COMPANY_COLUMNS} FROM companies WHERE id = ?1"),
            params![id],
            company_from_row,
        )
        .optional()
        .map_err(|error| db_error("The company could not be read", error))
}

#[tauri::command]
pub fn get_company_cmd(
    workspace: State<'_, Workspace>,
    id: String,
) -> Result<Option<Company>, String> {
    workspace.with_database(|db| get_company(db, &id))
}

pub fn insert_company(database: &Database, company: Company) -> Result<Company, String> {
    database.transaction(|transaction| {
    transaction
        .execute(
            "INSERT INTO companies (id, name, legal_name, country, state, base_currency,
                fiscal_year_start, fiscal_year_end, gstin, pan, address, phone, email,
                industry, is_demo, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
            params![
                company.id,
                company.name,
                company.legal_name,
                company.country,
                company.state,
                company.base_currency,
                company.fiscal_year_start,
                company.fiscal_year_end,
                company.gstin,
                company.pan,
                company.address,
                company.phone,
                company.email,
                company.industry,
                int_from_bool(company.is_demo),
                company.created_at,
            ],
        )
        .map_err(|error| db_error("The company could not be saved", error))?;
    Ok(company)

    })
}

#[tauri::command]
pub fn insert_company_cmd(
    workspace: State<'_, Workspace>,
    company: Company,
) -> Result<Company, String> {
    workspace.with_database(|db| insert_company(db, company))
}

#[tauri::command]
pub fn delete_company_cmd(workspace: State<'_, Workspace>, id: String) -> Result<(), String> {
    workspace.with_database(|database| {
        database.transaction(|transaction| {
        transaction
            .execute("DELETE FROM companies WHERE id = ?1", params![id])
            .map_err(|error| db_error("The company could not be removed", error))?;
        Ok(())

        })
    })
}

// ---------------------------------------------------------------------------
// Financial years
// ---------------------------------------------------------------------------

fn financial_year_from_row(row: &Row<'_>) -> rusqlite::Result<FinancialYear> {
    Ok(FinancialYear {
        id: row.get(0)?,
        company_id: row.get(1)?,
        label: row.get(2)?,
        start: row.get(3)?,
        end: row.get(4)?,
        is_closed: bool_from_int(row.get(5)?),
    })
}

pub fn list_financial_years(
    database: &Database,
    company_id: &str,
) -> Result<Vec<FinancialYear>, String> {
    let connection = database.lock();
    let mut statement = connection
        .prepare(
            "SELECT id, company_id, label, start_date, end_date, is_closed
             FROM financial_years WHERE company_id = ?1 ORDER BY start_date",
        )
        .map_err(|error| db_error("The financial years could not be read", error))?;
    let rows = statement
        .query_map(params![company_id], financial_year_from_row)
        .map_err(|error| db_error("The financial years could not be read", error))?;
    let mut years = Vec::new();
    for year in rows {
        years.push(year.map_err(|error| db_error("A financial year is unreadable", error))?);
    }
    Ok(years)
}

#[tauri::command]
pub fn list_financial_years_cmd(
    workspace: State<'_, Workspace>,
    company_id: String,
) -> Result<Vec<FinancialYear>, String> {
    workspace.with_database(|db| list_financial_years(db, &company_id))
}

#[tauri::command]
pub fn insert_financial_year_cmd(
    workspace: State<'_, Workspace>,
    year: FinancialYear,
) -> Result<FinancialYear, String> {
    workspace.with_database(|database| {
        database.transaction(|transaction| {
        transaction
            .execute(
                "INSERT INTO financial_years (id, company_id, label, start_date, end_date, is_closed)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    year.id,
                    year.company_id,
                    year.label,
                    year.start,
                    year.end,
                    int_from_bool(year.is_closed)
                ],
            )
            .map_err(|error| db_error("The financial year could not be saved", error))?;
        Ok(year)

        })
    })
}

// ---------------------------------------------------------------------------
// Ledgers
// ---------------------------------------------------------------------------

fn ledger_from_row(row: &Row<'_>) -> rusqlite::Result<Ledger> {
    Ok(Ledger {
        id: row.get(0)?,
        company_id: row.get(1)?,
        name: row.get(2)?,
        group_name: row.get(3)?,
        kind: row.get(4)?,
        parent_id: row.get(5)?,
        opening_balance: row.get(6)?,
        opening_date: row.get(7)?,
        party_kind: row.get(8)?,
        currency: row.get(9)?,
        tax_number: row.get(10)?,
        email: row.get(11)?,
        phone: row.get(12)?,
        address: row.get(13)?,
        is_system: bool_from_int(row.get(14)?),
        is_active: bool_from_int(row.get(15)?),
        created_at: row.get(16)?,
    })
}

const LEDGER_COLUMNS: &str = "id, company_id, name, group_name, kind, parent_id, opening_balance, \
     opening_date, party_kind, currency, tax_number, email, phone, address, is_system, is_active, created_at";

pub fn list_ledgers(database: &Database, company_id: &str) -> Result<Vec<Ledger>, String> {
    let connection = database.lock();
    let mut statement = connection
        .prepare(&format!(
            "SELECT {LEDGER_COLUMNS} FROM ledgers WHERE company_id = ?1 ORDER BY name"
        ))
        .map_err(|error| db_error("The ledgers could not be read", error))?;
    let rows = statement
        .query_map(params![company_id], ledger_from_row)
        .map_err(|error| db_error("The ledgers could not be read", error))?;
    let mut ledgers = Vec::new();
    for ledger in rows {
        ledgers.push(ledger.map_err(|error| db_error("A ledger is unreadable", error))?);
    }
    Ok(ledgers)
}

#[tauri::command]
pub fn list_ledgers_cmd(
    workspace: State<'_, Workspace>,
    company_id: String,
) -> Result<Vec<Ledger>, String> {
    workspace.with_database(|db| list_ledgers(db, &company_id))
}

pub fn save_ledger(database: &Database, ledger: Ledger) -> Result<Ledger, String> {
    check_money(ledger.opening_balance, "Opening balance")?;
    database.transaction(|transaction| {
    ensure_company(transaction, &ledger.company_id)?;
    transaction
        .execute(
            "INSERT INTO ledgers (id, company_id, name, group_name, kind, parent_id,
                opening_balance, opening_date, party_kind, currency, tax_number, email,
                phone, address, is_system, is_active, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                group_name = excluded.group_name,
                kind = excluded.kind,
                parent_id = excluded.parent_id,
                opening_balance = excluded.opening_balance,
                opening_date = excluded.opening_date,
                party_kind = excluded.party_kind,
                currency = excluded.currency,
                tax_number = excluded.tax_number,
                email = excluded.email,
                phone = excluded.phone,
                address = excluded.address,
                is_system = excluded.is_system,
                is_active = excluded.is_active",
            params![
                ledger.id,
                ledger.company_id,
                ledger.name,
                ledger.group_name,
                ledger.kind,
                ledger.parent_id,
                ledger.opening_balance,
                ledger.opening_date,
                ledger.party_kind,
                ledger.currency,
                ledger.tax_number,
                ledger.email,
                ledger.phone,
                ledger.address,
                int_from_bool(ledger.is_system),
                int_from_bool(ledger.is_active),
                ledger.created_at,
            ],
        )
        .map_err(|error| db_error("The ledger could not be saved", error))?;
    Ok(ledger)

    })
}

#[tauri::command]
pub fn save_ledger_cmd(workspace: State<'_, Workspace>, ledger: Ledger) -> Result<Ledger, String> {
    workspace.with_database(|db| save_ledger(db, ledger))
}

#[tauri::command]
pub fn delete_ledger_cmd(
    workspace: State<'_, Workspace>,
    company_id: String,
    id: String,
) -> Result<(), String> {
    workspace.with_database(|database| {
        database.transaction(|transaction| {
        let used: i64 = transaction
            .query_row(
                "SELECT COUNT(*) FROM voucher_entries WHERE ledger_id = ?1 AND company_id = ?2",
                params![id, company_id],
                |row| row.get(0),
            )
            .map_err(|error| db_error("The ledger could not be checked", error))?;
        if used > 0 {
            return Err(
                "This ledger is used by posted vouchers. Deactivate it instead of deleting it."
                    .to_string(),
            );
        }
        transaction
            .execute(
                "DELETE FROM ledgers WHERE id = ?1 AND company_id = ?2",
                params![id, company_id],
            )
            .map_err(|error| db_error("The ledger could not be removed", error))?;
        Ok(())

        })
    })
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

fn item_from_row(row: &Row<'_>) -> rusqlite::Result<Item> {
    Ok(Item {
        id: row.get(0)?,
        company_id: row.get(1)?,
        name: row.get(2)?,
        stock_group_id: row.get(3)?,
        unit_id: row.get(4)?,
        is_inventory: bool_from_int(row.get(5)?),
        is_service: bool_from_int(row.get(6)?),
        purchase_price: row.get(7)?,
        sales_price: row.get(8)?,
        hsn: row.get(9)?,
        tax_category_id: row.get(10)?,
        opening_quantity_milli: row.get(11)?,
        opening_value: row.get(12)?,
        reorder_level_milli: row.get(13)?,
        is_active: bool_from_int(row.get(14)?),
        created_at: row.get(15)?,
    })
}

const ITEM_COLUMNS: &str = "id, company_id, name, stock_group_id, unit_id, is_inventory, \
     is_service, purchase_price, sales_price, hsn, tax_category_id, \
     COALESCE(opening_quantity_milli, CAST(ROUND(opening_quantity * 1000) AS INTEGER), 0), \
     opening_value, \
     COALESCE(reorder_level_milli, CAST(ROUND(reorder_level * 1000) AS INTEGER), 0), \
     is_active, created_at";

pub fn list_items(database: &Database, company_id: &str) -> Result<Vec<Item>, String> {
    let connection = database.lock();
    let mut statement = connection
        .prepare(&format!(
            "SELECT {ITEM_COLUMNS} FROM items WHERE company_id = ?1 ORDER BY name"
        ))
        .map_err(|error| db_error("The items could not be read", error))?;
    let rows = statement
        .query_map(params![company_id], item_from_row)
        .map_err(|error| db_error("The items could not be read", error))?;
    let mut items = Vec::new();
    for item in rows {
        items.push(item.map_err(|error| db_error("An item is unreadable", error))?);
    }
    Ok(items)
}

#[tauri::command]
pub fn list_items_cmd(workspace: State<'_, Workspace>, company_id: String) -> Result<Vec<Item>, String> {
    workspace.with_database(|db| list_items(db, &company_id))
}

pub fn save_item(database: &Database, item: Item) -> Result<Item, String> {
    check_money(item.purchase_price, "Purchase price")?;
    check_money(item.sales_price, "Sales price")?;
    check_money(item.opening_value, "Opening value")?;
    database.transaction(|transaction| {
    ensure_company(transaction, &item.company_id)?;
    transaction
        .execute(
            "INSERT INTO items (id, company_id, name, stock_group_id, unit_id, is_inventory,
                is_service, purchase_price, sales_price, hsn, tax_category_id,
                opening_quantity, opening_value, reorder_level, is_active, created_at,
                opening_quantity_milli, reorder_level_milli)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16,
                ?17, ?18)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                stock_group_id = excluded.stock_group_id,
                unit_id = excluded.unit_id,
                is_inventory = excluded.is_inventory,
                is_service = excluded.is_service,
                purchase_price = excluded.purchase_price,
                sales_price = excluded.sales_price,
                hsn = excluded.hsn,
                tax_category_id = excluded.tax_category_id,
                opening_quantity = excluded.opening_quantity,
                opening_value = excluded.opening_value,
                reorder_level = excluded.reorder_level,
                is_active = excluded.is_active,
                opening_quantity_milli = excluded.opening_quantity_milli,
                reorder_level_milli = excluded.reorder_level_milli",
            params![
                item.id,
                item.company_id,
                item.name,
                item.stock_group_id,
                item.unit_id,
                int_from_bool(item.is_inventory),
                int_from_bool(item.is_service),
                item.purchase_price,
                item.sales_price,
                item.hsn,
                item.tax_category_id,
                round_quantity(item.opening_quantity_milli as f64 / 1000.0),
                item.opening_value,
                round_quantity(item.reorder_level_milli as f64 / 1000.0),
                int_from_bool(item.is_active),
                item.created_at,
                item.opening_quantity_milli,
                item.reorder_level_milli,
            ],
        )
        .map_err(|error| db_error("The item could not be saved", error))?;
    Ok(item)

    })
}

#[tauri::command]
pub fn save_item_cmd(workspace: State<'_, Workspace>, item: Item) -> Result<Item, String> {
    workspace.with_database(|db| save_item(db, item))
}

// ---------------------------------------------------------------------------
// Tax categories
// ---------------------------------------------------------------------------

fn tax_category_from_row(row: &Row<'_>) -> rusqlite::Result<TaxCategory> {
    Ok(TaxCategory {
        id: row.get(0)?,
        company_id: row.get(1)?,
        name: row.get(2)?,
        rate: row.get(3)?,
        kind: row.get(4)?,
        hsn: row.get(5)?,
        ledger_id: row.get(6)?,
        input_ledger_id: row.get(7)?,
        is_active: bool_from_int(row.get(8)?),
    })
}

const TAX_COLUMNS: &str =
    "id, company_id, name, rate, kind, hsn, ledger_id, input_ledger_id, is_active";

pub fn list_tax_categories(
    database: &Database,
    company_id: &str,
) -> Result<Vec<TaxCategory>, String> {
    let connection = database.lock();
    let mut statement = connection
        .prepare(&format!(
            "SELECT {TAX_COLUMNS} FROM tax_categories WHERE company_id = ?1 ORDER BY name"
        ))
        .map_err(|error| db_error("The tax categories could not be read", error))?;
    let rows = statement
        .query_map(params![company_id], tax_category_from_row)
        .map_err(|error| db_error("The tax categories could not be read", error))?;
    let mut categories = Vec::new();
    for category in rows {
        categories.push(category.map_err(|error| db_error("A tax category is unreadable", error))?);
    }
    Ok(categories)
}

#[tauri::command]
pub fn list_tax_categories_cmd(
    workspace: State<'_, Workspace>,
    company_id: String,
) -> Result<Vec<TaxCategory>, String> {
    workspace.with_database(|db| list_tax_categories(db, &company_id))
}

#[tauri::command]
pub fn save_tax_category_cmd(
    workspace: State<'_, Workspace>,
    tax: TaxCategory,
) -> Result<TaxCategory, String> {
    workspace.with_database(|database| {
        database.transaction(|transaction| {
        ensure_company(transaction, &tax.company_id)?;
        transaction
            .execute(
                "INSERT INTO tax_categories (id, company_id, name, rate, kind, hsn, ledger_id,
                    input_ledger_id, is_active)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name, rate = excluded.rate, kind = excluded.kind,
                    hsn = excluded.hsn, ledger_id = excluded.ledger_id,
                    input_ledger_id = excluded.input_ledger_id, is_active = excluded.is_active",
                params![
                    tax.id,
                    tax.company_id,
                    tax.name,
                    tax.rate,
                    tax.kind,
                    tax.hsn,
                    tax.ledger_id,
                    tax.input_ledger_id,
                    int_from_bool(tax.is_active),
                ],
            )
            .map_err(|error| db_error("The tax category could not be saved", error))?;
        Ok(tax)

        })
    })
}

// ---------------------------------------------------------------------------
// Simple masters
// ---------------------------------------------------------------------------

pub fn list_stock_groups(database: &Database, company_id: &str) -> Result<Vec<StockGroup>, String> {
    let connection = database.lock();
    let mut statement = connection
        .prepare("SELECT id, company_id, name, parent_id FROM stock_groups WHERE company_id = ?1 ORDER BY name")
        .map_err(|error| db_error("The stock groups could not be read", error))?;
    let rows = statement
        .query_map(params![company_id], |row| {
            Ok(StockGroup {
                id: row.get(0)?,
                company_id: row.get(1)?,
                name: row.get(2)?,
                parent_id: row.get(3)?,
            })
        })
        .map_err(|error| db_error("The stock groups could not be read", error))?;
    let mut groups = Vec::new();
    for group in rows {
        groups.push(group.map_err(|error| db_error("A stock group is unreadable", error))?);
    }
    Ok(groups)
}

#[tauri::command]
pub fn list_stock_groups_cmd(
    workspace: State<'_, Workspace>,
    company_id: String,
) -> Result<Vec<StockGroup>, String> {
    workspace.with_database(|db| list_stock_groups(db, &company_id))
}

pub fn list_units(database: &Database, company_id: &str) -> Result<Vec<Unit>, String> {
    let connection = database.lock();
    let mut statement = connection
        .prepare("SELECT id, company_id, name, decimal_places FROM units WHERE company_id = ?1 ORDER BY name")
        .map_err(|error| db_error("The units could not be read", error))?;
    let rows = statement
        .query_map(params![company_id], |row| {
            Ok(Unit {
                id: row.get(0)?,
                company_id: row.get(1)?,
                name: row.get(2)?,
                decimal_places: row.get(3)?,
            })
        })
        .map_err(|error| db_error("The units could not be read", error))?;
    let mut units = Vec::new();
    for unit in rows {
        units.push(unit.map_err(|error| db_error("A unit is unreadable", error))?);
    }
    Ok(units)
}

#[tauri::command]
pub fn list_units_cmd(workspace: State<'_, Workspace>, company_id: String) -> Result<Vec<Unit>, String> {
    workspace.with_database(|db| list_units(db, &company_id))
}

pub fn list_godowns(database: &Database, company_id: &str) -> Result<Vec<Godown>, String> {
    let connection = database.lock();
    let mut statement = connection
        .prepare("SELECT id, company_id, name, location FROM godowns WHERE company_id = ?1 ORDER BY name")
        .map_err(|error| db_error("The godowns could not be read", error))?;
    let rows = statement
        .query_map(params![company_id], |row| {
            Ok(Godown {
                id: row.get(0)?,
                company_id: row.get(1)?,
                name: row.get(2)?,
                location: row.get(3)?,
            })
        })
        .map_err(|error| db_error("The godowns could not be read", error))?;
    let mut godowns = Vec::new();
    for godown in rows {
        godowns.push(godown.map_err(|error| db_error("A godown is unreadable", error))?);
    }
    Ok(godowns)
}

#[tauri::command]
pub fn list_godowns_cmd(
    workspace: State<'_, Workspace>,
    company_id: String,
) -> Result<Vec<Godown>, String> {
    workspace.with_database(|db| list_godowns(db, &company_id))
}

pub fn list_cost_centres(database: &Database, company_id: &str) -> Result<Vec<CostCentre>, String> {
    let connection = database.lock();
    let mut statement = connection
        .prepare("SELECT id, company_id, name, parent_id, is_active FROM cost_centres WHERE company_id = ?1 ORDER BY name")
        .map_err(|error| db_error("The cost centres could not be read", error))?;
    let rows = statement
        .query_map(params![company_id], |row| {
            Ok(CostCentre {
                id: row.get(0)?,
                company_id: row.get(1)?,
                name: row.get(2)?,
                parent_id: row.get(3)?,
                is_active: bool_from_int(row.get(4)?),
            })
        })
        .map_err(|error| db_error("The cost centres could not be read", error))?;
    let mut centres = Vec::new();
    for centre in rows {
        centres.push(centre.map_err(|error| db_error("A cost centre is unreadable", error))?);
    }
    Ok(centres)
}

#[tauri::command]
pub fn list_cost_centres_cmd(
    workspace: State<'_, Workspace>,
    company_id: String,
) -> Result<Vec<CostCentre>, String> {
    workspace.with_database(|db| list_cost_centres(db, &company_id))
}

pub fn list_employees(database: &Database, company_id: &str) -> Result<Vec<Employee>, String> {
    let connection = database.lock();
    let mut statement = connection
        .prepare("SELECT id, company_id, name, code, department, designation, date_of_joining, monthly_gross, is_active
             FROM employees WHERE company_id = ?1 ORDER BY name")
        .map_err(|error| db_error("The employees could not be read", error))?;
    let rows = statement
        .query_map(params![company_id], |row| {
            Ok(Employee {
                id: row.get(0)?,
                company_id: row.get(1)?,
                name: row.get(2)?,
                code: row.get(3)?,
                department: row.get(4)?,
                designation: row.get(5)?,
                date_of_joining: row.get(6)?,
                monthly_gross: row.get(7)?,
                is_active: bool_from_int(row.get(8)?),
            })
        })
        .map_err(|error| db_error("The employees could not be read", error))?;
    let mut employees = Vec::new();
    for employee in rows {
        employees.push(employee.map_err(|error| db_error("An employee is unreadable", error))?);
    }
    Ok(employees)
}

#[tauri::command]
pub fn list_employees_cmd(
    workspace: State<'_, Workspace>,
    company_id: String,
) -> Result<Vec<Employee>, String> {
    workspace.with_database(|db| list_employees(db, &company_id))
}

pub fn list_currencies(database: &Database, company_id: &str) -> Result<Vec<Currency>, String> {
    let connection = database.lock();
    let mut statement = connection
        .prepare("SELECT id, company_id, code, name, rate, symbol FROM currencies WHERE company_id = ?1 ORDER BY code")
        .map_err(|error| db_error("The currencies could not be read", error))?;
    let rows = statement
        .query_map(params![company_id], |row| {
            Ok(Currency {
                id: row.get(0)?,
                company_id: row.get(1)?,
                code: row.get(2)?,
                name: row.get(3)?,
                rate: row.get(4)?,
                symbol: row.get(5)?,
            })
        })
        .map_err(|error| db_error("The currencies could not be read", error))?;
    let mut currencies = Vec::new();
    for currency in rows {
        currencies.push(currency.map_err(|error| db_error("A currency is unreadable", error))?);
    }
    Ok(currencies)
}

#[tauri::command]
pub fn list_currencies_cmd(
    workspace: State<'_, Workspace>,
    company_id: String,
) -> Result<Vec<Currency>, String> {
    workspace.with_database(|db| list_currencies(db, &company_id))
}

pub fn list_price_lists(database: &Database, company_id: &str) -> Result<Vec<PriceList>, String> {
    let connection = database.lock();
    let mut statement = connection
        .prepare("SELECT id, company_id, name, is_default FROM price_lists WHERE company_id = ?1 ORDER BY name")
        .map_err(|error| db_error("The price lists could not be read", error))?;
    let rows = statement
        .query_map(params![company_id], |row| {
            Ok(PriceList {
                id: row.get(0)?,
                company_id: row.get(1)?,
                name: row.get(2)?,
                is_default: bool_from_int(row.get(3)?),
            })
        })
        .map_err(|error| db_error("The price lists could not be read", error))?;
    let mut lists = Vec::new();
    for list in rows {
        lists.push(list.map_err(|error| db_error("A price list is unreadable", error))?);
    }
    Ok(lists)
}

#[tauri::command]
pub fn list_price_lists_cmd(
    workspace: State<'_, Workspace>,
    company_id: String,
) -> Result<Vec<PriceList>, String> {
    workspace.with_database(|db| list_price_lists(db, &company_id))
}

pub fn list_price_list_entries(
    database: &Database,
    company_id: &str,
    price_list_id: &str,
) -> Result<Vec<PriceListEntry>, String> {
    let connection = database.lock();
    let mut statement = connection
        .prepare(
            "SELECT e.price_list_id, e.item_id, e.rate
             FROM price_list_entries e
             JOIN price_lists p ON p.id = e.price_list_id AND p.company_id = e.company_id
             WHERE e.company_id = ?1 AND e.price_list_id = ?2",
        )
        .map_err(|error| db_error("The price list entries could not be read", error))?;
    let rows = statement
        .query_map(params![company_id, price_list_id], |row| {
            Ok(PriceListEntry {
                price_list_id: row.get(0)?,
                item_id: row.get(1)?,
                rate: row.get(2)?,
            })
        })
        .map_err(|error| db_error("The price list entries could not be read", error))?;
    let mut entries = Vec::new();
    for entry in rows {
        entries.push(entry.map_err(|error| db_error("A price list entry is unreadable", error))?);
    }
    Ok(entries)
}

#[tauri::command]
pub fn list_price_list_entries_cmd(
    workspace: State<'_, Workspace>,
    company_id: String,
    price_list_id: String,
) -> Result<Vec<PriceListEntry>, String> {
    workspace.with_database(|db| list_price_list_entries(db, &company_id, &price_list_id))
}

pub fn list_payment_terms(database: &Database, company_id: &str) -> Result<Vec<PaymentTerm>, String> {
    let connection = database.lock();
    let mut statement = connection
        .prepare("SELECT id, company_id, name, days FROM payment_terms WHERE company_id = ?1 ORDER BY days")
        .map_err(|error| db_error("The payment terms could not be read", error))?;
    let rows = statement
        .query_map(params![company_id], |row| {
            Ok(PaymentTerm {
                id: row.get(0)?,
                company_id: row.get(1)?,
                name: row.get(2)?,
                days: row.get(3)?,
            })
        })
        .map_err(|error| db_error("The payment terms could not be read", error))?;
    let mut terms = Vec::new();
    for term in rows {
        terms.push(term.map_err(|error| db_error("A payment term is unreadable", error))?);
    }
    Ok(terms)
}

#[tauri::command]
pub fn list_payment_terms_cmd(
    workspace: State<'_, Workspace>,
    company_id: String,
) -> Result<Vec<PaymentTerm>, String> {
    workspace.with_database(|db| list_payment_terms(db, &company_id))
}

// ---------------------------------------------------------------------------
// Writing the supporting masters
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn save_stock_group_cmd(
    workspace: State<'_, Workspace>,
    group: StockGroup,
) -> Result<StockGroup, String> {
    workspace.with_database(|db| {
        db.transaction(|transaction| {
            ensure_company(transaction, &group.company_id)?;
            transaction
                .execute(
                    "INSERT INTO stock_groups (id, company_id, name, parent_id) VALUES (?1, ?2, ?3, ?4)
                     ON CONFLICT(id) DO UPDATE SET name = excluded.name, parent_id = excluded.parent_id",
                    params![group.id, group.company_id, group.name, group.parent_id],
                )
                .map_err(|error| db_error("The stock group could not be saved", error))?;
            Ok(group)
        })
    })
}

#[tauri::command]
pub fn save_unit_cmd(workspace: State<'_, Workspace>, unit: Unit) -> Result<Unit, String> {
    workspace.with_database(|db| {
        db.transaction(|transaction| {
            ensure_company(transaction, &unit.company_id)?;
            transaction
                .execute(
                    "INSERT INTO units (id, company_id, name, decimal_places) VALUES (?1, ?2, ?3, ?4)
                     ON CONFLICT(id) DO UPDATE SET name = excluded.name, decimal_places = excluded.decimal_places",
                    params![unit.id, unit.company_id, unit.name, unit.decimal_places],
                )
                .map_err(|error| db_error("The unit could not be saved", error))?;
            Ok(unit)
        })
    })
}

pub fn save_godown(database: &Database, godown: Godown) -> Result<Godown, String> {
    database.transaction(|transaction| {
        ensure_company(transaction, &godown.company_id)?;
        transaction
            .execute(
                "INSERT INTO godowns (id, company_id, name, location) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(id) DO UPDATE SET name = excluded.name, location = excluded.location",
                params![godown.id, godown.company_id, godown.name, godown.location],
            )
            .map_err(|error| db_error("The godown could not be saved", error))?;
        Ok(godown)
    })
}

#[tauri::command]
pub fn save_godown_cmd(workspace: State<'_, Workspace>, godown: Godown) -> Result<Godown, String> {
    workspace.with_database(|db| save_godown(db, godown))
}

#[tauri::command]
pub fn save_cost_centre_cmd(
    workspace: State<'_, Workspace>,
    centre: CostCentre,
) -> Result<CostCentre, String> {
    workspace.with_database(|db| {
        db.transaction(|transaction| {
            ensure_company(transaction, &centre.company_id)?;
            transaction
                .execute(
                    "INSERT INTO cost_centres (id, company_id, name, parent_id, is_active)
                     VALUES (?1, ?2, ?3, ?4, ?5)
                     ON CONFLICT(id) DO UPDATE SET name = excluded.name, parent_id = excluded.parent_id,
                        is_active = excluded.is_active",
                    params![
                        centre.id,
                        centre.company_id,
                        centre.name,
                        centre.parent_id,
                        int_from_bool(centre.is_active)
                    ],
                )
                .map_err(|error| db_error("The cost centre could not be saved", error))?;
            Ok(centre)
        })
    })
}

#[tauri::command]
pub fn save_employee_cmd(
    workspace: State<'_, Workspace>,
    employee: Employee,
) -> Result<Employee, String> {
    workspace.with_database(|db| {
        check_money(employee.monthly_gross, "Monthly gross")?;
        db.transaction(|transaction| {
            ensure_company(transaction, &employee.company_id)?;
            transaction
                .execute(
                    "INSERT INTO employees (id, company_id, name, code, department, designation,
                        date_of_joining, monthly_gross, is_active)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                     ON CONFLICT(id) DO UPDATE SET name = excluded.name, code = excluded.code,
                        department = excluded.department, designation = excluded.designation,
                        date_of_joining = excluded.date_of_joining,
                        monthly_gross = excluded.monthly_gross, is_active = excluded.is_active",
                    params![
                        employee.id,
                        employee.company_id,
                        employee.name,
                        employee.code,
                        employee.department,
                        employee.designation,
                        employee.date_of_joining,
                        employee.monthly_gross,
                        int_from_bool(employee.is_active)
                    ],
                )
                .map_err(|error| db_error("The employee could not be saved", error))?;
            Ok(employee)
        })
    })
}

#[tauri::command]
pub fn save_currency_cmd(
    workspace: State<'_, Workspace>,
    currency: Currency,
) -> Result<Currency, String> {
    workspace.with_database(|db| {
        db.transaction(|transaction| {
            ensure_company(transaction, &currency.company_id)?;
            transaction
                .execute(
                    "INSERT INTO currencies (id, company_id, code, name, rate, symbol)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                     ON CONFLICT(id) DO UPDATE SET code = excluded.code, name = excluded.name,
                        rate = excluded.rate, symbol = excluded.symbol",
                    params![
                        currency.id,
                        currency.company_id,
                        currency.code,
                        currency.name,
                        currency.rate,
                        currency.symbol
                    ],
                )
                .map_err(|error| db_error("The currency could not be saved", error))?;
            Ok(currency)
        })
    })
}

#[tauri::command]
pub fn save_price_list_cmd(
    workspace: State<'_, Workspace>,
    price_list: PriceList,
) -> Result<PriceList, String> {
    workspace.with_database(|db| {
        db.transaction(|transaction| {
            ensure_company(transaction, &price_list.company_id)?;
            transaction
                .execute(
                    "INSERT INTO price_lists (id, company_id, name, is_default) VALUES (?1, ?2, ?3, ?4)
                     ON CONFLICT(id) DO UPDATE SET name = excluded.name, is_default = excluded.is_default",
                    params![
                        price_list.id,
                        price_list.company_id,
                        price_list.name,
                        int_from_bool(price_list.is_default)
                    ],
                )
                .map_err(|error| db_error("The price list could not be saved", error))?;
            Ok(price_list)
        })
    })
}

/// Replace the rates of a price list. The whole list is written in one
/// transaction, so a price list is never half updated.
#[tauri::command]
pub fn save_price_list_entries_cmd(
    workspace: State<'_, Workspace>,
    company_id: String,
    price_list_id: String,
    entries: Vec<PriceListEntry>,
) -> Result<Vec<PriceListEntry>, String> {
    workspace.with_database(|db| {
        db.transaction(|transaction| {
            ensure_company(transaction, &company_id)?;
            transaction
                .execute(
                    "DELETE FROM price_list_entries WHERE price_list_id = ?1 AND company_id = ?2",
                    params![price_list_id, company_id],
                )
                .map_err(|error| db_error("The price list could not be cleared", error))?;
            for entry in &entries {
                check_money(entry.rate, "Price list rate")?;
                transaction
                    .execute(
                        "INSERT INTO price_list_entries (price_list_id, item_id, company_id, rate)
                         VALUES (?1, ?2, ?3, ?4)",
                        params![entry.price_list_id, entry.item_id, company_id, entry.rate],
                    )
                    .map_err(|error| db_error("A price list entry could not be saved", error))?;
            }
            Ok(entries)
        })
    })
}

#[tauri::command]
pub fn save_payment_term_cmd(
    workspace: State<'_, Workspace>,
    term: PaymentTerm,
) -> Result<PaymentTerm, String> {
    workspace.with_database(|db| {
        db.transaction(|transaction| {
            ensure_company(transaction, &term.company_id)?;
            transaction
                .execute(
                    "INSERT INTO payment_terms (id, company_id, name, days) VALUES (?1, ?2, ?3, ?4)
                     ON CONFLICT(id) DO UPDATE SET name = excluded.name, days = excluded.days",
                    params![term.id, term.company_id, term.name, term.days],
                )
                .map_err(|error| db_error("The payment term could not be saved", error))?;
            Ok(term)
        })
    })
}

/// Deactivate a master record that has history behind it, rather than
/// deleting it and breaking the records that point at it.
#[tauri::command]
pub fn deactivate_ledger_cmd(
    workspace: State<'_, Workspace>,
    company_id: String,
    id: String,
) -> Result<(), String> {
    workspace.with_database(|db| {
        db.transaction(|transaction| {
            transaction
                .execute(
                    "UPDATE ledgers SET is_active = 0 WHERE id = ?1 AND company_id = ?2",
                    params![id, company_id],
                )
                .map_err(|error| db_error("The ledger could not be deactivated", error))?;
            Ok(())
        })
    })
}

// ---------------------------------------------------------------------------
// Vouchers
// ---------------------------------------------------------------------------

fn voucher_entries(connection: &Connection, voucher_id: &str) -> Result<Vec<VoucherEntry>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, ledger_id, debit, credit, narration, cost_centre_id
             FROM voucher_entries WHERE voucher_id = ?1 ORDER BY id",
        )
        .map_err(|error| db_error("The voucher entries could not be read", error))?;
    let rows = statement
        .query_map(params![voucher_id], |row| {
            Ok(VoucherEntry {
                id: row.get(0)?,
                ledger_id: row.get(1)?,
                debit: row.get(2)?,
                credit: row.get(3)?,
                narration: row.get(4)?,
                cost_centre_id: row.get(5)?,
            })
        })
        .map_err(|error| db_error("The voucher entries could not be read", error))?;
    let mut entries = Vec::new();
    for entry in rows {
        entries.push(entry.map_err(|error| db_error("A voucher entry is unreadable", error))?);
    }
    Ok(entries)
}

fn voucher_items(connection: &Connection, voucher_id: &str) -> Result<Vec<VoucherItemLine>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, item_id,
                COALESCE(quantity_milli, CAST(ROUND(quantity * 1000) AS INTEGER), 0),
                rate, discount, tax_category_id, amount, godown_id, batch,
                direct_cost, to_godown_id, order_line_id, production_requirement_id
             FROM voucher_items WHERE voucher_id = ?1 ORDER BY id",
        )
        .map_err(|error| db_error("The voucher item lines could not be read", error))?;
    let rows = statement
        .query_map(params![voucher_id], |row| {
            Ok(VoucherItemLine {
                id: row.get(0)?,
                item_id: row.get(1)?,
                quantity_milli: row.get(2)?,
                rate: row.get(3)?,
                discount: row.get(4)?,
                tax_category_id: row.get(5)?,
                amount: row.get(6)?,
                godown_id: row.get(7)?,
                batch: row.get(8)?,
                direct_cost: row.get(9)?,
                to_godown_id: row.get(10)?,
                order_line_id: row.get(11)?,
                production_requirement_id: row.get(12)?,
            })
        })
        .map_err(|error| db_error("The voucher item lines could not be read", error))?;
    let mut items = Vec::new();
    for item in rows {
        items.push(item.map_err(|error| db_error("A voucher item line is unreadable", error))?);
    }
    Ok(items)
}

fn voucher_taxes(connection: &Connection, voucher_id: &str) -> Result<Vec<VoucherTaxLine>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, tax_category_id, taxable, amount FROM voucher_taxes WHERE voucher_id = ?1 ORDER BY id",
        )
        .map_err(|error| db_error("The voucher tax lines could not be read", error))?;
    let rows = statement
        .query_map(params![voucher_id], |row| {
            Ok(VoucherTaxLine {
                id: row.get(0)?,
                tax_category_id: row.get(1)?,
                taxable: row.get(2)?,
                amount: row.get(3)?,
            })
        })
        .map_err(|error| db_error("The voucher tax lines could not be read", error))?;
    let mut taxes = Vec::new();
    for tax in rows {
        taxes.push(tax.map_err(|error| db_error("A voucher tax line is unreadable", error))?);
    }
    Ok(taxes)
}

const VOUCHER_COLUMNS: &str = "id, company_id, kind, number, date, due_date, payment_term_id, \
     party_id, narration, reference, status, linked_voucher_id, reversed_by_voucher_id, is_locked, \
     created_at, updated_at";

fn voucher_from_row(row: &Row<'_>) -> rusqlite::Result<Voucher> {
    Ok(Voucher {
        id: row.get(0)?,
        company_id: row.get(1)?,
        kind: row.get(2)?,
        number: row.get(3)?,
        date: row.get(4)?,
        due_date: row.get(5)?,
        payment_term_id: row.get(6)?,
        party_id: row.get(7)?,
        narration: row.get(8)?,
        reference: row.get(9)?,
        status: row.get(10)?,
        entries: Vec::new(),
        items: Vec::new(),
        taxes: Vec::new(),
        linked_voucher_id: row.get(11)?,
        reversed_by_voucher_id: row.get(12)?,
        is_locked: bool_from_int(row.get(13)?),
        created_at: row.get(14)?,
        updated_at: row.get(15)?,
    })
}

pub fn list_vouchers(
    database: &Database,
    company_id: &str,
    filters: &VoucherFilters,
) -> Result<Vec<Voucher>, String> {
    let connection = database.lock();
    let mut sql = format!("SELECT {VOUCHER_COLUMNS} FROM vouchers WHERE company_id = ?1");
    let mut values: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(company_id.to_string())];

    if let Some(from) = &filters.from {
        values.push(Box::new(from.clone()));
        sql.push_str(&format!(" AND date >= ?{}", values.len()));
    }
    if let Some(to) = &filters.to {
        values.push(Box::new(to.clone()));
        sql.push_str(&format!(" AND date <= ?{}", values.len()));
    }
    if let Some(kind) = &filters.kind {
        if kind != "all" {
            values.push(Box::new(kind.clone()));
            sql.push_str(&format!(" AND kind = ?{}", values.len()));
        }
    }
    if let Some(status) = &filters.status {
        if status != "all" {
            values.push(Box::new(status.clone()));
            sql.push_str(&format!(" AND status = ?{}", values.len()));
        }
    }
    if let Some(party) = &filters.party_id {
        values.push(Box::new(party.clone()));
        sql.push_str(&format!(" AND party_id = ?{}", values.len()));
    }
    if let Some(search) = &filters.search {
        if !search.trim().is_empty() {
            let term = format!("%{}%", search.trim());
            values.push(Box::new(term.clone()));
            let index = values.len();
            sql.push_str(&format!(
                " AND (number LIKE ?{index} OR narration LIKE ?{index} OR reference LIKE ?{index})"
            ));
        }
    }
    sql.push_str(" ORDER BY date DESC, number DESC");

    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| db_error("The vouchers could not be read", error))?;
    let parameter = rusqlite::params_from_iter(values.iter().map(|value| value.as_ref()));
    let rows = statement
        .query_map(parameter, voucher_from_row)
        .map_err(|error| db_error("The vouchers could not be read", error))?;

    let mut vouchers = Vec::new();
    for voucher in rows {
        let mut voucher = voucher.map_err(|error| db_error("A voucher is unreadable", error))?;
        voucher.entries = voucher_entries(&connection, &voucher.id)?;
        voucher.items = voucher_items(&connection, &voucher.id)?;
        voucher.taxes = voucher_taxes(&connection, &voucher.id)?;
        vouchers.push(voucher);
    }
    Ok(vouchers)
}

#[tauri::command]
pub fn list_vouchers_cmd(
    workspace: State<'_, Workspace>,
    company_id: String,
    filters: Option<VoucherFilters>,
) -> Result<Vec<Voucher>, String> {
    workspace.with_database(|db| list_vouchers(db, &company_id, &filters.unwrap_or_default()))
}

pub fn get_voucher(
    database: &Database,
    company_id: &str,
    id: &str,
) -> Result<Option<Voucher>, String> {
    let connection = database.lock();
    let mut voucher = connection
        .query_row(
            &format!("SELECT {VOUCHER_COLUMNS} FROM vouchers WHERE id = ?1 AND company_id = ?2"),
            params![id, company_id],
            voucher_from_row,
        )
        .optional()
        .map_err(|error| db_error("The voucher could not be read", error))?;

    if let Some(voucher) = voucher.as_mut() {
        voucher.entries = voucher_entries(&connection, &voucher.id)?;
        voucher.items = voucher_items(&connection, &voucher.id)?;
        voucher.taxes = voucher_taxes(&connection, &voucher.id)?;
    }
    Ok(voucher)
}

#[tauri::command]
pub fn get_voucher_cmd(
    workspace: State<'_, Workspace>,
    company_id: String,
    id: String,
) -> Result<Option<Voucher>, String> {
    workspace.with_database(|db| get_voucher(db, &company_id, &id))
}

/// Save a voucher and everything that belongs to it in one transaction.
///
/// The header, the entry lines, the item lines, the tax lines and the audit
/// event are written together. If any part fails, none of it is committed, so
/// a voucher can never exist without its entries.
pub fn save_voucher(
    database: &Database,
    voucher: Voucher,
    actor: &str,
) -> Result<Voucher, String> {
    for entry in &voucher.entries {
        check_money(entry.debit, "Debit amount")?;
        check_money(entry.credit, "Credit amount")?;
    }
    for item in &voucher.items {
        check_money(item.rate, "Rate")?;
        check_money(item.discount, "Discount")?;
        check_money(item.amount, "Line amount")?;
    }
    for tax in &voucher.taxes {
        check_money(tax.taxable, "Taxable amount")?;
        check_money(tax.amount, "Tax amount")?;
    }

    database.transaction(|transaction| {
    ensure_company(transaction, &voucher.company_id)?;

    let existing: Option<String> = transaction
        .query_row(
            "SELECT status FROM vouchers WHERE id = ?1 AND company_id = ?2",
            params![voucher.id, voucher.company_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| db_error("The voucher could not be checked", error))?;

    // A posted voucher is not silently overwritten. It may be edited while
    // it is still a draft.
    if let Some(status) = &existing {
        if status == "posted" && voucher.status == "posted" {
            // Re-posting the same voucher is allowed, but its number and
            // identity must not change underneath the books.
            let changed: i64 = transaction
                .query_row(
                    "SELECT COUNT(*) FROM vouchers WHERE id = ?1 AND company_id = ?2 AND number = ?3",
                    params![voucher.id, voucher.company_id, voucher.number],
                    |row| row.get(0),
                )
                .map_err(|error| db_error("The voucher could not be checked", error))?;
            if changed == 0 {
                return Err(format!(
                    "Voucher {} already exists with a different number. Numbers cannot be reused.",
                    voucher.number
                ));
            }
        }
    }

    transaction
        .execute(
            "INSERT INTO vouchers (id, company_id, kind, number, date, party_id, narration,
                reference, status, linked_voucher_id, reversed_by_voucher_id, is_locked,
                created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
             ON CONFLICT(id) DO UPDATE SET
                kind = excluded.kind,
                number = excluded.number,
                date = excluded.date,
                party_id = excluded.party_id,
                narration = excluded.narration,
                reference = excluded.reference,
                status = excluded.status,
                linked_voucher_id = excluded.linked_voucher_id,
                reversed_by_voucher_id = excluded.reversed_by_voucher_id,
                is_locked = excluded.is_locked,
                updated_at = excluded.updated_at",
            params![
                voucher.id,
                voucher.company_id,
                voucher.kind,
                voucher.number,
                voucher.date,
                voucher.party_id,
                voucher.narration,
                voucher.reference,
                voucher.status,
                voucher.linked_voucher_id,
                voucher.reversed_by_voucher_id,
                int_from_bool(voucher.is_locked),
                voucher.created_at,
                voucher.updated_at,
            ],
        )
        .map_err(|error| db_error("The voucher could not be saved", error))?;

    // Replace the child rows wholesale: a save is the complete state of
    // the voucher, not a patch.
    transaction
        .execute(
            "DELETE FROM voucher_entries WHERE voucher_id = ?1 AND company_id = ?2",
            params![voucher.id, voucher.company_id],
        )
        .map_err(|error| db_error("The voucher entries could not be replaced", error))?;
    transaction
        .execute(
            "DELETE FROM voucher_items WHERE voucher_id = ?1 AND company_id = ?2",
            params![voucher.id, voucher.company_id],
        )
        .map_err(|error| db_error("The voucher item lines could not be replaced", error))?;
    transaction
        .execute(
            "DELETE FROM voucher_taxes WHERE voucher_id = ?1 AND company_id = ?2",
            params![voucher.id, voucher.company_id],
        )
        .map_err(|error| db_error("The voucher tax lines could not be replaced", error))?;

    for entry in &voucher.entries {
        transaction
            .execute(
                "INSERT INTO voucher_entries (id, voucher_id, company_id, ledger_id, debit,
                    credit, narration, cost_centre_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    entry.id,
                    voucher.id,
                    voucher.company_id,
                    entry.ledger_id,
                    entry.debit,
                    entry.credit,
                    entry.narration,
                    entry.cost_centre_id
                ],
            )
            .map_err(|error| {
                db_error(
                    "A voucher entry could not be saved. The voucher was not posted.",
                    error,
                )
            })?;
    }

    for item in &voucher.items {
        transaction
            .execute(
                "INSERT INTO voucher_items (id, voucher_id, company_id, item_id, quantity, rate,
                    discount, tax_category_id, amount, godown_id, batch, quantity_milli,
                    direct_cost, to_godown_id, order_line_id, production_requirement_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
                params![
                    item.id,
                    voucher.id,
                    voucher.company_id,
                    item.item_id,
                    round_quantity(item.quantity_milli as f64 / 1000.0),
                    item.rate,
                    item.discount,
                    item.tax_category_id,
                    item.amount,
                    item.godown_id,
                    item.batch,
                    item.quantity_milli,
                    item.direct_cost,
                    item.to_godown_id,
                    item.order_line_id,
                    item.production_requirement_id,
                ],
            )
            .map_err(|error| {
                db_error(
                    "A voucher item line could not be saved. The voucher was not posted.",
                    error,
                )
            })?;
    }

    for tax in &voucher.taxes {
        transaction
            .execute(
                "INSERT INTO voucher_taxes (id, voucher_id, company_id, tax_category_id, taxable, amount)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    tax.id,
                    voucher.id,
                    voucher.company_id,
                    tax.tax_category_id,
                    tax.taxable,
                    tax.amount
                ],
            )
            .map_err(|error| {
                db_error(
                    "A voucher tax line could not be saved. The voucher was not posted.",
                    error,
                )
            })?;
    }

    let action = if existing.is_some() { "voucher.updated" } else { "voucher.posted" };
    transaction
        .execute(
            "INSERT INTO audit_events (id, company_id, actor, action, record_type, record_id,
                record_label, timestamp, detail)
             VALUES (?1, ?2, ?3, ?4, 'voucher', ?5, ?6, ?7, ?8)",
            params![
                unique_id("aud"),
                voucher.company_id,
                actor,
                action,
                voucher.id,
                format!("{} — {}", voucher.number, voucher.narration),
                voucher.updated_at,
                format!("{} voucher dated {}", voucher.kind, voucher.date),
            ],
        )
        .map_err(|error| db_error("The audit entry could not be written", error))?;

    Ok(voucher)

    })
}

#[tauri::command]
pub fn save_voucher_cmd(
    workspace: State<'_, Workspace>,
    voucher: Voucher,
    actor: Option<String>,
) -> Result<Voucher, String> {
    workspace.with_database(|db| save_voucher(db, voucher, actor.as_deref().unwrap_or("local.operator")))
}

pub fn delete_voucher(database: &Database, company_id: &str, id: &str) -> Result<(), String> {
    database.transaction(|transaction| {
    transaction
        .execute(
            "DELETE FROM vouchers WHERE id = ?1 AND company_id = ?2",
            params![id, company_id],
        )
        .map_err(|error| db_error("The voucher could not be removed", error))?;
    Ok(())

    })
}

#[tauri::command]
pub fn delete_voucher_cmd(
    workspace: State<'_, Workspace>,
    company_id: String,
    id: String,
) -> Result<(), String> {
    workspace.with_database(|db| delete_voucher(db, &company_id, &id))
}

/// The next voucher number for a type, derived from the highest number in use
/// so a deleted middle voucher cannot cause a collision.
///
/// The prefix and padding come from the company's numbering configuration, so
/// the saved scheme is what actually numbers the vouchers.
pub fn next_voucher_number(
    database: &Database,
    company_id: &str,
    kind: &str,
    prefix: Option<String>,
    padding: Option<i64>,
) -> Result<String, String> {
    // The company's saved scheme is what numbers the vouchers. The prefix and
    // padding may be supplied to avoid a second read, but the configuration is
    // the authority.
    let (prefix, padding) = match (prefix, padding) {
        (Some(prefix), Some(padding)) => (prefix, padding.clamp(1, 8) as usize),
        _ => {
            let numbering = get_voucher_numbering(database, company_id)?;
            (
                numbering_prefix(&numbering, kind),
                numbering.padding.clamp(1, 8) as usize,
            )
        }
    };

    let connection = database.lock();
    let mut statement = connection
        .prepare("SELECT number FROM vouchers WHERE company_id = ?1 AND kind = ?2")
        .map_err(|error| db_error("The voucher numbering could not be read", error))?;
    let rows = statement
        .query_map(params![company_id, kind], |row| row.get::<_, String>(0))
        .map_err(|error| db_error("The voucher numbering could not be read", error))?;

    let mut highest = 0i64;
    for number in rows {
        let number = number.map_err(|error| db_error("A voucher number is unreadable", error))?;
        // Only numbers in this series count, so a change of prefix does not
        // restart the count.
        if let Some(digits) = number.strip_prefix(&format!("{prefix}-")) {
            if let Ok(value) = digits.parse::<i64>() {
                highest = highest.max(value);
            }
        }
    }
    Ok(format!("{prefix}-{:0width$}", highest + 1, width = padding))
}

/// The prefix in force for a voucher type.
fn numbering_prefix(numbering: &VoucherNumbering, kind: &str) -> String {
    let prefix = match kind {
        "sales" => &numbering.sales_prefix,
        "purchase" => &numbering.purchase_prefix,
        "payment" => &numbering.payment_prefix,
        "receipt" => &numbering.receipt_prefix,
        "contra" => &numbering.contra_prefix,
        "journal" => &numbering.journal_prefix,
        "credit-note" => &numbering.credit_note_prefix,
        "debit-note" => &numbering.debit_note_prefix,
        "sales-order" => &numbering.sales_order_prefix,
        "purchase-order" => &numbering.purchase_order_prefix,
        _ => return voucher_prefix(kind).to_string(),
    };
    prefix.clone()
}

/// The next number for an order of the given kind.
///
/// An order's kind is `sales` or `purchase`, and its number comes from the
/// order series of the company's scheme. Only numbers in the same series
/// count, so a change of prefix does not restart the count.
pub fn next_order_number(
    database: &Database,
    company_id: &str,
    kind: &str,
    prefix: Option<String>,
    padding: Option<i64>,
) -> Result<String, String> {
    let (prefix, padding) = match (prefix, padding) {
        (Some(prefix), Some(padding)) => (prefix, padding.clamp(1, 8) as usize),
        _ => {
            let numbering = get_voucher_numbering(database, company_id)?;
            let series = match kind {
                "purchase" => "purchase-order",
                _ => "sales-order",
            };
            (
                numbering_prefix(&numbering, series),
                numbering.padding.clamp(1, 8) as usize,
            )
        }
    };

    let connection = database.lock();
    let mut statement = connection
        .prepare("SELECT number FROM orders WHERE company_id = ?1 AND kind = ?2")
        .map_err(|error| db_error("The order numbering could not be read", error))?;
    let rows = statement
        .query_map(params![company_id, kind], |row| row.get::<_, String>(0))
        .map_err(|error| db_error("The order numbering could not be read", error))?;

    let mut highest = 0i64;
    for number in rows {
        let number = number.map_err(|error| db_error("An order number is unreadable", error))?;
        if let Some(digits) = number.strip_prefix(&format!("{prefix}-")) {
            if let Ok(value) = digits.parse::<i64>() {
                highest = highest.max(value);
            }
        }
    }
    Ok(format!("{prefix}-{:0width$}", highest + 1, width = padding))
}

#[tauri::command]
pub fn next_voucher_number_cmd(
    workspace: State<'_, Workspace>,
    company_id: String,
    kind: String,
    prefix: Option<String>,
    padding: Option<i64>,
) -> Result<String, String> {
    workspace.with_database(|db| next_voucher_number(db, &company_id, &kind, prefix, padding))
}

#[tauri::command]
pub fn next_order_number_cmd(
    workspace: State<'_, Workspace>,
    company_id: String,
    kind: String,
    prefix: Option<String>,
    padding: Option<i64>,
) -> Result<String, String> {
    workspace.with_database(|db| next_order_number(db, &company_id, &kind, prefix, padding))
}

pub fn voucher_prefix(kind: &str) -> &'static str {
    match kind {
        "sales" => "INV",
        "purchase" => "PUR",
        "payment" => "PAY",
        "receipt" => "RCP",
        "contra" => "CNT",
        "journal" => "JNL",
        "credit-note" => "CN",
        "debit-note" => "DN",
        "sales-order" => "SO",
        "purchase-order" => "PO",
        "delivery-note" => "DNL",
        "receipt-note" => "RCL",
        "stock-journal" => "STJ",
        _ => "VCH",
    }
}

// ---------------------------------------------------------------------------
// Stock movements and statement lines
// ---------------------------------------------------------------------------

/// The movement types the domain produces.
const MOVEMENT_TYPES: [&str; 11] = [
    "opening",
    "receipt",
    "issue",
    "return-in",
    "return-out",
    "transfer-in",
    "transfer-out",
    "adjustment-in",
    "adjustment-out",
    "reversal-in",
    "reversal-out",
];

/// The direction a movement type decides.
fn movement_direction(movement_type: &str) -> &'static str {
    match movement_type {
        "issue" | "return-out" | "transfer-out" | "adjustment-out" | "reversal-out" => "out",
        _ => "in",
    }
}

/// The columns of a stored movement.
///
/// The quantity and the value are magnitudes and the direction carries the
/// sign, which is the shape the domain produces. The absolute value keeps a
/// movement written by the earlier version — where the sign was held by the
/// quantity itself — readable.
const STOCK_MOVEMENT_COLUMNS: &str = "id, company_id, voucher_id, voucher_item_id, voucher_number, \
     date, item_id, godown_id, movement_type, \
     COALESCE(ABS(quantity_milli), 0), rate, COALESCE(ABS(value), 0), COALESCE(cost, 0), \
     COALESCE(valuation_method, 'moving-weighted-average'), \
     COALESCE(resulting_quantity_milli, 0), COALESCE(resulting_carrying_value, 0), \
     reverses_movement_id, COALESCE(created_at, date), COALESCE(sequence_no, 0)";

pub fn list_stock_movements(
    database: &Database,
    company_id: &str,
    item_id: Option<&str>,
) -> Result<Vec<StockMovementRecord>, String> {
    let connection = database.lock();
    let mut sql = format!(
        "SELECT {STOCK_MOVEMENT_COLUMNS} FROM stock_movements WHERE company_id = ?1"
    );
    if item_id.is_some() {
        sql.push_str(" AND item_id = ?2");
    }
    sql.push_str(" ORDER BY date DESC, sequence_no DESC, id DESC");

    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| db_error("The stock movements could not be read", error))?;
    let rows = match item_id {
        Some(id) => statement.query_map(params![company_id, id], movement_from_row),
        None => statement.query_map(params![company_id], movement_from_row),
    }
    .map_err(|error| db_error("The stock movements could not be read", error))?;

    let mut movements = Vec::new();
    for movement in rows {
        movements.push(movement.map_err(|error| db_error("A stock movement is unreadable", error))?);
    }
    Ok(movements)
}

fn movement_from_row(row: &Row<'_>) -> rusqlite::Result<StockMovementRecord> {
    let movement_type: String = row.get(8)?;
    Ok(StockMovementRecord {
        id: row.get(0)?,
        company_id: row.get(1)?,
        voucher_id: row.get(2)?,
        voucher_item_id: row.get(3)?,
        voucher_number: row.get(4)?,
        date: row.get(5)?,
        item_id: row.get(6)?,
        godown_id: row.get(7)?,
        direction: movement_direction(&movement_type).to_string(),
        movement_type,
        quantity_milli: row.get(9)?,
        rate: row.get(10)?,
        value: row.get(11)?,
        cost: row.get(12)?,
        valuation_method: row.get(13)?,
        resulting_quantity_milli: row.get(14)?,
        resulting_carrying_value: row.get(15)?,
        reverses_movement_id: row.get(16)?,
        created_at: row.get(17)?,
        sequence_no: row.get(18)?,
    })
}

#[tauri::command]
pub fn list_stock_movements_cmd(
    workspace: State<'_, Workspace>,
    company_id: String,
    item_id: Option<String>,
) -> Result<Vec<StockMovementRecord>, String> {
    workspace.with_database(|db| list_stock_movements(db, &company_id, item_id.as_deref()))
}

pub fn list_statement_lines(
    database: &Database,
    company_id: &str,
    ledger_id: Option<&str>,
    reconciled: Option<bool>,
) -> Result<Vec<StatementLine>, String> {
    let connection = database.lock();
    let mut sql = String::from(
        "SELECT id, company_id, ledger_id, date, description, reference, amount,
                matched_voucher_id, confidence, match_reason, is_reconciled
         FROM statement_lines WHERE company_id = ?1",
    );
    let mut values: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(company_id.to_string())];
    if let Some(ledger) = ledger_id {
        values.push(Box::new(ledger.to_string()));
        sql.push_str(&format!(" AND ledger_id = ?{}", values.len()));
    }
    if let Some(flag) = reconciled {
        values.push(Box::new(int_from_bool(flag)));
        sql.push_str(&format!(" AND is_reconciled = ?{}", values.len()));
    }
    sql.push_str(" ORDER BY date DESC, id DESC");

    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| db_error("The statement lines could not be read", error))?;
    let parameter = rusqlite::params_from_iter(values.iter().map(|value| value.as_ref()));
    let rows = statement
        .query_map(parameter, statement_line_from_row)
        .map_err(|error| db_error("The statement lines could not be read", error))?;
    let mut lines = Vec::new();
    for line in rows {
        lines.push(line.map_err(|error| db_error("A statement line is unreadable", error))?);
    }
    Ok(lines)
}

fn statement_line_from_row(row: &Row<'_>) -> rusqlite::Result<StatementLine> {
    Ok(StatementLine {
        id: row.get(0)?,
        company_id: row.get(1)?,
        ledger_id: row.get(2)?,
        date: row.get(3)?,
        description: row.get(4)?,
        reference: row.get(5)?,
        amount: row.get(6)?,
        matched_voucher_id: row.get(7)?,
        confidence: row.get(8)?,
        match_reason: row.get(9)?,
        is_reconciled: bool_from_int(row.get(10)?),
    })
}

#[tauri::command]
pub fn list_statement_lines_cmd(
    workspace: State<'_, Workspace>,
    company_id: String,
    ledger_id: Option<String>,
    reconciled: Option<bool>,
) -> Result<Vec<StatementLine>, String> {
    workspace.with_database(|db| list_statement_lines(db, &company_id, ledger_id.as_deref(), reconciled))
}

pub fn reconcile_statement_line(
    database: &Database,
    company_id: &str,
    line_id: &str,
    voucher_id: Option<&str>,
) -> Result<StatementLine, String> {
    database.transaction(|transaction| {
    let reason = match voucher_id {
        Some(_) => "Confirmed by the user against the selected voucher.",
        None => "Unmatched: the line was marked as a book entry to create.",
    };
    transaction
        .execute(
            "UPDATE statement_lines
             SET matched_voucher_id = ?1,
                 is_reconciled = ?2,
                 confidence = ?3,
                 match_reason = ?4
             WHERE id = ?5 AND company_id = ?6",
            params![
                voucher_id,
                int_from_bool(voucher_id.is_some()),
                if voucher_id.is_some() { 1.0 } else { 0.0 },
                reason,
                line_id,
                company_id
            ],
        )
        .map_err(|error| db_error("The statement line could not be reconciled", error))?;

    let line = transaction
        .query_row(
            "SELECT id, company_id, ledger_id, date, description, reference, amount,
                    matched_voucher_id, confidence, match_reason, is_reconciled
             FROM statement_lines WHERE id = ?1 AND company_id = ?2",
            params![line_id, company_id],
            statement_line_from_row,
        )
        .map_err(|error| db_error("The statement line could not be read back", error))?;
    Ok(line)

    })
}

#[tauri::command]
pub fn reconcile_statement_line_cmd(
    workspace: State<'_, Workspace>,
    company_id: String,
    line_id: String,
    voucher_id: Option<String>,
) -> Result<StatementLine, String> {
    workspace.with_database(|db| reconcile_statement_line(db, &company_id, &line_id, voucher_id.as_deref()))
}

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

pub fn list_audit_events(
    database: &Database,
    company_id: &str,
    filters: &AuditFilters,
) -> Result<Vec<AuditEvent>, String> {
    let connection = database.lock();
    let mut sql = String::from(
        "SELECT id, company_id, actor, action, record_type, record_id, record_label, timestamp, detail
         FROM audit_events WHERE company_id = ?1",
    );
    let mut values: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(company_id.to_string())];

    if let Some(from) = &filters.from {
        values.push(Box::new(from.clone()));
        sql.push_str(&format!(" AND timestamp >= ?{}", values.len()));
    }
    if let Some(to) = &filters.to {
        values.push(Box::new(to.clone()));
        sql.push_str(&format!(" AND timestamp <= ?{}", values.len()));
    }
    if let Some(actor) = &filters.actor {
        if !actor.is_empty() {
            values.push(Box::new(actor.clone()));
            sql.push_str(&format!(" AND actor = ?{}", values.len()));
        }
    }
    if let Some(action) = &filters.action {
        if !action.is_empty() {
            values.push(Box::new(action.clone()));
            sql.push_str(&format!(" AND action = ?{}", values.len()));
        }
    }
    if let Some(record_type) = &filters.record_type {
        if !record_type.is_empty() {
            values.push(Box::new(record_type.clone()));
            sql.push_str(&format!(" AND record_type = ?{}", values.len()));
        }
    }
    sql.push_str(" ORDER BY timestamp DESC, id DESC");

    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| db_error("The audit trail could not be read", error))?;
    let parameter = rusqlite::params_from_iter(values.iter().map(|value| value.as_ref()));
    let rows = statement
        .query_map(parameter, |row| {
            Ok(AuditEvent {
                id: row.get(0)?,
                company_id: row.get(1)?,
                actor: row.get(2)?,
                action: row.get(3)?,
                record_type: row.get(4)?,
                record_id: row.get(5)?,
                record_label: row.get(6)?,
                timestamp: row.get(7)?,
                detail: row.get(8)?,
            })
        })
        .map_err(|error| db_error("The audit trail could not be read", error))?;
    let mut events = Vec::new();
    for event in rows {
        events.push(event.map_err(|error| db_error("An audit event is unreadable", error))?);
    }
    Ok(events)
}

#[tauri::command]
pub fn list_audit_events_cmd(
    workspace: State<'_, Workspace>,
    company_id: String,
    filters: Option<AuditFilters>,
) -> Result<Vec<AuditEvent>, String> {
    workspace.with_database(|db| list_audit_events(db, &company_id, &filters.unwrap_or_default()))
}

// ---------------------------------------------------------------------------
// Seeding a workspace from the demo dataset
// ---------------------------------------------------------------------------

/// Write a complete set of records in one transaction.
///
/// Used to open the sample workspace in the local database, and to restore a
/// company from an export. Either everything lands or nothing does.
#[tauri::command]
pub fn seed_workspace(
    workspace: State<'_, Workspace>,
    company: Company,
    financial_years: Vec<FinancialYear>,
    ledgers: Vec<Ledger>,
    items: Vec<Item>,
    tax_categories: Vec<TaxCategory>,
    stock_groups: Vec<StockGroup>,
    units: Vec<Unit>,
    godowns: Vec<Godown>,
    cost_centres: Vec<CostCentre>,
    employees: Vec<Employee>,
    currencies: Vec<Currency>,
    price_lists: Vec<PriceList>,
    price_list_entries: Vec<PriceListEntry>,
    payment_terms: Vec<PaymentTerm>,
    vouchers: Vec<Voucher>,
    stock_movements: Vec<StockMovementRecord>,
    orders: Vec<Order>,
    order_lines: Vec<OrderLine>,
    order_fulfilments: Vec<OrderFulfilment>,
    order_revisions: Vec<OrderRevision>,
    order_revision_lines: Vec<OrderRevisionLine>,
    boms: Vec<Bom>,
    bom_lines: Vec<BomLine>,
    production_orders: Vec<ProductionOrder>,
    production_requirements: Vec<ProductionRequirement>,
    production_issues: Vec<ProductionIssue>,
    production_completions: Vec<ProductionCompletion>,
    inventory_accounts: Vec<InventoryAccounts>,
    statement_lines: Vec<StatementLine>,
    audit_events: Vec<AuditEvent>,
) -> Result<(), String> {
    workspace.with_database(|database| {
        database.transaction(|transaction| {
        insert_company_rows(transaction, &company)?;
        for year in &financial_years {
            insert_financial_year_row(transaction, year)?;
        }
        for ledger in &ledgers {
            insert_ledger_row(transaction, ledger)?;
        }
        for group in &stock_groups {
            transaction
                .execute(
                    "INSERT INTO stock_groups (id, company_id, name, parent_id) VALUES (?1, ?2, ?3, ?4)",
                    params![group.id, group.company_id, group.name, group.parent_id],
                )
                .map_err(|error| db_error("A stock group could not be written", error))?;
        }
        for unit in &units {
            transaction
                .execute(
                    "INSERT INTO units (id, company_id, name, decimal_places) VALUES (?1, ?2, ?3, ?4)",
                    params![unit.id, unit.company_id, unit.name, unit.decimal_places],
                )
                .map_err(|error| db_error("A unit could not be written", error))?;
        }
        for godown in &godowns {
            transaction
                .execute(
                    "INSERT INTO godowns (id, company_id, name, location) VALUES (?1, ?2, ?3, ?4)",
                    params![godown.id, godown.company_id, godown.name, godown.location],
                )
                .map_err(|error| db_error("A godown could not be written", error))?;
        }
        for tax in &tax_categories {
            insert_tax_category_row(transaction, tax)?;
        }
        for item in &items {
            insert_item_row(transaction, item)?;
        }
        for centre in &cost_centres {
            transaction
                .execute(
                    "INSERT INTO cost_centres (id, company_id, name, parent_id, is_active)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![
                        centre.id,
                        centre.company_id,
                        centre.name,
                        centre.parent_id,
                        int_from_bool(centre.is_active)
                    ],
                )
                .map_err(|error| db_error("A cost centre could not be written", error))?;
        }
        for employee in &employees {
            transaction
                .execute(
                    "INSERT INTO employees (id, company_id, name, code, department, designation,
                        date_of_joining, monthly_gross, is_active)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    params![
                        employee.id,
                        employee.company_id,
                        employee.name,
                        employee.code,
                        employee.department,
                        employee.designation,
                        employee.date_of_joining,
                        employee.monthly_gross,
                        int_from_bool(employee.is_active)
                    ],
                )
                .map_err(|error| db_error("An employee could not be written", error))?;
        }
        for currency in &currencies {
            transaction
                .execute(
                    "INSERT INTO currencies (id, company_id, code, name, rate, symbol)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![
                        currency.id,
                        currency.company_id,
                        currency.code,
                        currency.name,
                        currency.rate,
                        currency.symbol
                    ],
                )
                .map_err(|error| db_error("A currency could not be written", error))?;
        }
        for list in &price_lists {
            transaction
                .execute(
                    "INSERT INTO price_lists (id, company_id, name, is_default) VALUES (?1, ?2, ?3, ?4)",
                    params![list.id, list.company_id, list.name, int_from_bool(list.is_default)],
                )
                .map_err(|error| db_error("A price list could not be written", error))?;
        }
        for entry in &price_list_entries {
            transaction
                .execute(
                    "INSERT INTO price_list_entries (price_list_id, item_id, company_id, rate)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![entry.price_list_id, entry.item_id, company.id, entry.rate],
                )
                .map_err(|error| db_error("A price list entry could not be written", error))?;
        }
        for term in &payment_terms {
            transaction
                .execute(
                    "INSERT INTO payment_terms (id, company_id, name, days) VALUES (?1, ?2, ?3, ?4)",
                    params![term.id, term.company_id, term.name, term.days],
                )
                .map_err(|error| db_error("A payment term could not be written", error))?;
        }
        for voucher in &vouchers {
            insert_voucher_rows(transaction, voucher)?;
        }
        // The orders, the structures and the production records of the sample
        // workspace, in the order their parents are written.
        for order in &orders {
            transaction
                .execute(
                    "INSERT INTO orders (id, company_id, kind, number, date, expected_date, party_id,
                        narration, reference, status, payment_term_id, revision, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                    params![
                        order.id,
                        order.company_id,
                        order.kind,
                        order.number,
                        order.date,
                        order.expected_date,
                        order.party_id,
                        order.narration,
                        order.reference,
                        order.status,
                        order.payment_term_id,
                        order.revision,
                        order.created_at,
                        order.updated_at,
                    ],
                )
                .map_err(|error| db_error("An order could not be written", error))?;
        }
        for line in &order_lines {
            transaction
                .execute(
                    "INSERT INTO order_lines (id, company_id, order_id, item_id, quantity_milli, rate,
                        discount, tax_category_id, amount)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    params![
                        line.id,
                        line.company_id,
                        line.order_id,
                        line.item_id,
                        line.quantity_milli,
                        line.rate,
                        line.discount,
                        line.tax_category_id,
                        line.amount,
                    ],
                )
                .map_err(|error| db_error("An order line could not be written", error))?;
        }
        for fulfilment in &order_fulfilments {
            transaction
                .execute(
                    "INSERT INTO order_fulfilments (id, company_id, order_id, order_line_id, voucher_id,
                        voucher_item_id, quantity_milli, amount, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    params![
                        fulfilment.id,
                        fulfilment.company_id,
                        fulfilment.order_id,
                        fulfilment.order_line_id,
                        fulfilment.voucher_id,
                        fulfilment.voucher_item_id,
                        fulfilment.quantity_milli,
                        fulfilment.amount,
                        fulfilment.created_at,
                    ],
                )
                .map_err(|error| db_error("An order delivery could not be written", error))?;
        }
        for revision in &order_revisions {
            transaction
                .execute(
                    "INSERT INTO order_revisions (id, company_id, order_id, revision, reason, actor,
                        created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        revision.id,
                        revision.company_id,
                        revision.order_id,
                        revision.revision,
                        revision.reason,
                        revision.actor,
                        revision.created_at,
                    ],
                )
                .map_err(|error| db_error("An order revision could not be written", error))?;
        }
        for line in &order_revision_lines {
            transaction
                .execute(
                    "INSERT INTO order_revision_lines (id, company_id, revision_id, order_line_id, item_id,
                        quantity_milli, rate, discount, tax_category_id, amount)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    params![
                        line.id,
                        line.company_id,
                        line.revision_id,
                        line.order_line_id,
                        line.item_id,
                        line.quantity_milli,
                        line.rate,
                        line.discount,
                        line.tax_category_id,
                        line.amount,
                    ],
                )
                .map_err(|error| db_error("An order revision line could not be written", error))?;
        }
        for bom in &boms {
            transaction
                .execute(
                    "INSERT INTO boms (id, company_id, item_id, version, output_quantity_milli, status,
                        effective_from, narration, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    params![
                        bom.id,
                        bom.company_id,
                        bom.item_id,
                        bom.version,
                        bom.output_quantity_milli,
                        bom.status,
                        bom.effective_from,
                        bom.narration,
                        bom.created_at,
                        bom.updated_at,
                    ],
                )
                .map_err(|error| db_error("A structure could not be written", error))?;
        }
        for line in &bom_lines {
            transaction
                .execute(
                    "INSERT INTO bom_lines (id, company_id, bom_id, item_id, quantity_milli,
                        conversion_milli, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        line.id,
                        line.company_id,
                        line.bom_id,
                        line.item_id,
                        line.quantity_milli,
                        line.conversion_milli,
                        line.created_at,
                    ],
                )
                .map_err(|error| db_error("A structure line could not be written", error))?;
        }
        for order in &production_orders {
            transaction
                .execute(
                    "INSERT INTO production_orders (id, company_id, number, item_id, bom_id, bom_version,
                        planned_quantity_milli, status, godown_id, planned_at, narration, revision,
                        created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                    params![
                        order.id,
                        order.company_id,
                        order.number,
                        order.item_id,
                        order.bom_id,
                        order.bom_version,
                        order.planned_quantity_milli,
                        order.status,
                        order.godown_id,
                        order.planned_at,
                        order.narration,
                        order.revision,
                        order.created_at,
                        order.updated_at,
                    ],
                )
                .map_err(|error| db_error("A production order could not be written", error))?;
        }
        for requirement in &production_requirements {
            transaction
                .execute(
                    "INSERT INTO production_requirements (id, company_id, production_order_id, item_id,
                        requirement_quantity_milli, conversion_milli, required_quantity_milli,
                        issued_quantity_milli, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    params![
                        requirement.id,
                        requirement.company_id,
                        requirement.production_order_id,
                        requirement.item_id,
                        requirement.requirement_quantity_milli,
                        requirement.conversion_milli,
                        requirement.required_quantity_milli,
                        requirement.issued_quantity_milli,
                        requirement.created_at,
                    ],
                )
                .map_err(|error| db_error("A production requirement could not be written", error))?;
        }
        for issue in &production_issues {
            transaction
                .execute(
                    "INSERT INTO production_issues (id, company_id, production_order_id, requirement_id,
                        item_id, godown_id, quantity_milli, rate, cost, voucher_id, voucher_item_id,
                        created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                    params![
                        issue.id,
                        issue.company_id,
                        issue.production_order_id,
                        issue.requirement_id,
                        issue.item_id,
                        issue.godown_id,
                        issue.quantity_milli,
                        issue.rate,
                        issue.cost,
                        issue.voucher_id,
                        issue.voucher_item_id,
                        issue.created_at,
                    ],
                )
                .map_err(|error| db_error("A production issue could not be written", error))?;
        }
        for completion in &production_completions {
            transaction
                .execute(
                    "INSERT INTO production_completions (id, company_id, production_order_id, item_id,
                        godown_id, quantity_milli, rate, cost, voucher_id, voucher_item_id, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                    params![
                        completion.id,
                        completion.company_id,
                        completion.production_order_id,
                        completion.item_id,
                        completion.godown_id,
                        completion.quantity_milli,
                        completion.rate,
                        completion.cost,
                        completion.voucher_id,
                        completion.voucher_item_id,
                        completion.created_at,
                    ],
                )
                .map_err(|error| db_error("A production completion could not be written", error))?;
        }
        for (index, movement) in stock_movements.iter().enumerate() {
            // The quantity column that the earlier version used is signed and
            // counted in units; the authoritative quantity is the milli-unit
            // column beside it.
            let signed_quantity_milli = if movement.direction == "out" {
                -movement.quantity_milli
            } else {
                movement.quantity_milli
            };
            transaction
                .execute(
                    "INSERT INTO stock_movements (id, company_id, voucher_id, voucher_number, date,
                        item_id, godown_id, quantity, rate, value, voucher_item_id, movement_type,
                        sequence_no, quantity_milli, cost, valuation_method, resulting_quantity_milli,
                        resulting_carrying_value, reverses_movement_id, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, (?8 * 1.0) / 1000.0, ?9, ?10, ?11, ?12,
                        ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)",
                    params![
                        movement.id,
                        movement.company_id,
                        movement.voucher_id,
                        movement.voucher_number,
                        movement.date,
                        movement.item_id,
                        movement.godown_id,
                        signed_quantity_milli,
                        movement.rate,
                        movement.value,
                        movement.voucher_item_id,
                        movement.movement_type,
                        (index + 1) as i64,
                        movement.quantity_milli,
                        movement.cost,
                        movement.valuation_method,
                        movement.resulting_quantity_milli,
                        movement.resulting_carrying_value,
                        movement.reverses_movement_id,
                        movement.created_at,
                    ],
                )
                .map_err(|error| db_error("A stock movement could not be written", error))?;
        }

        // The inventory accounts of the company, so the seeded books are read
        // as a company that has inventory in force rather than one whose
        // movements exist without an owner.
        for accounts in &inventory_accounts {
            transaction
                .execute(
                    "INSERT INTO inventory_accounts (
                        id, company_id, inventory_ledger_id, cogs_ledger_id, variance_ledger_id,
                        purchases_ledger_id, valuation_method, input_tax_recoverable, activated_at,
                        created_at
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    params![
                        accounts.id,
                        accounts.company_id,
                        accounts.inventory_ledger_id,
                        accounts.cogs_ledger_id,
                        accounts.variance_ledger_id,
                        accounts.purchases_ledger_id,
                        accounts.valuation_method,
                        i64::from(accounts.input_tax_recoverable),
                        accounts.activated_at,
                        accounts.created_at,
                    ],
                )
                .map_err(|error| db_error("The inventory accounts could not be written", error))?;
        }

        // The costing pools and the location balances the seeded movements
        // imply, so the stored projection agrees with the movement ledger.
        let (seeded_pools, seeded_locations) = replay_movements(&stock_movements);        for pool in &seeded_pools {
            transaction
                .execute(
                    "INSERT INTO stock_pools (company_id, item_id, quantity_milli, carrying_value,
                        revision, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![
                        pool.company_id,
                        pool.item_id,
                        pool.quantity_milli,
                        pool.carrying_value,
                        1,
                        pool.updated_at,
                    ],
                )
                .map_err(|error| db_error("A costing pool could not be written", error))?;
        }
        for location in &seeded_locations {
            transaction
                .execute(
                    "INSERT INTO stock_balances (company_id, item_id, godown_id, quantity_milli,
                        revision, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![
                        location.company_id,
                        location.item_id,
                        location.godown_id,
                        location.quantity_milli,
                        1,
                        location.updated_at,
                    ],
                )
                .map_err(|error| db_error("A location balance could not be written", error))?;
        }
        for line in &statement_lines {
            transaction
                .execute(
                    "INSERT INTO statement_lines (id, company_id, ledger_id, date, description,
                        reference, amount, matched_voucher_id, confidence, match_reason, is_reconciled)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                    params![
                        line.id,
                        line.company_id,
                        line.ledger_id,
                        line.date,
                        line.description,
                        line.reference,
                        line.amount,
                        line.matched_voucher_id,
                        line.confidence,
                        line.match_reason,
                        int_from_bool(line.is_reconciled)
                    ],
                )
                .map_err(|error| db_error("A statement line could not be written", error))?;
        }
        for event in &audit_events {
            transaction
                .execute(
                    "INSERT INTO audit_events (id, company_id, actor, action, record_type, record_id,
                        record_label, timestamp, detail)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    params![
                        event.id,
                        event.company_id,
                        event.actor,
                        event.action,
                        event.record_type,
                        event.record_id,
                        event.record_label,
                        event.timestamp,
                        event.detail
                    ],
                )
                .map_err(|error| db_error("An audit event could not be written", error))?;
        }
        Ok(())

        })
    })
}

fn insert_company_rows(transaction: &Transaction<'_>, company: &Company) -> Result<(), String> {
    transaction
        .execute(
            "INSERT INTO companies (id, name, legal_name, country, state, base_currency,
                fiscal_year_start, fiscal_year_end, gstin, pan, address, phone, email,
                industry, is_demo, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
            params![
                company.id,
                company.name,
                company.legal_name,
                company.country,
                company.state,
                company.base_currency,
                company.fiscal_year_start,
                company.fiscal_year_end,
                company.gstin,
                company.pan,
                company.address,
                company.phone,
                company.email,
                company.industry,
                int_from_bool(company.is_demo),
                company.created_at
            ],
        )
        .map_err(|error| db_error("The company could not be written", error))?;
    Ok(())
}

fn insert_financial_year_row(
    transaction: &Transaction<'_>,
    year: &FinancialYear,
) -> Result<(), String> {
    transaction
        .execute(
            "INSERT INTO financial_years (id, company_id, label, start_date, end_date, is_closed)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![year.id, year.company_id, year.label, year.start, year.end, int_from_bool(year.is_closed)],
        )
        .map_err(|error| db_error("A financial year could not be written", error))?;
    Ok(())
}

fn insert_ledger_row(transaction: &Transaction<'_>, ledger: &Ledger) -> Result<(), String> {
    transaction
        .execute(
            "INSERT INTO ledgers (id, company_id, name, group_name, kind, parent_id, opening_balance,
                opening_date, party_kind, currency, tax_number, email, phone, address,
                is_system, is_active, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
            params![
                ledger.id,
                ledger.company_id,
                ledger.name,
                ledger.group_name,
                ledger.kind,
                ledger.parent_id,
                ledger.opening_balance,
                ledger.opening_date,
                ledger.party_kind,
                ledger.currency,
                ledger.tax_number,
                ledger.email,
                ledger.phone,
                ledger.address,
                int_from_bool(ledger.is_system),
                int_from_bool(ledger.is_active),
                ledger.created_at
            ],
        )
        .map_err(|error| db_error("A ledger could not be written", error))?;
    Ok(())
}

fn insert_item_row(transaction: &Transaction<'_>, item: &Item) -> Result<(), String> {
    transaction
        .execute(
            "INSERT INTO items (id, company_id, name, stock_group_id, unit_id, is_inventory,
                is_service, purchase_price, sales_price, hsn, tax_category_id, opening_quantity,
                opening_value, reorder_level, is_active, created_at, opening_quantity_milli,
                reorder_level_milli)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16,
                ?17, ?18)",
            params![
                item.id,
                item.company_id,
                item.name,
                item.stock_group_id,
                item.unit_id,
                int_from_bool(item.is_inventory),
                int_from_bool(item.is_service),
                item.purchase_price,
                item.sales_price,
                item.hsn,
                item.tax_category_id,
                round_quantity(item.opening_quantity_milli as f64 / 1000.0),
                item.opening_value,
                round_quantity(item.reorder_level_milli as f64 / 1000.0),
                int_from_bool(item.is_active),
                item.created_at,
                item.opening_quantity_milli,
                item.reorder_level_milli,
            ],
        )
        .map_err(|error| db_error("An item could not be written", error))?;
    Ok(())
}

fn insert_tax_category_row(
    transaction: &Transaction<'_>,
    tax: &TaxCategory,
) -> Result<(), String> {
    transaction
        .execute(
            "INSERT INTO tax_categories (id, company_id, name, rate, kind, hsn, ledger_id,
                input_ledger_id, is_active)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                tax.id,
                tax.company_id,
                tax.name,
                tax.rate,
                tax.kind,
                tax.hsn,
                tax.ledger_id,
                tax.input_ledger_id,
                int_from_bool(tax.is_active)
            ],
        )
        .map_err(|error| db_error("A tax category could not be written", error))?;
    Ok(())
}

fn insert_voucher_rows(transaction: &Transaction<'_>, voucher: &Voucher) -> Result<(), String> {
    insert_voucher_header(transaction, voucher)?;
    for entry in &voucher.entries {
        transaction
            .execute(
                "INSERT INTO voucher_entries (id, voucher_id, company_id, ledger_id, debit, credit,
                    narration, cost_centre_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    entry.id,
                    voucher.id,
                    voucher.company_id,
                    entry.ledger_id,
                    entry.debit,
                    entry.credit,
                    entry.narration,
                    entry.cost_centre_id
                ],
            )
            .map_err(|error| db_error("A voucher entry could not be written", error))?;
    }
    for item in &voucher.items {
        transaction
            .execute(
                "INSERT INTO voucher_items (id, voucher_id, company_id, item_id, quantity, rate,
                    discount, tax_category_id, amount, godown_id, batch, quantity_milli,
                    direct_cost, to_godown_id, order_line_id, production_requirement_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
                params![
                    item.id,
                    voucher.id,
                    voucher.company_id,
                    item.item_id,
                    round_quantity(item.quantity_milli as f64 / 1000.0),
                    item.rate,
                    item.discount,
                    item.tax_category_id,
                    item.amount,
                    item.godown_id,
                    item.batch,
                    item.quantity_milli,
                    item.direct_cost,
                    item.to_godown_id,
                    item.order_line_id,
                    item.production_requirement_id,
                ],
            )
            .map_err(|error| db_error("A voucher item line could not be written", error))?;
    }
    for tax in &voucher.taxes {
        transaction
            .execute(
                "INSERT INTO voucher_taxes (id, voucher_id, company_id, tax_category_id, taxable, amount)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    tax.id,
                    voucher.id,
                    voucher.company_id,
                    tax.tax_category_id,
                    tax.taxable,
                    tax.amount
                ],
            )
            .map_err(|error| db_error("A voucher tax line could not be written", error))?;
    }
    Ok(())
}

fn insert_voucher_header(
    transaction: &Transaction<'_>,
    voucher: &Voucher,
) -> Result<(), String> {
    transaction
        .execute(
            "INSERT INTO vouchers (id, company_id, kind, number, date, due_date, payment_term_id,
                party_id, narration, reference, status, linked_voucher_id,
                reversed_by_voucher_id, is_locked, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
            params![
                voucher.id,
                voucher.company_id,
                voucher.kind,
                voucher.number,
                voucher.date,
                voucher.due_date,
                voucher.payment_term_id,
                voucher.party_id,
                voucher.narration,
                voucher.reference,
                voucher.status,
                voucher.linked_voucher_id,
                voucher.reversed_by_voucher_id,
                int_from_bool(voucher.is_locked),
                voucher.created_at,
                voucher.updated_at
            ],
        )
        .map_err(|error| db_error("The voucher could not be written", error))?;
    Ok(())
}

/// Used by the backup restore path to write rows without the command layer.
pub fn write_company(
    transaction: &Transaction<'_>,
    company: &Company,
) -> Result<(), String> {
    insert_company_rows(transaction, company)
}

// ---------------------------------------------------------------------------
// Posting a voucher
// ---------------------------------------------------------------------------

/// Post a voucher and everything it implies, in one transaction.
///
/// The voucher, its entry lines, its item and tax lines, the bill-wise
/// allocations it settles and the audit event are committed together. If any
/// part fails, none of it is written, so a business event is never half
/// recorded.
pub fn post_voucher(
    database: &Database,
    payload: PostingPayload,
) -> Result<Voucher, String> {
    if payload.voucher.status != "posted" {
        return Err("Only a posted voucher can be posted.".to_string());
    }
    write_posting(database, payload)
}

/// Cancel a voucher and release the allocations it held.
///
/// The voucher's financial effect is withdrawn and the allocations of the
/// affected party are recomputed, so the outstanding balances of the other
/// invoices are restored.
pub fn cancel_voucher(
    database: &Database,
    payload: PostingPayload,
) -> Result<Voucher, String> {
    if payload.voucher.status != "cancelled" {
        return Err("Only a cancelled voucher can be cancelled.".to_string());
    }
    write_posting(database, payload)
}

/// The write path shared by posting and cancelling.
fn write_posting(database: &Database, payload: PostingPayload) -> Result<Voucher, String> {
    let voucher = &payload.voucher;

    if payload.entries.is_empty() {
        return Err("A posted voucher must have at least one entry line.".to_string());
    }

    let mut debit: i64 = 0;
    let mut credit: i64 = 0;
    for entry in &payload.entries {
        check_money(entry.debit, "Debit amount")?;
        check_money(entry.credit, "Credit amount")?;
        if entry.debit < 0 || entry.credit < 0 {
            return Err("Entry amounts cannot be negative.".to_string());
        }
        if entry.debit > 0 && entry.credit > 0 {
            return Err("An entry cannot be both a debit and a credit.".to_string());
        }
        debit += entry.debit;
        credit += entry.credit;
    }
    if debit != credit {
        return Err(format!(
            "A posted voucher must balance. The debits are {debit} and the credits are {credit}."
        ));
    }
    for item in &payload.items {
        check_money(item.rate, "Rate")?;
        check_money(item.discount, "Discount")?;
        check_money(item.amount, "Line amount")?;
    }
    for tax in &payload.taxes {
        check_money(tax.taxable, "Taxable amount")?;
        check_money(tax.amount, "Tax amount")?;
    }
    for allocation in &payload.allocations {
        check_money(allocation.amount, "Allocated amount")?;
        if allocation.amount <= 0 {
            return Err("An allocation must have a positive amount.".to_string());
        }
    }
    for advance in &payload.advances {
        check_money(advance.amount, "Advance amount")?;
    }
    for fulfilment in &payload.order_fulfilments {
        check_quantity(fulfilment.quantity_milli, "The fulfilled quantity")?;
        check_money(fulfilment.amount, "The fulfilled amount")?;
    }
    for issue in &payload.production_issues {
        check_quantity(issue.quantity_milli, "The issued quantity")?;
        check_money(issue.rate, "The issue rate")?;
        check_money(issue.cost, "The issue cost")?;
    }
    for completion in &payload.production_completions {
        check_quantity(completion.quantity_milli, "The received quantity")?;
        check_money(completion.rate, "The receipt rate")?;
        check_money(completion.cost, "The production cost")?;
    }

    database.transaction(|transaction| {
        ensure_company(transaction, &voucher.company_id)?;

        // The voucher and its lines.
        transaction
            .execute(
                "INSERT INTO vouchers (id, company_id, kind, number, date, due_date, payment_term_id,
                    party_id, narration, reference, status, linked_voucher_id,
                    reversed_by_voucher_id, is_locked, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
                 ON CONFLICT(id) DO UPDATE SET
                    kind = excluded.kind,
                    number = excluded.number,
                    date = excluded.date,
                    due_date = excluded.due_date,
                    payment_term_id = excluded.payment_term_id,
                    party_id = excluded.party_id,
                    narration = excluded.narration,
                    reference = excluded.reference,
                    status = excluded.status,
                    linked_voucher_id = excluded.linked_voucher_id,
                    reversed_by_voucher_id = excluded.reversed_by_voucher_id,
                    is_locked = excluded.is_locked,
                    updated_at = excluded.updated_at",
                params![
                    voucher.id,
                    voucher.company_id,
                    voucher.kind,
                    voucher.number,
                    voucher.date,
                    voucher.due_date,
                    voucher.payment_term_id,
                    voucher.party_id,
                    voucher.narration,
                    voucher.reference,
                    voucher.status,
                    voucher.linked_voucher_id,
                    voucher.reversed_by_voucher_id,
                    int_from_bool(voucher.is_locked),
                    voucher.created_at,
                    voucher.updated_at,
                ],
            )
            .map_err(|error| db_error("The voucher could not be posted", error))?;

        transaction
            .execute(
                "DELETE FROM voucher_entries WHERE voucher_id = ?1 AND company_id = ?2",
                params![voucher.id, voucher.company_id],
            )
            .map_err(|error| db_error("The voucher entries could not be replaced", error))?;
        transaction
            .execute(
                "DELETE FROM voucher_items WHERE voucher_id = ?1 AND company_id = ?2",
                params![voucher.id, voucher.company_id],
            )
            .map_err(|error| db_error("The voucher item lines could not be replaced", error))?;
        transaction
            .execute(
                "DELETE FROM voucher_taxes WHERE voucher_id = ?1 AND company_id = ?2",
                params![voucher.id, voucher.company_id],
            )
            .map_err(|error| db_error("The voucher tax lines could not be replaced", error))?;

        for entry in &payload.entries {
            transaction
                .execute(
                    "INSERT INTO voucher_entries (id, voucher_id, company_id, ledger_id, debit,
                        credit, narration, cost_centre_id)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![
                        entry.id,
                        voucher.id,
                        voucher.company_id,
                        entry.ledger_id,
                        entry.debit,
                        entry.credit,
                        entry.narration,
                        entry.cost_centre_id
                    ],
                )
                .map_err(|error| {
                    db_error("A voucher entry could not be saved. Nothing was posted.", error)
                })?;
        }

        for item in &payload.items {
            transaction
                .execute(
                    "INSERT INTO voucher_items (id, voucher_id, company_id, item_id, quantity, rate,
                        discount, tax_category_id, amount, godown_id, batch, quantity_milli,
                        direct_cost, to_godown_id, order_line_id, production_requirement_id)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
                    params![
                        item.id,
                        voucher.id,
                        voucher.company_id,
                        item.item_id,
                        round_quantity(item.quantity_milli as f64 / 1000.0),
                        item.rate,
                        item.discount,
                        item.tax_category_id,
                        item.amount,
                        item.godown_id,
                        item.batch,
                        item.quantity_milli,
                        item.direct_cost,
                        item.to_godown_id,
                        item.order_line_id,
                        item.production_requirement_id,
                    ],
                )
                .map_err(|error| {
                    db_error("A voucher item line could not be saved. Nothing was posted.", error)
                })?;
        }

        for tax in &payload.taxes {
            transaction
                .execute(
                    "INSERT INTO voucher_taxes (id, voucher_id, company_id, tax_category_id, taxable, amount)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![
                        tax.id,
                        voucher.id,
                        voucher.company_id,
                        tax.tax_category_id,
                        tax.taxable,
                        tax.amount
                    ],
                )
                .map_err(|error| {
                    db_error("A voucher tax line could not be saved. Nothing was posted.", error)
                })?;
        }

        // The stock movements, the costing pools and the location balances
        // the voucher causes. They are part of the same operation, so they
        // commit and roll back with the voucher.
        write_stock(
            transaction,
            voucher,
            &payload.movements,
            &payload.stock_pools,
            &payload.stock_locations,
        )?;

        // The order lines this voucher delivers against, the components it
        // issues against production orders and the finished goods it receives.
        // They are part of the same operation, so they commit and roll back
        // with the voucher: an invoice can never exist without the delivery
        // it records.
        write_order_fulfilments(transaction, voucher, &payload.order_fulfilments)?;
        write_production_issues(transaction, voucher, &payload.production_issues)?;
        write_production_completions(transaction, voucher, &payload.production_completions)?;

        // The allocations of the affected parties are replaced wholesale, so
        // the stored records always match the vouchers they came from.
        for party_id in &payload.affected_party_ids {
            transaction
                .execute(
                    "DELETE FROM payment_allocations WHERE company_id = ?1 AND party_id = ?2",
                    params![voucher.company_id, party_id],
                )
                .map_err(|error| db_error("The allocations could not be replaced", error))?;
            transaction
                .execute(
                    "DELETE FROM advances WHERE company_id = ?1 AND party_id = ?2",
                    params![voucher.company_id, party_id],
                )
                .map_err(|error| db_error("The advances could not be replaced", error))?;
        }

        for allocation in &payload.allocations {
            transaction
                .execute(
                    "INSERT INTO payment_allocations (id, company_id, side, payment_voucher_id,
                        payment_entry_id, invoice_voucher_id, invoice_entry_id, party_id, amount,
                        created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    params![
                        allocation.id,
                        allocation.company_id,
                        allocation.side,
                        allocation.payment_voucher_id,
                        allocation.payment_entry_id,
                        allocation.invoice_voucher_id,
                        allocation.invoice_entry_id,
                        allocation.party_id,
                        allocation.amount,
                        allocation.created_at
                    ],
                )
                .map_err(|error| {
                    db_error("An allocation could not be saved. Nothing was posted.", error)
                })?;
        }

        for advance in &payload.advances {
            transaction
                .execute(
                    "INSERT INTO advances (id, company_id, side, voucher_id, entry_id, party_id, amount, date)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![
                        advance.id,
                        advance.company_id,
                        advance.side,
                        advance.voucher_id,
                        advance.entry_id,
                        advance.party_id,
                        advance.amount,
                        advance.date
                    ],
                )
                .map_err(|error| {
                    db_error("An advance could not be saved. Nothing was posted.", error)
                })?;
        }

        for event in &payload.audit_events {
            transaction
                .execute(
                    "INSERT INTO audit_events (id, company_id, actor, action, record_type, record_id,
                        record_label, timestamp, detail)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    params![
                        event.id,
                        event.company_id,
                        payload.actor.as_deref().unwrap_or("local.operator"),
                        event.action,
                        event.record_type,
                        event.record_id,
                        event.record_label,
                        event.timestamp,
                        event.detail
                    ],
                )
                .map_err(|error| db_error("The audit entry could not be written", error))?;
        }

        Ok(voucher.clone())
    })
}

#[tauri::command]
pub fn post_voucher_cmd(
    workspace: State<'_, Workspace>,
    payload: PostingPayload,
) -> Result<Voucher, String> {
    workspace.with_database(|db| post_voucher(db, payload))
}

#[tauri::command]
pub fn cancel_voucher_cmd(
    workspace: State<'_, Workspace>,
    payload: PostingPayload,
) -> Result<Voucher, String> {
    workspace.with_database(|db| cancel_voucher(db, payload))
}

/// The stored bill-wise allocations of a company.
pub fn list_allocations(
    database: &Database,
    company_id: &str,
) -> Result<Vec<AllocationRecord>, String> {
    let connection = database.lock();
    let mut statement = connection
        .prepare(
            "SELECT id, company_id, side, payment_voucher_id, payment_entry_id, invoice_voucher_id,
                    invoice_entry_id, party_id, amount, created_at
             FROM payment_allocations WHERE company_id = ?1 ORDER BY created_at, id",
        )
        .map_err(|error| db_error("The allocations could not be read", error))?;
    let rows = statement
        .query_map(params![company_id], |row| {
            Ok(AllocationRecord {
                id: row.get(0)?,
                company_id: row.get(1)?,
                side: row.get(2)?,
                payment_voucher_id: row.get(3)?,
                payment_entry_id: row.get(4)?,
                invoice_voucher_id: row.get(5)?,
                invoice_entry_id: row.get(6)?,
                party_id: row.get(7)?,
                amount: row.get(8)?,
                created_at: row.get(9)?,
            })
        })
        .map_err(|error| db_error("The allocations could not be read", error))?;
    let mut allocations = Vec::new();
    for allocation in rows {
        allocations.push(allocation.map_err(|error| db_error("An allocation is unreadable", error))?);
    }
    Ok(allocations)
}

#[tauri::command]
pub fn list_allocations_cmd(
    workspace: State<'_, Workspace>,
    company_id: String,
) -> Result<Vec<AllocationRecord>, String> {
    workspace.with_database(|db| list_allocations(db, &company_id))
}

/// Money received or paid that no invoice has settled yet.
pub fn list_advances(
    database: &Database,
    company_id: &str,
) -> Result<Vec<AdvanceRecord>, String> {
    let connection = database.lock();
    let mut statement = connection
        .prepare(
            "SELECT id, company_id, side, voucher_id, entry_id, party_id, amount, date
             FROM advances WHERE company_id = ?1 ORDER BY date, id",
        )
        .map_err(|error| db_error("The advances could not be read", error))?;
    let rows = statement
        .query_map(params![company_id], |row| {
            Ok(AdvanceRecord {
                id: row.get(0)?,
                company_id: row.get(1)?,
                side: row.get(2)?,
                voucher_id: row.get(3)?,
                entry_id: row.get(4)?,
                party_id: row.get(5)?,
                amount: row.get(6)?,
                date: row.get(7)?,
            })
        })
        .map_err(|error| db_error("The advances could not be read", error))?;
    let mut advances = Vec::new();
    for advance in rows {
        advances.push(advance.map_err(|error| db_error("An advance is unreadable", error))?);
    }
    Ok(advances)
}

#[tauri::command]
pub fn list_advances_cmd(
    workspace: State<'_, Workspace>,
    company_id: String,
) -> Result<Vec<AdvanceRecord>, String> {
    workspace.with_database(|db| list_advances(db, &company_id))
}

/// Update the profile of an existing company.
///
/// The identity of a company is not changed by this: the identifier, the
/// currency and the financial year stay as they are, so a posted record
/// always keeps the meaning it had when it was written.
pub fn update_company(database: &Database, company: Company) -> Result<Company, String> {
    database.transaction(|transaction| {
        ensure_company(transaction, &company.id)?;
        transaction
            .execute(
                "UPDATE companies SET name = ?2, legal_name = ?3, state = ?4, gstin = ?5, pan = ?6,
                    address = ?7, phone = ?8, email = ?9, industry = ?10
                 WHERE id = ?1",
                params![
                    company.id,
                    company.name,
                    company.legal_name,
                    company.state,
                    company.gstin,
                    company.pan,
                    company.address,
                    company.phone,
                    company.email,
                    company.industry
                ],
            )
            .map_err(|error| db_error("The company could not be updated", error))?;
        Ok(company)
    })
}

#[tauri::command]
pub fn update_company_cmd(
    workspace: State<'_, Workspace>,
    company: Company,
) -> Result<Company, String> {
    workspace.with_database(|db| update_company(db, company))
}

/// The voucher numbering in force for a company.
pub fn get_voucher_numbering(
    database: &Database,
    company_id: &str,
) -> Result<VoucherNumbering, String> {
    let connection = database.lock();
    let numbering = connection
        .query_row(
            "SELECT id, company_id, sales_prefix, purchase_prefix, payment_prefix, receipt_prefix,
                    contra_prefix, journal_prefix, credit_note_prefix, debit_note_prefix,
                    sales_order_prefix, purchase_order_prefix, padding, updated_at
             FROM voucher_numbering WHERE company_id = ?1",
            params![company_id],
            |row| {
                Ok(VoucherNumbering {
                    id: row.get(0)?,
                    company_id: row.get(1)?,
                    sales_prefix: row.get(2)?,
                    purchase_prefix: row.get(3)?,
                    payment_prefix: row.get(4)?,
                    receipt_prefix: row.get(5)?,
                    contra_prefix: row.get(6)?,
                    journal_prefix: row.get(7)?,
                    credit_note_prefix: row.get(8)?,
                    debit_note_prefix: row.get(9)?,
                    sales_order_prefix: row.get(10)?,
                    purchase_order_prefix: row.get(11)?,
                    padding: row.get(12)?,
                    updated_at: row.get(13)?,
                })
            },
        )
        .optional()
        .map_err(|error| db_error("The voucher numbering could not be read", error))?;

    match numbering {
        Some(numbering) => Ok(numbering),
        None => {
            let now = crate::migrations::now_iso();
            Ok(VoucherNumbering {
                id: format!("numbering-{company_id}"),
                company_id: company_id.to_string(),
                sales_prefix: "INV".into(),
                purchase_prefix: "PUR".into(),
                payment_prefix: "PAY".into(),
                receipt_prefix: "RCP".into(),
                contra_prefix: "CNT".into(),
                journal_prefix: "JNL".into(),
                credit_note_prefix: "CN".into(),
                debit_note_prefix: "DN".into(),
                sales_order_prefix: "SO".into(),
                purchase_order_prefix: "PO".into(),
                padding: 4,
                updated_at: now,
            })
        }
    }
}

#[tauri::command]
pub fn get_voucher_numbering_cmd(
    workspace: State<'_, Workspace>,
    company_id: String,
) -> Result<VoucherNumbering, String> {
    workspace.with_database(|db| get_voucher_numbering(db, &company_id))
}

/// Save the voucher numbering scheme of a company.
pub fn save_voucher_numbering(
    database: &Database,
    numbering: VoucherNumbering,
) -> Result<VoucherNumbering, String> {
    database.transaction(|transaction| {
        ensure_company(transaction, &numbering.company_id)?;
        transaction
            .execute(
                "INSERT INTO voucher_numbering (id, company_id, sales_prefix, purchase_prefix,
                    payment_prefix, receipt_prefix, contra_prefix, journal_prefix,
                    credit_note_prefix, debit_note_prefix, sales_order_prefix,
                    purchase_order_prefix, padding, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
                 ON CONFLICT(company_id) DO UPDATE SET
                    sales_prefix = excluded.sales_prefix,
                    purchase_prefix = excluded.purchase_prefix,
                    payment_prefix = excluded.payment_prefix,
                    receipt_prefix = excluded.receipt_prefix,
                    contra_prefix = excluded.contra_prefix,
                    journal_prefix = excluded.journal_prefix,
                    credit_note_prefix = excluded.credit_note_prefix,
                    debit_note_prefix = excluded.debit_note_prefix,
                    sales_order_prefix = excluded.sales_order_prefix,
                    purchase_order_prefix = excluded.purchase_order_prefix,
                    padding = excluded.padding,
                    updated_at = excluded.updated_at",
                params![
                    numbering.id,
                    numbering.company_id,
                    numbering.sales_prefix,
                    numbering.purchase_prefix,
                    numbering.payment_prefix,
                    numbering.receipt_prefix,
                    numbering.contra_prefix,
                    numbering.journal_prefix,
                    numbering.credit_note_prefix,
                    numbering.debit_note_prefix,
                    numbering.sales_order_prefix,
                    numbering.purchase_order_prefix,
                    numbering.padding,
                    numbering.updated_at
                ],
            )
            .map_err(|error| db_error("The voucher numbering could not be saved", error))?;
        Ok(numbering)
    })
}

#[tauri::command]
pub fn save_voucher_numbering_cmd(
    workspace: State<'_, Workspace>,
    numbering: VoucherNumbering,
) -> Result<VoucherNumbering, String> {
    workspace.with_database(|db| save_voucher_numbering(db, numbering))
}

// ---------------------------------------------------------------------------
// Inventory configuration, costing pools and location balances
// ---------------------------------------------------------------------------

/// The message a posting carries when its plan no longer matches the stored
/// stock: something else moved the stock while the voucher was being built.
pub const STOCK_CONFLICT_MESSAGE: &str =
    "The stock of this item changed while you were working. Reload and try again.";

/// The message a posting carries when a voucher line would produce the same
/// movement twice.
pub const STOCK_DUPLICATE_MESSAGE: &str =
    "This stock movement has already been recorded for this voucher line. Nothing was posted.";

/// The values of one list, without repeats.
fn unique_values(values: impl Iterator<Item = String>) -> Vec<String> {
    let mut unique: Vec<String> = Vec::new();
    for value in values {
        if !unique.contains(&value) {
            unique.push(value);
        }
    }
    unique
}

/// Refuse a quantity that cannot survive the boundary to JavaScript.
fn check_quantity(value: i64, field: &str) -> Result<(), String> {
    if value > MAX_MONEY_MINOR || value < -MAX_MONEY_MINOR {
        return Err(format!(
            "{field} is outside the supported range. The maximum quantity is {MAX_MONEY_MINOR} milli-units."
        ));
    }
    Ok(())
}

/// Every named item must belong to the company.
fn ensure_items_in_company(
    transaction: &Transaction<'_>,
    company_id: &str,
    item_ids: &[String],
) -> Result<(), String> {
    if item_ids.is_empty() {
        return Ok(());
    }
    let placeholders = vec!["?"; item_ids.len()].join(", ");
    let sql = format!("SELECT id FROM items WHERE company_id = ? AND id IN ({placeholders})");
    let mut statement = transaction
        .prepare(&sql)
        .map_err(|error| db_error("The items could not be read", error))?;
    let mut parameters: Vec<rusqlite::types::Value> = vec![company_id.to_string().into()];
    for item_id in item_ids {
        parameters.push(item_id.clone().into());
    }
    let rows = statement
        .query_map(rusqlite::params_from_iter(parameters), |row| {
            row.get::<_, String>(0)
        })
        .map_err(|error| db_error("The items could not be read", error))?;
    let mut found: Vec<String> = Vec::new();
    for row in rows {
        found.push(row.map_err(|error| db_error("An item is unreadable", error))?);
    }
    drop(statement);
    for item_id in item_ids {
        if !found.contains(item_id) {
            return Err(format!(
                "The item {item_id} does not belong to this company."
            ));
        }
    }
    Ok(())
}

/// Every named godown must belong to the company.
fn ensure_godowns_in_company(
    transaction: &Transaction<'_>,
    company_id: &str,
    godown_ids: &[String],
) -> Result<(), String> {
    if godown_ids.is_empty() {
        return Ok(());
    }
    let placeholders = vec!["?"; godown_ids.len()].join(", ");
    let sql = format!("SELECT id FROM godowns WHERE company_id = ? AND id IN ({placeholders})");
    let mut statement = transaction
        .prepare(&sql)
        .map_err(|error| db_error("The godowns could not be read", error))?;
    let mut parameters: Vec<rusqlite::types::Value> = vec![company_id.to_string().into()];
    for godown_id in godown_ids {
        parameters.push(godown_id.clone().into());
    }
    let rows = statement
        .query_map(rusqlite::params_from_iter(parameters), |row| {
            row.get::<_, String>(0)
        })
        .map_err(|error| db_error("The godowns could not be read", error))?;
    let mut found: Vec<String> = Vec::new();
    for row in rows {
        found.push(row.map_err(|error| db_error("A godown is unreadable", error))?);
    }
    drop(statement);
    for godown_id in godown_ids {
        if !found.contains(godown_id) {
            return Err(format!(
                "The godown {godown_id} does not belong to this company."
            ));
        }
    }
    Ok(())
}

/// A movement must name a real type, a real direction and a real quantity.
fn validate_movement(voucher: &Voucher, movement: &PlannedMovement) -> Result<(), String> {
    if movement.company_id != voucher.company_id {
        return Err("A stock movement must belong to the company of its voucher.".to_string());
    }
    if movement.voucher_id != voucher.id {
        return Err("A stock movement must belong to the voucher being posted.".to_string());
    }
    if !MOVEMENT_TYPES.contains(&movement.movement_type.as_str()) {
        return Err(format!(
            "'{}' is not a known type of stock movement.",
            movement.movement_type
        ));
    }
    if movement.direction != "in" && movement.direction != "out" {
        return Err("A stock movement must either bring stock in or take it out.".to_string());
    }
    if movement.direction != movement_direction(&movement.movement_type) {
        return Err(format!(
            "A '{}' movement must be directed '{}'.",
            movement.movement_type,
            movement_direction(&movement.movement_type)
        ));
    }
    if movement.quantity_milli <= 0 {
        return Err("A stock movement must carry a positive quantity.".to_string());
    }
    check_quantity(movement.quantity_milli, "The movement quantity")?;
    check_money(movement.rate, "The movement rate")?;
    check_money(movement.value, "The movement value")?;
    check_money(movement.cost, "The movement cost")?;
    check_quantity(movement.resulting_quantity_milli, "The resulting quantity")?;
    check_money(movement.resulting_carrying_value, "The resulting carrying value")?;
    Ok(())
}

/// The next number in the company's movement order.
fn next_sequence_no(transaction: &Transaction<'_>, company_id: &str) -> Result<i64, String> {
    let current: Option<i64> = transaction
        .query_row(
            "SELECT MAX(sequence_no) FROM stock_movements WHERE company_id = ?1",
            params![company_id],
            |row| row.get(0),
        )
        .map_err(|error| db_error("The stock history could not be read", error))?;
    Ok(current.unwrap_or(0) + 1)
}

/// The message a refused movement carries.
fn stock_movement_error(error: &rusqlite::Error) -> String {
    let text = error.to_string();
    if text.contains("voucher_item_id") || text.contains("stock_movements.id") {
        return STOCK_DUPLICATE_MESSAGE.to_string();
    }
    if text.contains("FOREIGN KEY") {
        return "A stock movement points at an item, a godown or a voucher that does not belong to this company. Nothing was posted.".to_string();
    }
    db_error("A stock movement could not be saved. Nothing was posted.", error)
}

/// Write one movement of the plan.
fn insert_movement(
    transaction: &Transaction<'_>,
    voucher: &Voucher,
    movement: &PlannedMovement,
    sequence_no: i64,
) -> Result<(), String> {
    // The quantity column that the earlier version used is signed and counted
    // in units; the authoritative quantity is the milli-unit column beside it.
    let signed_quantity_milli = if movement.direction == "out" {
        -movement.quantity_milli
    } else {
        movement.quantity_milli
    };

    transaction
        .execute(
            "INSERT INTO stock_movements (
                id, company_id, voucher_id, voucher_number, date, item_id, godown_id,
                quantity, rate, value, voucher_item_id, movement_type, sequence_no,
                quantity_milli, cost, valuation_method, resulting_quantity_milli,
                resulting_carrying_value, reverses_movement_id, created_at
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7,
                (?8 * 1.0) / 1000.0, ?9, ?10, ?11, ?12, ?13,
                ?14, ?15, ?16, ?17, ?18, ?19, ?20
             )",
            params![
                movement.id,
                movement.company_id,
                movement.voucher_id,
                voucher.number,
                movement.date,
                movement.item_id,
                movement.godown_id,
                signed_quantity_milli,
                movement.rate,
                movement.value,
                movement.voucher_item_id,
                movement.movement_type,
                sequence_no,
                movement.quantity_milli,
                movement.cost,
                movement.valuation_method,
                movement.resulting_quantity_milli,
                movement.resulting_carrying_value,
                movement.reverses_movement_id,
                movement.created_at,
            ],
        )
        .map_err(|error| stock_movement_error(&error))?;
    Ok(())
}

/// Write the costing pool of the plan.
///
/// The revision moves on when the pool changes, not on every posting: a plan
/// that leaves a pool as it was stays valid.
fn write_pool(transaction: &Transaction<'_>, pool: &StockPoolState) -> Result<(), String> {
    let stored: Option<(i64, i64)> = transaction
        .query_row(
            "SELECT quantity_milli, carrying_value FROM stock_pools
             WHERE company_id = ?1 AND item_id = ?2",
            params![pool.company_id, pool.item_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| db_error("The costing pool could not be read", error))?;

    if let Some((quantity, value)) = stored {
        if quantity == pool.quantity_milli && value == pool.carrying_value {
            return Ok(());
        }
    }

    transaction
        .execute(
            "INSERT INTO stock_pools (
                company_id, item_id, quantity_milli, carrying_value, revision, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(company_id, item_id) DO UPDATE SET
                quantity_milli = excluded.quantity_milli,
                carrying_value = excluded.carrying_value,
                revision = excluded.revision,
                updated_at = excluded.updated_at",
            params![
                pool.company_id,
                pool.item_id,
                pool.quantity_milli,
                pool.carrying_value,
                pool.revision.saturating_add(1),
                pool.updated_at,
            ],
        )
        .map_err(|error| db_error("The costing pool could not be saved. Nothing was posted.", error))?;
    Ok(())
}

/// Write the location balance of the plan.
fn write_location(
    transaction: &Transaction<'_>,
    location: &StockLocationState,
) -> Result<(), String> {
    let stored: Option<i64> = transaction
        .query_row(
            "SELECT quantity_milli FROM stock_balances
             WHERE company_id = ?1 AND item_id = ?2 AND godown_id = ?3",
            params![location.company_id, location.item_id, location.godown_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| db_error("The location balance could not be read", error))?;

    if let Some(quantity) = stored {
        if quantity == location.quantity_milli {
            return Ok(());
        }
    }

    transaction
        .execute(
            "INSERT INTO stock_balances (
                company_id, item_id, godown_id, quantity_milli, revision, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(company_id, item_id, godown_id) DO UPDATE SET
                quantity_milli = excluded.quantity_milli,
                revision = excluded.revision,
                updated_at = excluded.updated_at",
            params![
                location.company_id,
                location.item_id,
                location.godown_id,
                location.quantity_milli,
                location.revision.saturating_add(1),
                location.updated_at,
            ],
        )
        .map_err(|error| {
            db_error("The location balance could not be saved. Nothing was posted.", error)
        })?;
    Ok(())
}

/// Write the stock movements, the costing pools and the location balances of
/// a posting.
///
/// Everything here belongs to the same business operation as the voucher, so
/// it runs inside the voucher's transaction: a refused write leaves no
/// voucher, no movement and no balance behind.
///
/// The plan is computed by the domain layer. This function stores it, refuses
/// a plan that no longer matches the stored stock, and never re-derives a
/// quantity, a rate or a cost.
fn write_stock(
    transaction: &Transaction<'_>,
    voucher: &Voucher,
    movements: &[PlannedMovement],
    pools: &[StockPoolState],
    locations: &[StockLocationState],
) -> Result<(), String> {
    if movements.is_empty() && pools.is_empty() && locations.is_empty() {
        return Ok(());
    }

    // Every movement belongs to the voucher and the company being posted.
    for movement in movements {
        validate_movement(voucher, movement)?;
    }

    // The items and the godowns must belong to the company. The composite
    // foreign keys refuse it as well; this check turns the refusal into a
    // message a person can act on.
    let movement_items = unique_values(movements.iter().map(|movement| movement.item_id.clone()));
    ensure_items_in_company(transaction, &voucher.company_id, &movement_items)?;
    let movement_godowns = unique_values(
        movements
            .iter()
            .filter_map(|movement| movement.godown_id.clone()),
    );
    ensure_godowns_in_company(transaction, &voucher.company_id, &movement_godowns)?;

    let pool_items = unique_values(pools.iter().map(|pool| pool.item_id.clone()));
    ensure_items_in_company(transaction, &voucher.company_id, &pool_items)?;
    let location_items = unique_values(locations.iter().map(|location| location.item_id.clone()));
    ensure_items_in_company(transaction, &voucher.company_id, &location_items)?;
    let location_godowns = unique_values(locations.iter().map(|location| location.godown_id.clone()));
    ensure_godowns_in_company(transaction, &voucher.company_id, &location_godowns)?;

    // A movement must point at a line of the voucher being posted.
    for movement in movements {
        let Some(voucher_item_id) = &movement.voucher_item_id else {
            continue;
        };
        let exists: Option<i64> = transaction
            .query_row(
                "SELECT 1 FROM voucher_items
                 WHERE id = ?1 AND voucher_id = ?2 AND company_id = ?3",
                params![voucher_item_id, voucher.id, voucher.company_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| db_error("A stock movement could not be checked", error))?;
        if exists.is_none() {
            return Err(
                "A stock movement must point at a line of the voucher being posted.".to_string(),
            );
        }
    }

    // The same voucher line must not produce the same movement twice.
    for movement in movements {
        let Some(voucher_item_id) = &movement.voucher_item_id else {
            continue;
        };
        let existing: Option<String> = transaction
            .query_row(
                "SELECT id FROM stock_movements
                 WHERE company_id = ?1 AND voucher_item_id = ?2 AND movement_type = ?3",
                params![movement.company_id, voucher_item_id, movement.movement_type],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| db_error("A stock movement could not be checked", error))?;
        if existing.is_some() {
            return Err(STOCK_DUPLICATE_MESSAGE.to_string());
        }
    }

    // Backdating is refused: the moving average depends on the order of the
    // movements, so a movement that belongs to an earlier day cannot be
    // added without recalculating the stock that follows it.
    for item_id in &movement_items {
        let latest: Option<String> = transaction
            .query_row(
                "SELECT MAX(date) FROM stock_movements WHERE company_id = ?1 AND item_id = ?2",
                params![voucher.company_id, item_id],
                |row| row.get(0),
            )
            .map_err(|error| db_error("The stock history could not be read", error))?;
        if let Some(latest) = latest {
            if latest.as_str() > voucher.date.as_str() {
                return Err(format!(
                    "This posting is dated {}, before the last stock movement of this item on {}. \
                     Recalculating historical inventory is not supported.",
                    voucher.date, latest
                ));
            }
        }
    }

    // The plan must have been built on the stock that is stored now.
    for pool in pools {
        let stored: Option<i64> = transaction
            .query_row(
                "SELECT revision FROM stock_pools WHERE company_id = ?1 AND item_id = ?2",
                params![pool.company_id, pool.item_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| db_error("The costing pool could not be read", error))?;
        if stored.unwrap_or(0) != pool.revision {
            return Err(STOCK_CONFLICT_MESSAGE.to_string());
        }
    }
    for location in locations {
        let stored: Option<i64> = transaction
            .query_row(
                "SELECT revision FROM stock_balances
                 WHERE company_id = ?1 AND item_id = ?2 AND godown_id = ?3",
                params![location.company_id, location.item_id, location.godown_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| db_error("The location balance could not be read", error))?;
        if stored.unwrap_or(0) != location.revision {
            return Err(STOCK_CONFLICT_MESSAGE.to_string());
        }
    }

    // The movements are written with a stable, auditable order.
    let mut sequence_no = next_sequence_no(transaction, &voucher.company_id)?;
    for movement in movements {
        insert_movement(transaction, voucher, movement, sequence_no)?;
        sequence_no += 1;
    }

    // The pools and the location balances follow the movements.
    for pool in pools {
        write_pool(transaction, pool)?;
    }
    for location in locations {
        write_location(transaction, location)?;
    }

    Ok(())
}

/// The inventory accounts of a company, when it has any.
pub fn get_inventory_accounts(
    database: &Database,
    company_id: &str,
) -> Result<Option<InventoryAccounts>, String> {
    let connection = database.lock();
    connection
        .query_row(
            "SELECT id, company_id, inventory_ledger_id, cogs_ledger_id, variance_ledger_id,
                    purchases_ledger_id, production_ledger_id, valuation_method,
                    input_tax_recoverable, activated_at, created_at
             FROM inventory_accounts WHERE company_id = ?1",
            params![company_id],
            |row| {
                Ok(InventoryAccounts {
                    id: row.get(0)?,
                    company_id: row.get(1)?,
                    inventory_ledger_id: row.get(2)?,
                    cogs_ledger_id: row.get(3)?,
                    variance_ledger_id: row.get(4)?,
                    purchases_ledger_id: row.get(5)?,
                    production_ledger_id: row.get(6)?,
                    valuation_method: row.get(7)?,
                    input_tax_recoverable: bool_from_int(row.get(8)?),
                    activated_at: row.get(9)?,
                    created_at: row.get(10)?,
                })
            },
        )
        .optional()
        .map_err(|error| db_error("The inventory accounts could not be read", error))
}

#[tauri::command]
pub fn get_inventory_accounts_cmd(
    workspace: State<'_, Workspace>,
    company_id: String,
) -> Result<Option<InventoryAccounts>, String> {
    workspace.with_database(|db| get_inventory_accounts(db, &company_id))
}

/// Save the inventory accounts of a company.
///
/// The record is kept per company: saving again replaces the accounts in
/// force and keeps the identity of the record.
pub fn save_inventory_accounts(
    database: &Database,
    accounts: InventoryAccounts,
) -> Result<InventoryAccounts, String> {
    database.transaction(|transaction| save_inventory_accounts_in(transaction, accounts))
}

/// Save the inventory accounts inside a transaction that is already open.
///
/// The activation needs the accounts and the opening movements in one
/// transaction, so the body is available on its own.
fn save_inventory_accounts_in(
    transaction: &Transaction<'_>,
    accounts: InventoryAccounts,
) -> Result<InventoryAccounts, String> {
    ensure_company(transaction, &accounts.company_id)?;

    let ledgers = [
        ("inventory", accounts.inventory_ledger_id.as_str()),
        ("cost of goods sold", accounts.cogs_ledger_id.as_str()),
        ("stock variance", accounts.variance_ledger_id.as_str()),
        ("purchases", accounts.purchases_ledger_id.as_str()),
    ];
    for (label, ledger_id) in ledgers {
        if ledger_id.trim().is_empty() {
            return Err(format!(
                "The {label} account must be chosen before inventory is activated."
            ));
        }
        let exists: Option<i64> = transaction
            .query_row(
                "SELECT 1 FROM ledgers WHERE id = ?1 AND company_id = ?2",
                params![ledger_id, accounts.company_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| db_error("The ledger could not be read", error))?;
        if exists.is_none() {
            return Err(format!(
                "The {label} account does not belong to this company."
            ));
        }
    }

    // The work in progress account is optional: it is only needed once a
    // company starts producing, so it is checked when it is chosen.
    if let Some(production_ledger_id) = accounts.production_ledger_id.as_deref() {
        if !production_ledger_id.trim().is_empty() {
            let exists: Option<i64> = transaction
                .query_row(
                    "SELECT 1 FROM ledgers WHERE id = ?1 AND company_id = ?2",
                    params![production_ledger_id, accounts.company_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|error| db_error("The ledger could not be read", error))?;
            if exists.is_none() {
                return Err(format!(
                    "The work in progress account {production_ledger_id} does not belong to this company."
                ));
            }
        }
    }

    // The record keeps its identity across a second save.
    let existing_id: Option<String> = transaction
        .query_row(
            "SELECT id FROM inventory_accounts WHERE company_id = ?1",
            params![accounts.company_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| db_error("The inventory accounts could not be read", error))?;
    let id = existing_id.unwrap_or_else(|| accounts.id.clone());

    transaction
        .execute(
            "INSERT INTO inventory_accounts (
                id, company_id, inventory_ledger_id, cogs_ledger_id, variance_ledger_id,
                purchases_ledger_id, production_ledger_id, valuation_method,
                input_tax_recoverable, activated_at, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(company_id) DO UPDATE SET
                inventory_ledger_id = excluded.inventory_ledger_id,
                cogs_ledger_id = excluded.cogs_ledger_id,
                variance_ledger_id = excluded.variance_ledger_id,
                purchases_ledger_id = excluded.purchases_ledger_id,
                production_ledger_id = excluded.production_ledger_id,
                valuation_method = excluded.valuation_method,
                input_tax_recoverable = excluded.input_tax_recoverable,
                activated_at = excluded.activated_at",
            params![
                id,
                accounts.company_id,
                accounts.inventory_ledger_id,
                accounts.cogs_ledger_id,
                accounts.variance_ledger_id,
                accounts.purchases_ledger_id,
                accounts.production_ledger_id,
                accounts.valuation_method,
                i64::from(accounts.input_tax_recoverable),
                accounts.activated_at,
                accounts.created_at,
            ],
        )
        .map_err(|error| db_error("The inventory accounts could not be saved", error))?;

    Ok(InventoryAccounts { id, ..accounts })
}

#[tauri::command]
pub fn save_inventory_accounts_cmd(
    workspace: State<'_, Workspace>,
    accounts: InventoryAccounts,
) -> Result<InventoryAccounts, String> {
    workspace.with_database(|db| save_inventory_accounts(db, accounts))
}

/// Open the company's stock books at a cutover date.
///
/// The accounts, the opening balances, the movements they create and the audit
/// event are written together, or not at all.
///
/// The activation does not post a financial entry. The difference between the
/// opening carrying value and the balance the inventory asset account already
/// carries is reported to the person activating, and is corrected by an
/// explicit adjustment rather than absorbed here.
pub fn create_opening_stock(
    database: &Database,
    request: OpeningStockRequest,
) -> Result<OpeningStockResult, String> {
    database.transaction(|transaction| {
        ensure_company(transaction, &request.company_id)?;

        if request.cutover_date.trim().is_empty() {
            return Err(
                "The cutover date must be chosen before inventory is activated.".to_string(),
            );
        }

        // The stock books are opened once. A company that has already
        // activated cannot open them again, because the cutover would have
        // two answers.
        let activated: Option<Option<String>> = transaction
            .query_row(
                "SELECT activated_at FROM inventory_accounts WHERE company_id = ?1",
                params![request.company_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| db_error("The inventory accounts could not be read", error))?;
        if matches!(activated, Some(Some(_))) {
            return Err("This company has already activated inventory.".to_string());
        }

        // The items and the godowns must belong to the company.
        let item_ids = unique_values(request.lines.iter().map(|line| line.item_id.clone()));
        ensure_items_in_company(transaction, &request.company_id, &item_ids)?;
        let godown_ids = unique_values(request.lines.iter().map(|line| line.godown_id.clone()));
        ensure_godowns_in_company(transaction, &request.company_id, &godown_ids)?;

        // The accounts come first, because the movements are valued with the
        // method they name.
        let mut accounts = request.accounts.clone();
        accounts.company_id = request.company_id.clone();
        accounts.activated_at = Some(request.cutover_date.clone());
        let accounts = save_inventory_accounts_in(transaction, accounts)?;

        let now = crate::migrations::now_iso();
        let voucher = Voucher {
            id: format!("opening-{}", request.company_id),
            company_id: request.company_id.clone(),
            kind: "stock-journal".into(),
            number: "OPENING".into(),
            date: request.cutover_date.clone(),
            due_date: None,
            payment_term_id: None,
            party_id: None,
            narration: if request.reason.trim().is_empty() {
                format!("Opening stock from {}", request.cutover_date)
            } else {
                request.reason.clone()
            },
            reference: String::new(),
            status: "posted".into(),
            entries: Vec::new(),
            items: Vec::new(),
            taxes: Vec::new(),
            linked_voucher_id: None,
            reversed_by_voucher_id: None,
            is_locked: false,
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        insert_voucher_rows(transaction, &voucher)?;

        // One pool per item and one balance per item and location, however
        // many opening lines the item has.
        let mut pool_totals: Vec<(String, i64, i64)> = Vec::new();
        let mut location_totals: Vec<(String, String, i64)> = Vec::new();
        let mut movements: Vec<PlannedMovement> = Vec::new();

        for line in &request.lines {
            if line.quantity_milli < 0 {
                return Err("An opening quantity cannot be negative.".to_string());
            }
            check_money(line.carrying_value, "Opening value")?;

            let (quantity_after, value_after) = {
                let pool = match pool_totals
                    .iter_mut()
                    .find(|(item, _, _)| item == &line.item_id)
                {
                    Some(existing) => existing,
                    None => {
                        pool_totals.push((line.item_id.clone(), 0, 0));
                        pool_totals.last_mut().expect("the pool was just added")
                    }
                };
                pool.1 += line.quantity_milli;
                pool.2 += line.carrying_value;
                (pool.1, pool.2)
            };

            {
                let location = match location_totals
                    .iter_mut()
                    .find(|(item, godown, _)| item == &line.item_id && godown == &line.godown_id)
                {
                    Some(existing) => existing,
                    None => {
                        location_totals.push((line.item_id.clone(), line.godown_id.clone(), 0));
                        location_totals.last_mut().expect("the location was just added")
                    }
                };
                location.2 += line.quantity_milli;
            }

            let rate = if line.quantity_milli == 0 {
                0
            } else {
                ((line.carrying_value as f64) * 1000.0 / line.quantity_milli as f64).round() as i64
            };

            movements.push(PlannedMovement {
                id: format!(
                    "opening-{}-{}-{}",
                    request.company_id, line.item_id, line.godown_id
                ),
                company_id: request.company_id.clone(),
                item_id: line.item_id.clone(),
                godown_id: Some(line.godown_id.clone()),
                voucher_id: voucher.id.clone(),
                voucher_item_id: None,
                movement_type: "opening".into(),
                date: request.cutover_date.clone(),
                direction: "in".into(),
                quantity_milli: line.quantity_milli,
                rate,
                value: line.carrying_value,
                cost: 0,
                valuation_method: accounts.valuation_method.clone(),
                resulting_quantity_milli: quantity_after,
                resulting_carrying_value: value_after,
                reverses_movement_id: None,
                created_at: now.clone(),
            });
        }

        // The movements, the pools and the balances are part of the same
        // operation as the accounts and the audit event.
        let mut sequence_no = next_sequence_no(transaction, &request.company_id)?;
        for movement in &movements {
            insert_movement(transaction, &voucher, movement, sequence_no)?;
            sequence_no += 1;
        }

        let pools: Vec<StockPoolState> = pool_totals
            .iter()
            .map(|(item_id, quantity_milli, carrying_value)| StockPoolState {
                company_id: request.company_id.clone(),
                item_id: item_id.clone(),
                quantity_milli: *quantity_milli,
                carrying_value: *carrying_value,
                revision: 0,
                updated_at: now.clone(),
            })
            .collect();
        for pool in &pools {
            write_pool(transaction, pool)?;
        }

        let locations: Vec<StockLocationState> = location_totals
            .iter()
            .map(|(item_id, godown_id, quantity_milli)| StockLocationState {
                company_id: request.company_id.clone(),
                item_id: item_id.clone(),
                godown_id: godown_id.clone(),
                quantity_milli: *quantity_milli,
                revision: 0,
                updated_at: now.clone(),
            })
            .collect();
        for location in &locations {
            write_location(transaction, location)?;
        }

        let audit_event = AuditEvent {
            id: format!("aud-opening-{}", request.company_id),
            company_id: request.company_id.clone(),
            actor: request.actor.clone(),
            action: "inventory.activated".into(),
            record_type: "company".into(),
            record_id: request.company_id.clone(),
            record_label: format!("Inventory activated from {}", request.cutover_date),
            timestamp: now.clone(),
            detail: Some(if request.reason.trim().is_empty() {
                format!(
                    "Inventory activated from {} with {} opening balances",
                    request.cutover_date,
                    request.lines.len()
                )
            } else {
                request.reason.clone()
            }),
        };
        insert_audit_event_row(transaction, &audit_event)?;

        // What was written, read back the way the domain reads it.
        let written = {
            let mut statement = transaction
                .prepare(&format!(
                    "SELECT {STOCK_MOVEMENT_COLUMNS} FROM stock_movements
                     WHERE company_id = ?1 ORDER BY date, sequence_no, id"
                ))
                .map_err(|error| db_error("The stock movements could not be read", error))?;
            let rows = statement
                .query_map(params![request.company_id], movement_from_row)
                .map_err(|error| db_error("The stock movements could not be read", error))?;
            let mut movements = Vec::new();
            for row in rows {
                movements
                    .push(row.map_err(|error| db_error("A stock movement is unreadable", error))?);
            }
            movements
        };
        Ok(OpeningStockResult {
            accounts,
            movements: written,
            pools,
            locations,
            audit_event,
        })
    })
}

/// Write one audit event.
fn insert_audit_event_row(
    transaction: &Transaction<'_>,
    event: &AuditEvent,
) -> Result<(), String> {
    transaction
        .execute(
            "INSERT INTO audit_events (id, company_id, actor, action, record_type, record_id,
                record_label, timestamp, detail)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                event.id,
                event.company_id,
                event.actor,
                event.action,
                event.record_type,
                event.record_id,
                event.record_label,
                event.timestamp,
                event.detail
            ],
        )
        .map_err(|error| db_error("The audit entry could not be written", error))?;
    Ok(())
}

#[tauri::command]
pub fn create_opening_stock_cmd(
    workspace: State<'_, Workspace>,
    request: OpeningStockRequest,
) -> Result<OpeningStockResult, String> {
    workspace.with_database(|db| create_opening_stock(db, request))
}

/// The costing pool of every item of a company.
pub fn list_stock_pools(
    database: &Database,
    company_id: &str,
) -> Result<Vec<StockPoolState>, String> {
    let connection = database.lock();
    let mut statement = connection
        .prepare(
            "SELECT company_id, item_id, quantity_milli, carrying_value, revision, updated_at
             FROM stock_pools WHERE company_id = ?1 ORDER BY item_id",
        )
        .map_err(|error| db_error("The costing pools could not be read", error))?;
    let rows = statement
        .query_map(params![company_id], |row| {
            Ok(StockPoolState {
                company_id: row.get(0)?,
                item_id: row.get(1)?,
                quantity_milli: row.get(2)?,
                carrying_value: row.get(3)?,
                revision: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .map_err(|error| db_error("The costing pools could not be read", error))?;
    let mut pools = Vec::new();
    for pool in rows {
        pools.push(pool.map_err(|error| db_error("A costing pool is unreadable", error))?);
    }
    Ok(pools)
}

#[tauri::command]
pub fn list_stock_pools_cmd(
    workspace: State<'_, Workspace>,
    company_id: String,
) -> Result<Vec<StockPoolState>, String> {
    workspace.with_database(|db| list_stock_pools(db, &company_id))
}

/// The quantity held at each location, for a company or for one item.
pub fn list_stock_balances(
    database: &Database,
    company_id: &str,
    item_id: Option<&str>,
) -> Result<Vec<StockLocationState>, String> {
    let connection = database.lock();
    let mut sql = String::from(
        "SELECT company_id, item_id, godown_id, quantity_milli, revision, updated_at
         FROM stock_balances WHERE company_id = ?1",
    );
    if item_id.is_some() {
        sql.push_str(" AND item_id = ?2");
    }
    sql.push_str(" ORDER BY item_id, godown_id");

    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| db_error("The location balances could not be read", error))?;
    let rows = match item_id {
        Some(id) => statement.query_map(params![company_id, id], location_from_row),
        None => statement.query_map(params![company_id], location_from_row),
    }
    .map_err(|error| db_error("The location balances could not be read", error))?;
    let mut locations = Vec::new();
    for location in rows {
        locations.push(location.map_err(|error| db_error("A location balance is unreadable", error))?);
    }
    Ok(locations)
}

fn location_from_row(row: &Row<'_>) -> rusqlite::Result<StockLocationState> {
    Ok(StockLocationState {
        company_id: row.get(0)?,
        item_id: row.get(1)?,
        godown_id: row.get(2)?,
        quantity_milli: row.get(3)?,
        revision: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

#[tauri::command]
pub fn list_stock_balances_cmd(
    workspace: State<'_, Workspace>,
    company_id: String,
    item_id: Option<String>,
) -> Result<Vec<StockLocationState>, String> {
    workspace.with_database(|db| list_stock_balances(db, &company_id, item_id.as_deref()))
}

/// Replay a list of movements and return the pool and location balances they
/// imply.
///
/// The movements carry their own quantity and value, so the replay only adds
/// and subtracts them: no quantity and no cost is derived here.
fn replay_movements(movements: &[StockMovementRecord]) -> (Vec<StockPoolState>, Vec<StockLocationState>) {
    let rebuilt_at = crate::migrations::now_iso();
    let company_id = movements
        .first()
        .map(|movement| movement.company_id.clone())
        .unwrap_or_default();

    let mut pool_quantities: Vec<(String, i64)> = Vec::new();
    let mut pool_values: Vec<(String, i64)> = Vec::new();
    let mut location_quantities: Vec<(String, String, i64)> = Vec::new();

    for movement in movements {
        let sign = if movement.direction == "out" { -1 } else { 1 };
        let quantity = sign * movement.quantity_milli;
        let value = sign * movement.value;

        match pool_quantities
            .iter_mut()
            .find(|(item_id, _)| *item_id == movement.item_id)
        {
            Some((_, held)) => *held += quantity,
            None => pool_quantities.push((movement.item_id.clone(), quantity)),
        }
        match pool_values
            .iter_mut()
            .find(|(item_id, _)| *item_id == movement.item_id)
        {
            Some((_, held)) => *held += value,
            None => pool_values.push((movement.item_id.clone(), value)),
        }
        if let Some(godown_id) = &movement.godown_id {
            match location_quantities
                .iter_mut()
                .find(|(item_id, godown, _)| *item_id == movement.item_id && godown == godown_id)
            {
                Some((_, _, held)) => *held += quantity,
                None => location_quantities.push((
                    movement.item_id.clone(),
                    godown_id.clone(),
                    quantity,
                )),
            }
        }
    }

    let pools = pool_quantities
        .iter()
        .map(|(item_id, quantity)| {
            let carrying_value = pool_values
                .iter()
                .find(|(id, _)| id == item_id)
                .map(|(_, value)| *value)
                .unwrap_or(0);
            StockPoolState {
                company_id: company_id.clone(),
                item_id: item_id.clone(),
                quantity_milli: *quantity,
                carrying_value,
                revision: 0,
                updated_at: rebuilt_at.clone(),
            }
        })
        .collect();
    let locations = location_quantities
        .iter()
        .map(|(item_id, godown_id, quantity)| StockLocationState {
            company_id: company_id.clone(),
            item_id: item_id.clone(),
            godown_id: godown_id.clone(),
            quantity_milli: *quantity,
            revision: 0,
            updated_at: rebuilt_at.clone(),
        })
        .collect();

    (pools, locations)
}

/// Replay the movement ledger of a company and return the balances it
/// implies.
///
/// This is a development and recovery command. It never overwrites the stored
/// balances and never posts a financial entry: the caller compares the result
/// with the stored projection.
pub fn rebuild_stock_balances(
    database: &Database,
    company_id: &str,
) -> Result<StockRebuildResult, String> {
    let connection = database.lock();
    let mut statement = connection
        .prepare(&format!(
            "SELECT {STOCK_MOVEMENT_COLUMNS} FROM stock_movements
             WHERE company_id = ?1 ORDER BY date, sequence_no, id"
        ))
        .map_err(|error| db_error("The stock movements could not be read", error))?;
    let rows = statement
        .query_map(params![company_id], movement_from_row)
        .map_err(|error| db_error("The stock movements could not be read", error))?;

    let mut movements: Vec<StockMovementRecord> = Vec::new();
    for movement in rows {
        movements.push(movement.map_err(|error| db_error("A stock movement is unreadable", error))?);
    }
    drop(statement);

    let (pools, locations) = replay_movements(&movements);

    Ok(StockRebuildResult {
        pools,
        locations,
        movements,
    })
}

#[tauri::command]
pub fn rebuild_stock_balances_cmd(
    workspace: State<'_, Workspace>,
    company_id: String,
) -> Result<StockRebuildResult, String> {
    workspace.with_database(|db| rebuild_stock_balances(db, &company_id))
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

/// The message a repeated fulfilment carries.
pub const ORDER_FULFILMENT_DUPLICATE_MESSAGE: &str =
    "This invoice line has already been recorded against the order. Nothing was posted.";

/// The message a repeated production issue carries.
pub const PRODUCTION_ISSUE_DUPLICATE_MESSAGE: &str =
    "This issue has already been recorded against the production order. Nothing was posted.";

/// The message a repeated production completion carries.
pub const PRODUCTION_COMPLETION_DUPLICATE_MESSAGE: &str =
    "This receipt of finished goods has already been recorded against the production order. Nothing was posted.";

/// The states an order can be in.
const ORDER_STATUSES: &[&str] = &["draft", "confirmed", "cancelled"];

/// The kinds of order there are.
const ORDER_KINDS: &[&str] = &["sales", "purchase"];

const ORDER_COLUMNS: &str = "id, company_id, kind, number, date, expected_date, party_id, \
     narration, reference, status, payment_term_id, revision, created_at, updated_at";

fn order_from_row(row: &Row<'_>) -> rusqlite::Result<Order> {
    Ok(Order {
        id: row.get(0)?,
        company_id: row.get(1)?,
        kind: row.get(2)?,
        number: row.get(3)?,
        date: row.get(4)?,
        expected_date: row.get(5)?,
        party_id: row.get(6)?,
        narration: row.get(7)?,
        reference: row.get(8)?,
        status: row.get(9)?,
        payment_term_id: row.get(10)?,
        revision: row.get(11)?,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
    })
}

/// The lines of an order.
fn order_lines(
    connection: &Connection,
    company_id: &str,
    order_id: &str,
) -> Result<Vec<OrderLine>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, company_id, order_id, item_id, quantity_milli, rate, discount,
                tax_category_id, amount
             FROM order_lines WHERE company_id = ?1 AND order_id = ?2 ORDER BY id",
        )
        .map_err(|error| db_error("The order lines could not be read", error))?;
    let rows = statement
        .query_map(params![company_id, order_id], |row| {
            Ok(OrderLine {
                id: row.get(0)?,
                company_id: row.get(1)?,
                order_id: row.get(2)?,
                item_id: row.get(3)?,
                quantity_milli: row.get(4)?,
                rate: row.get(5)?,
                discount: row.get(6)?,
                tax_category_id: row.get(7)?,
                amount: row.get(8)?,
            })
        })
        .map_err(|error| db_error("The order lines could not be read", error))?;
    let mut lines = Vec::new();
    for line in rows {
        lines.push(line.map_err(|error| db_error("An order line is unreadable", error))?);
    }
    Ok(lines)
}

/// What has been delivered against an order.
fn order_fulfilments(
    connection: &Connection,
    company_id: &str,
    order_id: &str,
) -> Result<Vec<OrderFulfilment>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, company_id, order_id, order_line_id, voucher_id, voucher_item_id,
                quantity_milli, amount, created_at
             FROM order_fulfilments WHERE company_id = ?1 AND order_id = ?2 ORDER BY created_at, id",
        )
        .map_err(|error| db_error("The order fulfilments could not be read", error))?;
    let rows = statement
        .query_map(params![company_id, order_id], |row| {
            Ok(OrderFulfilment {
                id: row.get(0)?,
                company_id: row.get(1)?,
                order_id: row.get(2)?,
                order_line_id: row.get(3)?,
                voucher_id: row.get(4)?,
                voucher_item_id: row.get(5)?,
                quantity_milli: row.get(6)?,
                amount: row.get(7)?,
                created_at: row.get(8)?,
            })
        })
        .map_err(|error| db_error("The order fulfilments could not be read", error))?;
    let mut fulfilments = Vec::new();
    for fulfilment in rows {
        fulfilments.push(fulfilment.map_err(|error| db_error("A fulfilment is unreadable", error))?);
    }
    Ok(fulfilments)
}

/// The history of an order.
fn order_revisions(
    connection: &Connection,
    company_id: &str,
    order_id: &str,
) -> Result<Vec<OrderRevision>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, company_id, order_id, revision, reason, actor, created_at
             FROM order_revisions WHERE company_id = ?1 AND order_id = ?2 ORDER BY revision, id",
        )
        .map_err(|error| db_error("The order history could not be read", error))?;
    let rows = statement
        .query_map(params![company_id, order_id], |row| {
            Ok(OrderRevision {
                id: row.get(0)?,
                company_id: row.get(1)?,
                order_id: row.get(2)?,
                revision: row.get(3)?,
                reason: row.get(4)?,
                actor: row.get(5)?,
                created_at: row.get(6)?,
            })
        })
        .map_err(|error| db_error("The order history could not be read", error))?;
    let mut revisions = Vec::new();
    for revision in rows {
        revisions.push(revision.map_err(|error| db_error("A revision is unreadable", error))?);
    }
    Ok(revisions)
}

/// The lines the history of an order keeps.
fn order_revision_lines(
    connection: &Connection,
    company_id: &str,
    order_id: &str,
) -> Result<Vec<OrderRevisionLine>, String> {
    let mut statement = connection
        .prepare(
            "SELECT l.id, l.company_id, l.revision_id, l.order_line_id, l.item_id,
                l.quantity_milli, l.rate, l.discount, l.tax_category_id, l.amount
             FROM order_revision_lines l
             JOIN order_revisions r ON r.id = l.revision_id AND r.company_id = l.company_id
             WHERE l.company_id = ?1 AND r.order_id = ?2 ORDER BY r.revision, l.id",
        )
        .map_err(|error| db_error("The order history could not be read", error))?;
    let rows = statement
        .query_map(params![company_id, order_id], |row| {
            Ok(OrderRevisionLine {
                id: row.get(0)?,
                company_id: row.get(1)?,
                revision_id: row.get(2)?,
                order_line_id: row.get(3)?,
                item_id: row.get(4)?,
                quantity_milli: row.get(5)?,
                rate: row.get(6)?,
                discount: row.get(7)?,
                tax_category_id: row.get(8)?,
                amount: row.get(9)?,
            })
        })
        .map_err(|error| db_error("The order history could not be read", error))?;
    let mut lines = Vec::new();
    for line in rows {
        lines.push(line.map_err(|error| db_error("A revision line is unreadable", error))?);
    }
    Ok(lines)
}

/// One order of a company.
fn find_order(
    connection: &Connection,
    company_id: &str,
    id: &str,
) -> Result<Order, String> {
    connection
        .query_row(
            &format!("SELECT {ORDER_COLUMNS} FROM orders WHERE company_id = ?1 AND id = ?2"),
            params![company_id, id],
            order_from_row,
        )
        .optional()
        .map_err(|error| db_error("The order could not be read", error))?
        .ok_or_else(|| format!("The order {id} does not exist in this company."))
}

/// An order with everything known about it.
fn order_detail(
    connection: &Connection,
    company_id: &str,
    id: &str,
) -> Result<OrderDetail, String> {
    let order = find_order(connection, company_id, id)?;
    Ok(OrderDetail {
        lines: order_lines(connection, company_id, id)?,
        fulfilments: order_fulfilments(connection, company_id, id)?,
        revisions: order_revisions(connection, company_id, id)?,
        revision_lines: order_revision_lines(connection, company_id, id)?,
        order,
    })
}

/// The order must carry the fields an order is made of.
fn check_order_header(order: &Order) -> Result<(), String> {
    if order.id.trim().is_empty() {
        return Err("An order needs an identifier.".to_string());
    }
    if order.number.trim().is_empty() {
        return Err("An order needs a number.".to_string());
    }
    if !ORDER_KINDS.contains(&order.kind.as_str()) {
        return Err(format!("'{}' is not a known kind of order.", order.kind));
    }
    if !ORDER_STATUSES.contains(&order.status.as_str()) {
        return Err(format!("'{}' is not a known state of an order.", order.status));
    }
    Ok(())
}

/// A line cannot carry a negative quantity, a negative discount or a negative
/// amount.
fn check_order_lines(lines: &[OrderLine]) -> Result<(), String> {
    for line in lines {
        if line.id.trim().is_empty() {
            return Err("An order line needs an identifier.".to_string());
        }
        if line.quantity_milli < 0 {
            return Err("An ordered quantity cannot be negative.".to_string());
        }
        check_quantity(line.quantity_milli, "The ordered quantity")?;
        check_money(line.rate, "The rate")?;
        check_money(line.discount, "The discount")?;
        check_money(line.amount, "The line amount")?;
        if line.discount < 0 {
            return Err("A discount cannot be negative.".to_string());
        }
        if line.amount < 0 {
            return Err("A line amount cannot be negative.".to_string());
        }
    }
    Ok(())
}

/// How much has been delivered against one order line.
fn fulfilled_quantity(
    transaction: &Transaction<'_>,
    company_id: &str,
    order_line_id: &str,
) -> Result<i64, String> {
    transaction
        .query_row(
            "SELECT COALESCE(SUM(quantity_milli), 0) FROM order_fulfilments
             WHERE company_id = ?1 AND order_line_id = ?2",
            params![company_id, order_line_id],
            |row| row.get(0),
        )
        .map_err(|error| db_error("The order fulfilments could not be read", error))
}

/// Replace the lines of an order with the ones given.
///
/// The lines that are no longer part of the order are removed, unless something
/// has been delivered against them: the fulfilment rows point at the line, and
/// the history is never rewritten to suit a new set of lines.
fn replace_order_lines(
    transaction: &Transaction<'_>,
    order: &Order,
    lines: &[OrderLine],
) -> Result<(), String> {
    let existing = order_lines(transaction, &order.company_id, &order.id)?;

    for line in lines {
        let known = existing.iter().any(|current| current.id == line.id);
        if known {
            transaction
                .execute(
                    "UPDATE order_lines SET item_id = ?2, quantity_milli = ?3, rate = ?4,
                        discount = ?5, tax_category_id = ?6, amount = ?7
                     WHERE id = ?1 AND company_id = ?8",
                    params![
                        line.id,
                        line.item_id,
                        line.quantity_milli,
                        line.rate,
                        line.discount,
                        line.tax_category_id,
                        line.amount,
                        order.company_id,
                    ],
                )
                .map_err(|error| db_error("An order line could not be saved", error))?;
            continue;
        }

        // The identifier must not already belong to another order.
        let owner: Option<String> = transaction
            .query_row(
                "SELECT order_id FROM order_lines WHERE id = ?1",
                params![line.id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| db_error("The order lines could not be read", error))?;
        if let Some(owner) = owner {
            return Err(format!(
                "The line {} belongs to the order {owner} and cannot be used here.",
                line.id
            ));
        }

        transaction
            .execute(
                "INSERT INTO order_lines (id, company_id, order_id, item_id, quantity_milli,
                    rate, discount, tax_category_id, amount)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    line.id,
                    order.company_id,
                    order.id,
                    line.item_id,
                    line.quantity_milli,
                    line.rate,
                    line.discount,
                    line.tax_category_id,
                    line.amount,
                ],
            )
            .map_err(|error| db_error("An order line could not be written", error))?;
    }

    for current in &existing {
        if lines.iter().any(|line| line.id == current.id) {
            continue;
        }
        let delivered = fulfilled_quantity(transaction, &order.company_id, &current.id)?;
        if delivered > 0 {
            return Err(format!(
                "The line {} has already been delivered against, so it cannot be removed from the order.",
                current.id
            ));
        }
        transaction
            .execute(
                "DELETE FROM order_lines WHERE id = ?1 AND company_id = ?2",
                params![current.id, order.company_id],
            )
            .map_err(|error| db_error("An order line could not be removed", error))?;
    }

    Ok(())
}

/// Keep one revision of an order in the history.
fn write_order_revision(
    transaction: &Transaction<'_>,
    company_id: &str,
    order_id: &str,
    revision: i64,
    reason: &str,
    actor: &str,
    lines: &[OrderLine],
    created_at: &str,
) -> Result<(), String> {
    let revision_id = unique_id("ord-rev");
    transaction
        .execute(
            "INSERT INTO order_revisions (id, company_id, order_id, revision, reason, actor, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                revision_id,
                company_id,
                order_id,
                revision,
                reason,
                actor,
                created_at
            ],
        )
        .map_err(|error| db_error("The order history could not be written", error))?;

    for line in lines {
        transaction
            .execute(
                "INSERT INTO order_revision_lines (id, company_id, revision_id, order_line_id,
                    item_id, quantity_milli, rate, discount, tax_category_id, amount)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    unique_id("ord-rev-line"),
                    company_id,
                    revision_id,
                    line.id,
                    line.item_id,
                    line.quantity_milli,
                    line.rate,
                    line.discount,
                    line.tax_category_id,
                    line.amount,
                ],
            )
            .map_err(|error| db_error("The order history could not be written", error))?;
    }

    Ok(())
}

/// Save an order and its lines, in one transaction.
///
/// A new order is written under the identifier it was given. An existing order
/// is replaced: the header is written again and the lines are replaced by the
/// ones given. A line that has been delivered against is never removed,
/// because the fulfilment history points at it.
pub fn save_order(
    database: &Database,
    order: Order,
    lines: Vec<OrderLine>,
) -> Result<OrderDetail, String> {
    database.transaction(|transaction| {
        ensure_company(transaction, &order.company_id)?;
        check_order_header(&order)?;
        check_order_lines(&lines)?;

        // The identifier must not already belong to another company.
        let owner: Option<String> = transaction
            .query_row(
                "SELECT company_id FROM orders WHERE id = ?1",
                params![order.id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| db_error("The order could not be read", error))?;
        if let Some(owner) = owner {
            if owner != order.company_id {
                return Err(format!(
                    "The order {} belongs to another company and cannot be changed here.",
                    order.id
                ));
            }
        }

        let item_ids = unique_values(lines.iter().map(|line| line.item_id.clone()));
        ensure_items_in_company(transaction, &order.company_id, &item_ids)?;

        transaction
            .execute(
                "INSERT INTO orders (id, company_id, kind, number, date, expected_date, party_id,
                    narration, reference, status, payment_term_id, revision, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
                 ON CONFLICT(id) DO UPDATE SET
                    kind = excluded.kind,
                    number = excluded.number,
                    date = excluded.date,
                    expected_date = excluded.expected_date,
                    party_id = excluded.party_id,
                    narration = excluded.narration,
                    reference = excluded.reference,
                    status = excluded.status,
                    payment_term_id = excluded.payment_term_id,
                    revision = excluded.revision,
                    updated_at = excluded.updated_at",
                params![
                    order.id,
                    order.company_id,
                    order.kind,
                    order.number,
                    order.date,
                    order.expected_date,
                    order.party_id,
                    order.narration,
                    order.reference,
                    order.status,
                    order.payment_term_id,
                    order.revision,
                    order.created_at,
                    order.updated_at,
                ],
            )
            .map_err(|error| db_error("The order could not be saved", error))?;

        replace_order_lines(transaction, &order, &lines)?;

        order_detail(transaction, &order.company_id, &order.id)
    })
}

/// The orders of a company, newest first, with their lines.
pub fn list_orders(
    database: &Database,
    company_id: &str,
    kind: Option<&str>,
) -> Result<Vec<OrderSummary>, String> {
    let connection = database.lock();
    let mut sql = format!("SELECT {ORDER_COLUMNS} FROM orders WHERE company_id = ?1");
    let mut values: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(company_id.to_string())];
    if let Some(kind) = kind {
        if kind != "all" {
            values.push(Box::new(kind.to_string()));
            sql.push_str(&format!(" AND kind = ?{}", values.len()));
        }
    }
    sql.push_str(" ORDER BY date DESC, created_at DESC, id");

    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| db_error("The orders could not be read", error))?;
    let rows = statement
        .query_map(rusqlite::params_from_iter(values), order_from_row)
        .map_err(|error| db_error("The orders could not be read", error))?;
    let mut orders = Vec::new();
    for order in rows {
        orders.push(order.map_err(|error| db_error("An order is unreadable", error))?);
    }
    drop(statement);

    let mut summaries = Vec::new();
    for order in orders {
        let lines = order_lines(&connection, company_id, &order.id)?;
        summaries.push(OrderSummary { order, lines });
    }
    Ok(summaries)
}

/// One order, with its lines, its fulfilments and its history.
pub fn get_order(
    database: &Database,
    company_id: &str,
    id: &str,
) -> Result<OrderDetail, String> {
    let connection = database.lock();
    order_detail(&connection, company_id, id)
}

/// Confirm an order, so that it can be invoiced.
pub fn confirm_order(
    database: &Database,
    company_id: &str,
    id: &str,
    actor: &str,
) -> Result<OrderDetail, String> {
    database.transaction(|transaction| {
        ensure_company(transaction, company_id)?;
        let order = find_order(transaction, company_id, id)?;
        if order.status == "cancelled" {
            return Err("A cancelled order cannot be confirmed.".to_string());
        }
        let lines = order_lines(transaction, company_id, id)?;
        if lines.is_empty() {
            return Err("An order must have at least one line before it can be confirmed.".to_string());
        }

        let now = migrations::now_iso();
        transaction
            .execute(
                "UPDATE orders SET status = 'confirmed', revision = revision + 1, updated_at = ?2
                 WHERE id = ?1 AND company_id = ?3",
                params![id, now, company_id],
            )
            .map_err(|error| db_error("The order could not be confirmed", error))?;

        insert_audit_event_row(
            transaction,
            &AuditEvent {
                id: unique_id("aud"),
                company_id: company_id.to_string(),
                actor: actor.to_string(),
                action: "order.confirmed".to_string(),
                record_type: "order".to_string(),
                record_id: id.to_string(),
                record_label: order.number.clone(),
                timestamp: now.clone(),
                detail: Some(format!("{} order {} confirmed", order.kind, order.number)),
            },
        )?;

        order_detail(transaction, company_id, id)
    })
}

/// Cancel an order and keep the reason in its history.
///
/// An order that has been delivered against cannot be cancelled: the invoice
/// has to be cancelled or credited first.
pub fn cancel_order(
    database: &Database,
    company_id: &str,
    id: &str,
    reason: &str,
    actor: &str,
) -> Result<OrderDetail, String> {
    database.transaction(|transaction| {
        ensure_company(transaction, company_id)?;
        let order = find_order(transaction, company_id, id)?;
        let fulfilments = order_fulfilments(transaction, company_id, id)?;
        if !fulfilments.is_empty() {
            return Err(
                "This order has already been delivered against, so it cannot be cancelled. \
                 Cancel or credit the invoice first, then cancel the order."
                    .to_string(),
            );
        }

        let now = migrations::now_iso();
        let revision = order.revision + 1;
        transaction
            .execute(
                "UPDATE orders SET status = 'cancelled', revision = ?2, updated_at = ?3
                 WHERE id = ?1 AND company_id = ?4",
                params![id, revision, now, company_id],
            )
            .map_err(|error| db_error("The order could not be cancelled", error))?;

        // The cancellation is kept in the history, with the reason.
        write_order_revision(
            transaction,
            company_id,
            id,
            revision,
            reason.trim(),
            actor,
            &[],
            &now,
        )?;

        insert_audit_event_row(
            transaction,
            &AuditEvent {
                id: unique_id("aud"),
                company_id: company_id.to_string(),
                actor: actor.to_string(),
                action: "order.cancelled".to_string(),
                record_type: "order".to_string(),
                record_id: id.to_string(),
                record_label: order.number.clone(),
                timestamp: now.clone(),
                detail: Some(format!("{} order {} cancelled", order.kind, order.number)),
            },
        )?;

        order_detail(transaction, company_id, id)
    })
}

/// Amend an order: replace its lines and keep the previous ones in the history.
///
/// The lines as they stood are snapshotted, so the history of the order is
/// never rewritten to suit a new set of lines. A line cannot be reduced below
/// what has already been delivered against it.
pub fn amend_order(
    database: &Database,
    company_id: &str,
    id: &str,
    lines: Vec<OrderLine>,
    reason: &str,
    actor: &str,
) -> Result<OrderDetail, String> {
    database.transaction(|transaction| {
        ensure_company(transaction, company_id)?;
        let order = find_order(transaction, company_id, id)?;
        if reason.trim().is_empty() {
            return Err("An amendment needs a reason, so that the history says why.".to_string());
        }
        check_order_lines(&lines)?;

        let previous = order_lines(transaction, company_id, id)?;
        let item_ids = unique_values(lines.iter().map(|line| line.item_id.clone()));
        ensure_items_in_company(transaction, company_id, &item_ids)?;

        // A line cannot be reduced below what has already been delivered.
        for line in &lines {
            let delivered = fulfilled_quantity(transaction, company_id, &line.id)?;
            if line.quantity_milli < delivered {
                return Err(
                    "An ordered quantity cannot be reduced below the quantity already delivered."
                        .to_string(),
                );
            }
        }

        let now = migrations::now_iso();
        let revision = order.revision + 1;

        // The history keeps the lines as they stood.
        write_order_revision(
            transaction,
            company_id,
            id,
            revision,
            reason.trim(),
            actor,
            &previous,
            &now,
        )?;

        replace_order_lines(transaction, &order, &lines)?;

        transaction
            .execute(
                "UPDATE orders SET revision = ?2, updated_at = ?3 WHERE id = ?1 AND company_id = ?4",
                params![id, revision, now, company_id],
            )
            .map_err(|error| db_error("The order could not be amended", error))?;

        insert_audit_event_row(
            transaction,
            &AuditEvent {
                id: unique_id("aud"),
                company_id: company_id.to_string(),
                actor: actor.to_string(),
                action: "order.amended".to_string(),
                record_type: "order".to_string(),
                record_id: id.to_string(),
                record_label: order.number.clone(),
                timestamp: now.clone(),
                detail: Some(reason.trim().to_string()),
            },
        )?;

        order_detail(transaction, company_id, id)
    })
}

// ---------------------------------------------------------------------------
// Bills of materials
// ---------------------------------------------------------------------------

const BOM_COLUMNS: &str = "id, company_id, item_id, version, output_quantity_milli, status, \
     effective_from, narration, created_at, updated_at";

fn bom_from_row(row: &Row<'_>) -> rusqlite::Result<Bom> {
    Ok(Bom {
        id: row.get(0)?,
        company_id: row.get(1)?,
        item_id: row.get(2)?,
        version: row.get(3)?,
        output_quantity_milli: row.get(4)?,
        status: row.get(5)?,
        effective_from: row.get(6)?,
        narration: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

/// The component lines of a structure.
fn bom_lines(
    connection: &Connection,
    company_id: &str,
    bom_id: &str,
) -> Result<Vec<BomLine>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, company_id, bom_id, item_id, quantity_milli, conversion_milli, created_at
             FROM bom_lines WHERE company_id = ?1 AND bom_id = ?2 ORDER BY id",
        )
        .map_err(|error| db_error("The structure lines could not be read", error))?;
    let rows = statement
        .query_map(params![company_id, bom_id], |row| {
            Ok(BomLine {
                id: row.get(0)?,
                company_id: row.get(1)?,
                bom_id: row.get(2)?,
                item_id: row.get(3)?,
                quantity_milli: row.get(4)?,
                conversion_milli: row.get(5)?,
                created_at: row.get(6)?,
            })
        })
        .map_err(|error| db_error("The structure lines could not be read", error))?;
    let mut lines = Vec::new();
    for line in rows {
        lines.push(line.map_err(|error| db_error("A structure line is unreadable", error))?);
    }
    Ok(lines)
}

/// One structure of a company.
fn find_bom(connection: &Connection, company_id: &str, id: &str) -> Result<Bom, String> {
    connection
        .query_row(
            &format!("SELECT {BOM_COLUMNS} FROM boms WHERE company_id = ?1 AND id = ?2"),
            params![company_id, id],
            bom_from_row,
        )
        .optional()
        .map_err(|error| db_error("The structure could not be read", error))?
        .ok_or_else(|| format!("The structure {id} does not exist in this company."))
}

/// A structure with its component lines.
fn bom_detail(
    connection: &Connection,
    company_id: &str,
    id: &str,
) -> Result<BomDetail, String> {
    let bom = find_bom(connection, company_id, id)?;
    Ok(BomDetail {
        lines: bom_lines(connection, company_id, id)?,
        bom,
    })
}

/// The structures of a company, newest version first.
pub fn list_boms(
    database: &Database,
    company_id: &str,
    item_id: Option<&str>,
) -> Result<Vec<BomDetail>, String> {
    let connection = database.lock();
    let mut sql = format!("SELECT {BOM_COLUMNS} FROM boms WHERE company_id = ?1");
    let mut values: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(company_id.to_string())];
    if let Some(item_id) = item_id {
        if item_id != "all" {
            values.push(Box::new(item_id.to_string()));
            sql.push_str(&format!(" AND item_id = ?{}", values.len()));
        }
    }
    sql.push_str(" ORDER BY item_id, version DESC, id");

    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| db_error("The structures could not be read", error))?;
    let rows = statement
        .query_map(rusqlite::params_from_iter(values), bom_from_row)
        .map_err(|error| db_error("The structures could not be read", error))?;
    let mut boms = Vec::new();
    for bom in rows {
        boms.push(bom.map_err(|error| db_error("A structure is unreadable", error))?);
    }
    drop(statement);

    let mut details = Vec::new();
    for bom in boms {
        let lines = bom_lines(&connection, company_id, &bom.id)?;
        details.push(BomDetail { bom, lines });
    }
    Ok(details)
}

/// Save a structure and its component lines, in one transaction.
pub fn save_bom(
    database: &Database,
    bom: Bom,
    lines: Vec<BomLine>,
) -> Result<BomDetail, String> {
    database.transaction(|transaction| {
        ensure_company(transaction, &bom.company_id)?;
        if bom.id.trim().is_empty() {
            return Err("A structure needs an identifier.".to_string());
        }
        if bom.output_quantity_milli <= 0 {
            return Err("The output quantity of a structure must be positive.".to_string());
        }
        check_quantity(bom.output_quantity_milli, "The output quantity")?;
        if bom.version < 0 {
            return Err("A structure version cannot be negative.".to_string());
        }
        for line in &lines {
            if line.id.trim().is_empty() {
                return Err("A structure line needs an identifier.".to_string());
            }
            if line.quantity_milli < 0 {
                return Err("A component quantity cannot be negative.".to_string());
            }
            check_quantity(line.quantity_milli, "The component quantity")?;
            if line.conversion_milli <= 0 {
                return Err("A component conversion must be positive.".to_string());
            }
            check_quantity(line.conversion_milli, "The component conversion")?;
        }

        let owner: Option<String> = transaction
            .query_row(
                "SELECT company_id FROM boms WHERE id = ?1",
                params![bom.id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| db_error("The structure could not be read", error))?;
        if let Some(owner) = owner {
            if owner != bom.company_id {
                return Err(format!(
                    "The structure {} belongs to another company and cannot be changed here.",
                    bom.id
                ));
            }
        }

        let item_ids = unique_values(
            std::iter::once(bom.item_id.clone()).chain(lines.iter().map(|line| line.item_id.clone())),
        );
        ensure_items_in_company(transaction, &bom.company_id, &item_ids)?;

        transaction
            .execute(
                "INSERT INTO boms (id, company_id, item_id, version, output_quantity_milli,
                    status, effective_from, narration, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                 ON CONFLICT(id) DO UPDATE SET
                    item_id = excluded.item_id,
                    version = excluded.version,
                    output_quantity_milli = excluded.output_quantity_milli,
                    status = excluded.status,
                    effective_from = excluded.effective_from,
                    narration = excluded.narration,
                    updated_at = excluded.updated_at",
                params![
                    bom.id,
                    bom.company_id,
                    bom.item_id,
                    bom.version,
                    bom.output_quantity_milli,
                    bom.status,
                    bom.effective_from,
                    bom.narration,
                    bom.created_at,
                    bom.updated_at,
                ],
            )
            .map_err(|error| db_error("The structure could not be saved", error))?;

        // The component lines are replaced by the ones given.
        let existing = bom_lines(transaction, &bom.company_id, &bom.id)?;
        for line in &lines {
            if existing.iter().any(|current| current.id == line.id) {
                transaction
                    .execute(
                        "UPDATE bom_lines SET item_id = ?2, quantity_milli = ?3, conversion_milli = ?4
                         WHERE id = ?1 AND company_id = ?5",
                        params![
                            line.id,
                            line.item_id,
                            line.quantity_milli,
                            line.conversion_milli,
                            bom.company_id,
                        ],
                    )
                    .map_err(|error| db_error("A structure line could not be saved", error))?;
                continue;
            }
            let owner: Option<String> = transaction
                .query_row(
                    "SELECT bom_id FROM bom_lines WHERE id = ?1",
                    params![line.id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|error| db_error("The structure lines could not be read", error))?;
            if let Some(owner) = owner {
                return Err(format!(
                    "The structure line {} belongs to the structure {owner} and cannot be used here.",
                    line.id
                ));
            }
            transaction
                .execute(
                    "INSERT INTO bom_lines (id, company_id, bom_id, item_id, quantity_milli,
                        conversion_milli, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        line.id,
                        bom.company_id,
                        bom.id,
                        line.item_id,
                        line.quantity_milli,
                        line.conversion_milli,
                        line.created_at,
                    ],
                )
                .map_err(|error| db_error("A structure line could not be written", error))?;
        }
        for current in &existing {
            if lines.iter().any(|line| line.id == current.id) {
                continue;
            }
            transaction
                .execute(
                    "DELETE FROM bom_lines WHERE id = ?1 AND company_id = ?2",
                    params![current.id, bom.company_id],
                )
                .map_err(|error| db_error("A structure line could not be removed", error))?;
        }

        bom_detail(transaction, &bom.company_id, &bom.id)
    })
}

/// Release a structure, and supersede the version it replaces.
///
/// A released structure is immutable, so a change is a new version. The
/// version it replaces is marked as superseded, so the books always show one
/// released structure for an item.
pub fn release_bom(
    database: &Database,
    company_id: &str,
    id: &str,
    actor: &str,
) -> Result<BomDetail, String> {
    database.transaction(|transaction| {
        ensure_company(transaction, company_id)?;
        let bom = find_bom(transaction, company_id, id)?;
        let lines = bom_lines(transaction, company_id, id)?;
        if lines.is_empty() {
            return Err("A structure needs at least one component before it can be released.".to_string());
        }

        let now = migrations::now_iso();
        // The version it replaces is superseded.
        transaction
            .execute(
                "UPDATE boms SET status = 'superseded', updated_at = ?4
                 WHERE company_id = ?1 AND item_id = ?2 AND status = 'released' AND id <> ?3",
                params![company_id, bom.item_id, id, now],
            )
            .map_err(|error| db_error("The structure could not be released", error))?;
        transaction
            .execute(
                "UPDATE boms SET status = 'released', updated_at = ?2 WHERE id = ?1 AND company_id = ?3",
                params![id, now, company_id],
            )
            .map_err(|error| db_error("The structure could not be released", error))?;

        insert_audit_event_row(
            transaction,
            &AuditEvent {
                id: unique_id("aud"),
                company_id: company_id.to_string(),
                actor: actor.to_string(),
                action: "bom.released".to_string(),
                record_type: "bom".to_string(),
                record_id: id.to_string(),
                record_label: format!("{} v{}", bom.item_id, bom.version),
                timestamp: now.clone(),
                detail: Some(format!("Structure version {} released", bom.version)),
            },
        )?;

        bom_detail(transaction, company_id, id)
    })
}

// ---------------------------------------------------------------------------
// Production
// ---------------------------------------------------------------------------

const PRODUCTION_ORDER_COLUMNS: &str = "id, company_id, number, item_id, bom_id, bom_version, \
     planned_quantity_milli, status, godown_id, planned_at, narration, revision, created_at, updated_at";

fn production_order_from_row(row: &Row<'_>) -> rusqlite::Result<ProductionOrder> {
    Ok(ProductionOrder {
        id: row.get(0)?,
        company_id: row.get(1)?,
        number: row.get(2)?,
        item_id: row.get(3)?,
        bom_id: row.get(4)?,
        bom_version: row.get(5)?,
        planned_quantity_milli: row.get(6)?,
        status: row.get(7)?,
        godown_id: row.get(8)?,
        planned_at: row.get(9)?,
        narration: row.get(10)?,
        revision: row.get(11)?,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
    })
}

fn production_requirement_from_row(row: &Row<'_>) -> rusqlite::Result<ProductionRequirement> {
    Ok(ProductionRequirement {
        id: row.get(0)?,
        company_id: row.get(1)?,
        production_order_id: row.get(2)?,
        item_id: row.get(3)?,
        requirement_quantity_milli: row.get(4)?,
        conversion_milli: row.get(5)?,
        required_quantity_milli: row.get(6)?,
        issued_quantity_milli: row.get(7)?,
        created_at: row.get(8)?,
    })
}

fn production_issue_from_row(row: &Row<'_>) -> rusqlite::Result<ProductionIssue> {
    Ok(ProductionIssue {
        id: row.get(0)?,
        company_id: row.get(1)?,
        production_order_id: row.get(2)?,
        requirement_id: row.get(3)?,
        item_id: row.get(4)?,
        godown_id: row.get(5)?,
        quantity_milli: row.get(6)?,
        rate: row.get(7)?,
        cost: row.get(8)?,
        voucher_id: row.get(9)?,
        voucher_item_id: row.get(10)?,
        created_at: row.get(11)?,
    })
}

fn production_completion_from_row(row: &Row<'_>) -> rusqlite::Result<ProductionCompletion> {
    Ok(ProductionCompletion {
        id: row.get(0)?,
        company_id: row.get(1)?,
        production_order_id: row.get(2)?,
        item_id: row.get(3)?,
        godown_id: row.get(4)?,
        quantity_milli: row.get(5)?,
        rate: row.get(6)?,
        cost: row.get(7)?,
        voucher_id: row.get(8)?,
        voucher_item_id: row.get(9)?,
        created_at: row.get(10)?,
    })
}

/// The components a production order needs.
fn production_requirements(
    connection: &Connection,
    company_id: &str,
    production_order_id: &str,
) -> Result<Vec<ProductionRequirement>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, company_id, production_order_id, item_id, requirement_quantity_milli,
                conversion_milli, required_quantity_milli, issued_quantity_milli, created_at
             FROM production_requirements WHERE company_id = ?1 AND production_order_id = ?2
             ORDER BY id",
        )
        .map_err(|error| db_error("The production requirements could not be read", error))?;
    let rows = statement
        .query_map(params![company_id, production_order_id], production_requirement_from_row)
        .map_err(|error| db_error("The production requirements could not be read", error))?;
    let mut requirements = Vec::new();
    for requirement in rows {
        requirements
            .push(requirement.map_err(|error| db_error("A requirement is unreadable", error))?);
    }
    Ok(requirements)
}

/// The components issued against a production order.
fn production_issues(
    connection: &Connection,
    company_id: &str,
    production_order_id: &str,
) -> Result<Vec<ProductionIssue>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, company_id, production_order_id, requirement_id, item_id, godown_id,
                quantity_milli, rate, cost, voucher_id, voucher_item_id, created_at
             FROM production_issues WHERE company_id = ?1 AND production_order_id = ?2
             ORDER BY created_at, id",
        )
        .map_err(|error| db_error("The production issues could not be read", error))?;
    let rows = statement
        .query_map(params![company_id, production_order_id], production_issue_from_row)
        .map_err(|error| db_error("The production issues could not be read", error))?;
    let mut issues = Vec::new();
    for issue in rows {
        issues.push(issue.map_err(|error| db_error("A production issue is unreadable", error))?);
    }
    Ok(issues)
}

/// The finished goods received against a production order.
fn production_completions(
    connection: &Connection,
    company_id: &str,
    production_order_id: &str,
) -> Result<Vec<ProductionCompletion>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, company_id, production_order_id, item_id, godown_id, quantity_milli, rate,
                cost, voucher_id, voucher_item_id, created_at
             FROM production_completions WHERE company_id = ?1 AND production_order_id = ?2
             ORDER BY created_at, id",
        )
        .map_err(|error| db_error("The production completions could not be read", error))?;
    let rows = statement
        .query_map(
            params![company_id, production_order_id],
            production_completion_from_row,
        )
        .map_err(|error| db_error("The production completions could not be read", error))?;
    let mut completions = Vec::new();
    for completion in rows {
        completions
            .push(completion.map_err(|error| db_error("A production completion is unreadable", error))?);
    }
    Ok(completions)
}

/// One production order of a company.
fn find_production_order(
    connection: &Connection,
    company_id: &str,
    id: &str,
) -> Result<ProductionOrder, String> {
    connection
        .query_row(
            &format!(
                "SELECT {PRODUCTION_ORDER_COLUMNS} FROM production_orders
                 WHERE company_id = ?1 AND id = ?2"
            ),
            params![company_id, id],
            production_order_from_row,
        )
        .optional()
        .map_err(|error| db_error("The production order could not be read", error))?
        .ok_or_else(|| format!("The production order {id} does not exist in this company."))
}

/// A production order with its requirements, its issues and its completions.
fn production_order_detail(
    connection: &Connection,
    company_id: &str,
    id: &str,
) -> Result<ProductionOrderDetail, String> {
    let order = find_production_order(connection, company_id, id)?;
    Ok(ProductionOrderDetail {
        requirements: production_requirements(connection, company_id, id)?,
        issues: production_issues(connection, company_id, id)?,
        completions: production_completions(connection, company_id, id)?,
        order,
    })
}

/// The quantity a component is needed for, exactly.
///
/// This is the arithmetic the domain does: the requirement per unit of output,
/// times the planned output, divided by the output the structure makes, and
/// then converted into the component's own stock unit. The working is exact
/// integer arithmetic, and half a milli-unit goes away from zero.
fn required_quantity_milli(
    requirement_quantity_milli: i64,
    conversion_milli: i64,
    planned_quantity_milli: i64,
    output_quantity_milli: i64,
) -> Result<i64, String> {
    if output_quantity_milli <= 0 {
        return Err("The output quantity of a structure must be positive.".to_string());
    }
    let numerator = (requirement_quantity_milli as i128)
        * (planned_quantity_milli as i128)
        * (conversion_milli as i128);
    let denominator = (output_quantity_milli as i128) * 1000;
    let mut result = numerator / denominator;
    let remainder = numerator % denominator;
    if remainder * 2 >= denominator {
        result += 1;
    }
    if result > MAX_MONEY_MINOR as i128 || result < -(MAX_MONEY_MINOR as i128) {
        return Err("The required quantity is outside the supported range.".to_string());
    }
    Ok(result as i64)
}

/// The production orders of a company, newest first.
pub fn list_production_orders(
    database: &Database,
    company_id: &str,
) -> Result<Vec<ProductionOrder>, String> {
    let connection = database.lock();
    let mut statement = connection
        .prepare(&format!(
            "SELECT {PRODUCTION_ORDER_COLUMNS} FROM production_orders
             WHERE company_id = ?1 ORDER BY planned_at DESC, created_at DESC, id"
        ))
        .map_err(|error| db_error("The production orders could not be read", error))?;
    let rows = statement
        .query_map(params![company_id], production_order_from_row)
        .map_err(|error| db_error("The production orders could not be read", error))?;
    let mut orders = Vec::new();
    for order in rows {
        orders.push(order.map_err(|error| db_error("A production order is unreadable", error))?);
    }
    Ok(orders)
}

/// One production order, with its requirements, its issues and its completions.
pub fn get_production_order(
    database: &Database,
    company_id: &str,
    id: &str,
) -> Result<ProductionOrderDetail, String> {
    let connection = database.lock();
    production_order_detail(&connection, company_id, id)
}

/// Save a production order and its requirements, in one transaction.
///
/// The requirements are the ones the caller computed. A requirement that has
/// already been issued against is never replaced, because the issue history
/// points at it.
pub fn save_production_order(
    database: &Database,
    order: ProductionOrder,
    requirements: Vec<ProductionRequirement>,
) -> Result<ProductionOrderDetail, String> {
    database.transaction(|transaction| {
        ensure_company(transaction, &order.company_id)?;
        if order.id.trim().is_empty() {
            return Err("A production order needs an identifier.".to_string());
        }
        if order.number.trim().is_empty() {
            return Err("A production order needs a number.".to_string());
        }
        if order.planned_quantity_milli <= 0 {
            return Err("A production order must plan a positive quantity.".to_string());
        }
        check_quantity(order.planned_quantity_milli, "The planned quantity")?;

        let owner: Option<String> = transaction
            .query_row(
                "SELECT company_id FROM production_orders WHERE id = ?1",
                params![order.id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| db_error("The production order could not be read", error))?;
        if let Some(owner) = owner {
            if owner != order.company_id {
                return Err(format!(
                    "The production order {} belongs to another company and cannot be changed here.",
                    order.id
                ));
            }
        }

        let item_ids = unique_values(
            std::iter::once(order.item_id.clone())
                .chain(requirements.iter().map(|requirement| requirement.item_id.clone())),
        );
        ensure_items_in_company(transaction, &order.company_id, &item_ids)?;
        ensure_godowns_in_company(transaction, &order.company_id, &[order.godown_id.clone()])?;

        transaction
            .execute(
                "INSERT INTO production_orders (id, company_id, number, item_id, bom_id, bom_version,
                    planned_quantity_milli, status, godown_id, planned_at, narration, revision,
                    created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
                 ON CONFLICT(id) DO UPDATE SET
                    number = excluded.number,
                    item_id = excluded.item_id,
                    bom_id = excluded.bom_id,
                    bom_version = excluded.bom_version,
                    planned_quantity_milli = excluded.planned_quantity_milli,
                    status = excluded.status,
                    godown_id = excluded.godown_id,
                    planned_at = excluded.planned_at,
                    narration = excluded.narration,
                    revision = excluded.revision,
                    updated_at = excluded.updated_at",
                params![
                    order.id,
                    order.company_id,
                    order.number,
                    order.item_id,
                    order.bom_id,
                    order.bom_version,
                    order.planned_quantity_milli,
                    order.status,
                    order.godown_id,
                    order.planned_at,
                    order.narration,
                    order.revision,
                    order.created_at,
                    order.updated_at,
                ],
            )
            .map_err(|error| db_error("The production order could not be saved", error))?;

        // The requirements are replaced by the ones given, unless something has
        // already been issued against them.
        let existing = production_requirements(transaction, &order.company_id, &order.id)?;
        for requirement in &existing {
            if requirement.issued_quantity_milli > 0 {
                return Err(
                    "The requirements of this production order have already been issued against \
                     and cannot be changed."
                        .to_string(),
                );
            }
        }
        transaction
            .execute(
                "DELETE FROM production_requirements WHERE company_id = ?1 AND production_order_id = ?2",
                params![order.company_id, order.id],
            )
            .map_err(|error| db_error("The production requirements could not be replaced", error))?;
        for requirement in &requirements {
            transaction
                .execute(
                    "INSERT INTO production_requirements (id, company_id, production_order_id, item_id,
                        requirement_quantity_milli, conversion_milli, required_quantity_milli,
                        issued_quantity_milli, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    params![
                        requirement.id,
                        order.company_id,
                        order.id,
                        requirement.item_id,
                        requirement.requirement_quantity_milli,
                        requirement.conversion_milli,
                        requirement.required_quantity_milli,
                        requirement.issued_quantity_milli,
                        requirement.created_at,
                    ],
                )
                .map_err(|error| db_error("A production requirement could not be written", error))?;
        }

        production_order_detail(transaction, &order.company_id, &order.id)
    })
}

/// Release a production order and snapshot the structure it was made against.
///
/// The components the order needs are the lines of the released structure,
/// with the quantity for the whole planned output worked out exactly. The
/// snapshot is fixed at release, so a later version of the structure cannot
/// change what the order needs.
pub fn release_production_order(
    database: &Database,
    company_id: &str,
    id: &str,
    actor: &str,
) -> Result<ProductionOrderDetail, String> {
    database.transaction(|transaction| {
        ensure_company(transaction, company_id)?;
        let order = find_production_order(transaction, company_id, id)?;
        if order.planned_quantity_milli <= 0 {
            return Err("A production order must plan a positive quantity.".to_string());
        }

        // The structure must be released, and the company must have inventory
        // in force, or there is no stock to issue from and no cost to transfer.
        let bom = find_bom(transaction, company_id, &order.bom_id)?;
        if bom.status != "released" {
            return Err(
                "A production order can only be released against a released structure.".to_string(),
            );
        }
        let lines = bom_lines(transaction, company_id, &order.bom_id)?;
        if lines.is_empty() {
            return Err("The structure has no components, so nothing would be produced.".to_string());
        }
        let activated: Option<i64> = transaction
            .query_row(
                "SELECT 1 FROM inventory_accounts WHERE company_id = ?1",
                params![company_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| db_error("The inventory accounts could not be read", error))?;
        if activated.is_none() {
            return Err(
                "Inventory must be activated before a production order can be released.".to_string(),
            );
        }

        // The requirements are fixed once something has been issued against
        // them, so an order that has been issued against is not released again.
        let existing = production_requirements(transaction, company_id, id)?;
        let issued: i64 = existing
            .iter()
            .map(|requirement| requirement.issued_quantity_milli)
            .sum();
        if issued > 0 {
            return Err(
                "This production order has already been released, so its requirements are fixed."
                    .to_string(),
            );
        }

        let now = migrations::now_iso();
        transaction
            .execute(
                "DELETE FROM production_requirements WHERE company_id = ?1 AND production_order_id = ?2",
                params![company_id, id],
            )
            .map_err(|error| db_error("The production requirements could not be replaced", error))?;
        for line in &lines {
            let required = required_quantity_milli(
                line.quantity_milli,
                line.conversion_milli,
                order.planned_quantity_milli,
                bom.output_quantity_milli,
            )?;
            transaction
                .execute(
                    "INSERT INTO production_requirements (id, company_id, production_order_id, item_id,
                        requirement_quantity_milli, conversion_milli, required_quantity_milli,
                        issued_quantity_milli, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8)",
                    params![
                        unique_id("prd-req"),
                        company_id,
                        id,
                        line.item_id,
                        line.quantity_milli,
                        line.conversion_milli,
                        required,
                        now,
                    ],
                )
                .map_err(|error| db_error("A production requirement could not be written", error))?;
        }

        transaction
            .execute(
                "UPDATE production_orders SET status = 'released', revision = revision + 1, updated_at = ?2
                 WHERE id = ?1 AND company_id = ?3",
                params![id, now, company_id],
            )
            .map_err(|error| db_error("The production order could not be released", error))?;

        insert_audit_event_row(
            transaction,
            &AuditEvent {
                id: unique_id("aud"),
                company_id: company_id.to_string(),
                actor: actor.to_string(),
                action: "production_order.released".to_string(),
                record_type: "production_order".to_string(),
                record_id: id.to_string(),
                record_label: order.number.clone(),
                timestamp: now.clone(),
                detail: Some(format!(
                    "{} units of {} against structure version {}",
                    order.planned_quantity_milli, order.item_id, order.bom_version
                )),
            },
        )?;

        production_order_detail(transaction, company_id, id)
    })
}

// ---------------------------------------------------------------------------
// The fulfilment, issue and completion a posting carries
// ---------------------------------------------------------------------------

/// The voucher and the voucher line must both belong to the company.
fn ensure_voucher_line_in_company(
    transaction: &Transaction<'_>,
    voucher: &Voucher,
    voucher_id: &str,
    voucher_item_id: &str,
) -> Result<(), String> {
    let voucher_owner: Option<String> = transaction
        .query_row(
            "SELECT company_id FROM vouchers WHERE id = ?1",
            params![voucher_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| db_error("The voucher could not be read", error))?;
    match voucher_owner {
        Some(owner) if owner == voucher.company_id => {}
        Some(_) => {
            return Err(
                "This record points at a voucher that does not belong to this company. \
                 Nothing was posted."
                    .to_string(),
            )
        }
        None => return Err(format!("The voucher {voucher_id} does not exist.")),
    }

    let line_owner: Option<(String, String)> = transaction
        .query_row(
            "SELECT company_id, voucher_id FROM voucher_items WHERE id = ?1",
            params![voucher_item_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| db_error("The voucher line could not be read", error))?;
    match line_owner {
        Some((owner, owner_voucher)) if owner == voucher.company_id => {
            if owner_voucher != voucher.id {
                return Err(
                    "This record points at a line of another voucher. Nothing was posted."
                        .to_string(),
                );
            }
        }
        Some(_) => {
            return Err(
                "This record points at a voucher line that does not belong to this company. \
                 Nothing was posted."
                    .to_string(),
            )
        }
        None => return Err(format!("The voucher line {voucher_item_id} does not exist.")),
    }
    Ok(())
}

/// The message a refused fulfilment carries.
fn order_fulfilment_error(error: &rusqlite::Error) -> String {
    let text = error.to_string();
    if text.contains("order_line_id") || text.contains("voucher_item_id") {
        return ORDER_FULFILMENT_DUPLICATE_MESSAGE.to_string();
    }
    if text.contains("FOREIGN KEY") {
        return "A fulfilment points at an order, an order line or a voucher that does not belong to this company. Nothing was posted.".to_string();
    }
    db_error("A fulfilment could not be saved. Nothing was posted.", error)
}

/// The message a refused production issue carries.
fn production_issue_error(error: &rusqlite::Error) -> String {
    let text = error.to_string();
    if text.contains("requirement_id") || text.contains("voucher_item_id") {
        return PRODUCTION_ISSUE_DUPLICATE_MESSAGE.to_string();
    }
    if text.contains("FOREIGN KEY") {
        return "An issue points at a requirement, a godown or a voucher that does not belong to this company. Nothing was posted.".to_string();
    }
    db_error("A production issue could not be saved. Nothing was posted.", error)
}

/// The message a refused production completion carries.
fn production_completion_error(error: &rusqlite::Error) -> String {
    let text = error.to_string();
    if text.contains("voucher_item_id") {
        return PRODUCTION_COMPLETION_DUPLICATE_MESSAGE.to_string();
    }
    if text.contains("FOREIGN KEY") {
        return "A completion points at a production order, a godown or a voucher that does not belong to this company. Nothing was posted.".to_string();
    }
    db_error("A production completion could not be saved. Nothing was posted.", error)
}

/// Write the order lines the voucher delivers against.
fn write_order_fulfilments(
    transaction: &Transaction<'_>,
    voucher: &Voucher,
    fulfilments: &[OrderFulfilment],
) -> Result<(), String> {
    for fulfilment in fulfilments {
        if fulfilment.company_id != voucher.company_id {
            return Err(
                "An order fulfilment must belong to the company of its voucher. Nothing was posted."
                    .to_string(),
            );
        }
        ensure_voucher_line_in_company(
            transaction,
            voucher,
            &fulfilment.voucher_id,
            &fulfilment.voucher_item_id,
        )?;

        // The order line must belong to this company.
        let owner: Option<String> = transaction
            .query_row(
                "SELECT company_id FROM order_lines WHERE id = ?1",
                params![fulfilment.order_line_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| db_error("The order lines could not be read", error))?;
        match owner {
            Some(owner) if owner == voucher.company_id => {}
            Some(_) => {
                return Err(
                    "This fulfilment points at an order line that does not belong to this company. \
                     Nothing was posted."
                        .to_string(),
                )
            }
            None => {
                return Err(format!(
                    "The order line {} does not exist. Nothing was posted.",
                    fulfilment.order_line_id
                ))
            }
        }

        transaction
            .execute(
                "INSERT INTO order_fulfilments (id, company_id, order_id, order_line_id, voucher_id,
                    voucher_item_id, quantity_milli, amount, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    fulfilment.id,
                    fulfilment.company_id,
                    fulfilment.order_id,
                    fulfilment.order_line_id,
                    fulfilment.voucher_id,
                    fulfilment.voucher_item_id,
                    fulfilment.quantity_milli,
                    fulfilment.amount,
                    fulfilment.created_at,
                ],
            )
            .map_err(|error| order_fulfilment_error(&error))?;
    }
    Ok(())
}

/// Write the components the voucher issues against production orders, and
/// record how much has been issued against each requirement.
fn write_production_issues(
    transaction: &Transaction<'_>,
    voucher: &Voucher,
    issues: &[ProductionIssue],
) -> Result<(), String> {
    for issue in issues {
        if issue.company_id != voucher.company_id {
            return Err(
                "A production issue must belong to the company of its voucher. Nothing was posted."
                    .to_string(),
            );
        }
        ensure_voucher_line_in_company(
            transaction,
            voucher,
            &issue.voucher_id,
            &issue.voucher_item_id,
        )?;

        // The requirement must belong to this company and to this order.
        let requirement: Option<(String, String)> = transaction
            .query_row(
                "SELECT company_id, production_order_id FROM production_requirements WHERE id = ?1",
                params![issue.requirement_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|error| db_error("The production requirements could not be read", error))?;
        match requirement {
            Some((owner, order_id)) if owner == voucher.company_id => {
                if order_id != issue.production_order_id {
                    return Err(
                        "This issue points at a requirement of another production order. \
                         Nothing was posted."
                            .to_string(),
                    );
                }
            }
            Some(_) => {
                return Err(
                    "This issue points at a requirement that does not belong to this company. \
                     Nothing was posted."
                        .to_string(),
                )
            }
            None => {
                return Err(format!(
                    "The requirement {} does not exist. Nothing was posted.",
                    issue.requirement_id
                ))
            }
        }

        ensure_items_in_company(transaction, &voucher.company_id, &[issue.item_id.clone()])?;
        ensure_godowns_in_company(transaction, &voucher.company_id, &[issue.godown_id.clone()])?;

        transaction
            .execute(
                "INSERT INTO production_issues (id, company_id, production_order_id, requirement_id,
                    item_id, godown_id, quantity_milli, rate, cost, voucher_id, voucher_item_id,
                    created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![
                    issue.id,
                    issue.company_id,
                    issue.production_order_id,
                    issue.requirement_id,
                    issue.item_id,
                    issue.godown_id,
                    issue.quantity_milli,
                    issue.rate,
                    issue.cost,
                    issue.voucher_id,
                    issue.voucher_item_id,
                    issue.created_at,
                ],
            )
            .map_err(|error| production_issue_error(&error))?;

        // The requirement records how much has been issued against it.
        transaction
            .execute(
                "UPDATE production_requirements
                 SET issued_quantity_milli = issued_quantity_milli + ?3
                 WHERE id = ?1 AND company_id = ?2",
                params![issue.requirement_id, voucher.company_id, issue.quantity_milli],
            )
            .map_err(|error| db_error("The production requirement could not be updated", error))?;
    }
    Ok(())
}

/// Write the finished goods the voucher receives into stock.
fn write_production_completions(
    transaction: &Transaction<'_>,
    voucher: &Voucher,
    completions: &[ProductionCompletion],
) -> Result<(), String> {
    for completion in completions {
        if completion.company_id != voucher.company_id {
            return Err(
                "A production completion must belong to the company of its voucher. \
                 Nothing was posted."
                    .to_string(),
            );
        }
        ensure_voucher_line_in_company(
            transaction,
            voucher,
            &completion.voucher_id,
            &completion.voucher_item_id,
        )?;

        // The production order must belong to this company.
        let owner: Option<String> = transaction
            .query_row(
                "SELECT company_id FROM production_orders WHERE id = ?1",
                params![completion.production_order_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| db_error("The production orders could not be read", error))?;
        match owner {
            Some(owner) if owner == voucher.company_id => {}
            Some(_) => {
                return Err(
                    "This completion points at a production order that does not belong to this \
                     company. Nothing was posted."
                        .to_string(),
                )
            }
            None => {
                return Err(format!(
                    "The production order {} does not exist. Nothing was posted.",
                    completion.production_order_id
                ))
            }
        }

        ensure_items_in_company(transaction, &voucher.company_id, &[completion.item_id.clone()])?;
        ensure_godowns_in_company(transaction, &voucher.company_id, &[completion.godown_id.clone()])?;

        transaction
            .execute(
                "INSERT INTO production_completions (id, company_id, production_order_id, item_id,
                    godown_id, quantity_milli, rate, cost, voucher_id, voucher_item_id, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    completion.id,
                    completion.company_id,
                    completion.production_order_id,
                    completion.item_id,
                    completion.godown_id,
                    completion.quantity_milli,
                    completion.rate,
                    completion.cost,
                    completion.voucher_id,
                    completion.voucher_item_id,
                    completion.created_at,
                ],
            )
            .map_err(|error| production_completion_error(&error))?;

        // The production order is complete.
        transaction
            .execute(
                "UPDATE production_orders SET status = 'completed', updated_at = ?2
                 WHERE id = ?1 AND company_id = ?3",
                params![completion.production_order_id, voucher.updated_at, voucher.company_id],
            )
            .map_err(|error| db_error("The production order could not be completed", error))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// The commands the application calls
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn save_order_cmd(
    workspace: State<'_, Workspace>,
    order: Order,
    lines: Vec<OrderLine>,
) -> Result<OrderDetail, String> {
    workspace.with_database(|db| save_order(db, order, lines))
}

#[tauri::command]
pub fn list_orders_cmd(
    workspace: State<'_, Workspace>,
    company_id: String,
    kind: Option<String>,
) -> Result<Vec<OrderSummary>, String> {
    workspace.with_database(|db| list_orders(db, &company_id, kind.as_deref()))
}

#[tauri::command]
pub fn get_order_cmd(
    workspace: State<'_, Workspace>,
    company_id: String,
    id: String,
) -> Result<OrderDetail, String> {
    workspace.with_database(|db| get_order(db, &company_id, &id))
}

#[tauri::command]
pub fn confirm_order_cmd(
    workspace: State<'_, Workspace>,
    company_id: String,
    id: String,
    actor: String,
) -> Result<OrderDetail, String> {
    workspace.with_database(|db| confirm_order(db, &company_id, &id, &actor))
}

#[tauri::command]
pub fn cancel_order_cmd(
    workspace: State<'_, Workspace>,
    company_id: String,
    id: String,
    reason: String,
    actor: String,
) -> Result<OrderDetail, String> {
    workspace.with_database(|db| cancel_order(db, &company_id, &id, &reason, &actor))
}

#[tauri::command]
pub fn amend_order_cmd(
    workspace: State<'_, Workspace>,
    company_id: String,
    id: String,
    lines: Vec<OrderLine>,
    reason: String,
    actor: String,
) -> Result<OrderDetail, String> {
    workspace.with_database(|db| amend_order(db, &company_id, &id, lines, &reason, &actor))
}

#[tauri::command]
pub fn list_boms_cmd(
    workspace: State<'_, Workspace>,
    company_id: String,
    item_id: Option<String>,
) -> Result<Vec<BomDetail>, String> {
    workspace.with_database(|db| list_boms(db, &company_id, item_id.as_deref()))
}

#[tauri::command]
pub fn save_bom_cmd(
    workspace: State<'_, Workspace>,
    bom: Bom,
    lines: Vec<BomLine>,
) -> Result<BomDetail, String> {
    workspace.with_database(|db| save_bom(db, bom, lines))
}

#[tauri::command]
pub fn release_bom_cmd(
    workspace: State<'_, Workspace>,
    company_id: String,
    id: String,
    actor: String,
) -> Result<BomDetail, String> {
    workspace.with_database(|db| release_bom(db, &company_id, &id, &actor))
}

#[tauri::command]
pub fn list_production_orders_cmd(
    workspace: State<'_, Workspace>,
    company_id: String,
) -> Result<Vec<ProductionOrder>, String> {
    workspace.with_database(|db| list_production_orders(db, &company_id))
}

#[tauri::command]
pub fn get_production_order_cmd(
    workspace: State<'_, Workspace>,
    company_id: String,
    id: String,
) -> Result<ProductionOrderDetail, String> {
    workspace.with_database(|db| get_production_order(db, &company_id, &id))
}

#[tauri::command]
pub fn save_production_order_cmd(
    workspace: State<'_, Workspace>,
    order: ProductionOrder,
    requirements: Vec<ProductionRequirement>,
) -> Result<ProductionOrderDetail, String> {
    workspace.with_database(|db| save_production_order(db, order, requirements))
}

#[tauri::command]
pub fn release_production_order_cmd(
    workspace: State<'_, Workspace>,
    company_id: String,
    id: String,
    actor: String,
) -> Result<ProductionOrderDetail, String> {
    workspace.with_database(|db| release_production_order(db, &company_id, &id, &actor))
}
