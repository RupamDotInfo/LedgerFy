//! Integration tests for the inventory engine.
//!
//! These drive the same functions the Tauri commands call, against a real
//! SQLite database in a temporary directory.

use std::path::PathBuf;

use rusqlite::params;

use ledgerfy_lib::commands::{
    cancel_voucher, create_opening_stock, get_inventory_accounts, insert_company,
    list_audit_events, list_stock_balances, list_stock_movements,
    list_stock_pools, list_vouchers, post_voucher, rebuild_stock_balances, save_godown,
    save_inventory_accounts, save_item, save_ledger, STOCK_CONFLICT_MESSAGE,
    STOCK_DUPLICATE_MESSAGE,
};
use ledgerfy_lib::db::Database;
use ledgerfy_lib::entities::*;

const COMPANY: &str = "c1";
const OTHER_COMPANY: &str = "c2";
const ITEM: &str = "i1";
const OTHER_ITEM: &str = "i2";
const GODOWN: &str = "g1";
const OTHER_GODOWN: &str = "g2";
const INVENTORY_LEDGER: &str = "l1";
const PURCHASES_LEDGER: &str = "l2";
const COST_LEDGER: &str = "l3";
const VARIANCE_LEDGER: &str = "l4";
const OTHER_INVENTORY_LEDGER: &str = "l5";
const OTHER_PURCHASES_LEDGER: &str = "l6";

struct TempWorkspace {
    database: Database,
    #[allow(dead_code)]
    directory: PathBuf,
}

impl Drop for TempWorkspace {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.directory);
    }
}

fn temp_workspace(name: &str) -> TempWorkspace {
    let directory = std::env::temp_dir().join(format!(
        "ledgerfy-inventory-{name}-{}-{:?}",
        std::process::id(),
        std::thread::current().id()
    ));
    let _ = std::fs::remove_dir_all(&directory);
    std::fs::create_dir_all(&directory).unwrap();
    let path = directory.join("ledgerfy.sqlite3");
    let database = Database::open(&path).unwrap();
    TempWorkspace { database, directory }
}

fn company(id: &str) -> Company {
    Company {
        id: id.into(),
        name: format!("Company {id}"),
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

fn ledger(id: &str, company_id: &str, name: &str, group: &str, kind: &str) -> Ledger {
    Ledger {
        id: id.into(),
        company_id: company_id.into(),
        name: name.into(),
        group_name: group.into(),
        kind: kind.into(),
        parent_id: None,
        opening_balance: 0,
        opening_date: "2026-04-01".into(),
        party_kind: None,
        currency: "INR".into(),
        tax_number: None,
        email: None,
        phone: None,
        address: None,
        is_system: false,
        is_active: true,
        created_at: "2026-04-01T00:00:00.000Z".into(),
    }
}

fn item(id: &str, company_id: &str, name: &str) -> Item {
    Item {
        id: id.into(),
        company_id: company_id.into(),
        name: name.into(),
        stock_group_id: "sg1".into(),
        unit_id: "u1".into(),
        is_inventory: true,
        is_service: false,
        purchase_price: 10_000,
        sales_price: 12_000,
        hsn: None,
        tax_category_id: None,
        opening_quantity_milli: 0,
        opening_value: 0,
        reorder_level_milli: 0,
        is_active: true,
        created_at: "2026-04-01T00:00:00.000Z".into(),
    }
}

fn godown(id: &str, company_id: &str, name: &str) -> Godown {
    Godown {
        id: id.into(),
        company_id: company_id.into(),
        name: name.into(),
        location: None,
    }
}

fn entry(id: &str, ledger_id: &str, debit: i64, credit: i64) -> VoucherEntry {
    VoucherEntry {
        id: id.into(),
        ledger_id: ledger_id.into(),
        debit,
        credit,
        narration: None,
        cost_centre_id: None,
    }
}

fn voucher(
    id: &str,
    company_id: &str,
    number: &str,
    date: &str,
    entries: Vec<VoucherEntry>,
) -> Voucher {
    Voucher {
        id: id.into(),
        company_id: company_id.into(),
        kind: "purchase".into(),
        number: number.into(),
        date: date.into(),
        due_date: None,
        payment_term_id: None,
        party_id: None,
        narration: "Stock received by the test".into(),
        reference: String::new(),
        status: "posted".into(),
        entries,
        items: vec![],
        taxes: vec![],
        linked_voucher_id: None,
        reversed_by_voucher_id: None,
        is_locked: false,
        created_at: "2026-05-04T00:00:00.000Z".into(),
        updated_at: "2026-05-04T00:00:00.000Z".into(),
    }
}

/// A purchase voucher: the inventory asset is debited and the purchase
/// account is credited.
fn purchase_voucher(
    id: &str,
    company_id: &str,
    number: &str,
    date: &str,
    amount: i64,
    inventory_ledger: &str,
    purchases_ledger: &str,
) -> Voucher {
    voucher(
        id,
        company_id,
        number,
        date,
        vec![
            entry(&format!("{id}-e1"), inventory_ledger, amount, 0),
            entry(&format!("{id}-e2"), purchases_ledger, 0, amount),
        ],
    )
}

fn item_line(id: &str, item_id: &str, quantity_milli: i64, rate: i64, amount: i64) -> VoucherItemLine {
    VoucherItemLine {
        id: id.into(),
        item_id: item_id.into(),
        quantity_milli,
        rate,
        discount: 0,
        direct_cost: None,
        tax_category_id: None,
        amount,
        godown_id: Some(GODOWN.into()),
        to_godown_id: None,
        order_line_id: None,
        production_requirement_id: None,
        batch: None,
    }
}

fn movement_base(
    id: &str,
    voucher_id: &str,
    voucher_item_id: &str,
    movement_type: &str,
    direction: &str,
    date: &str,
) -> PlannedMovement {
    PlannedMovement {
        id: id.into(),
        company_id: COMPANY.into(),
        item_id: ITEM.into(),
        godown_id: Some(GODOWN.into()),
        voucher_id: voucher_id.into(),
        voucher_item_id: Some(voucher_item_id.into()),
        movement_type: movement_type.into(),
        date: date.into(),
        direction: direction.into(),
        quantity_milli: 0,
        rate: 0,
        value: 0,
        cost: 0,
        valuation_method: "moving-weighted-average".into(),
        resulting_quantity_milli: 0,
        resulting_carrying_value: 0,
        reverses_movement_id: None,
        created_at: "2026-05-04T00:00:00.000Z".into(),
    }
}

fn pool_state(
    company_id: &str,
    item_id: &str,
    quantity_milli: i64,
    carrying_value: i64,
    revision: i64,
) -> StockPoolState {
    StockPoolState {
        company_id: company_id.into(),
        item_id: item_id.into(),
        quantity_milli,
        carrying_value,
        revision,
        updated_at: "2026-05-04T00:00:00.000Z".into(),
    }
}

fn location_state(
    company_id: &str,
    item_id: &str,
    godown_id: &str,
    quantity_milli: i64,
    revision: i64,
) -> StockLocationState {
    StockLocationState {
        company_id: company_id.into(),
        item_id: item_id.into(),
        godown_id: godown_id.into(),
        quantity_milli,
        revision,
        updated_at: "2026-05-04T00:00:00.000Z".into(),
    }
}

fn payload(
    voucher: Voucher,
    items: Vec<VoucherItemLine>,
    movements: Vec<PlannedMovement>,
    stock_pools: Vec<StockPoolState>,
    stock_locations: Vec<StockLocationState>,
) -> PostingPayload {
    let entries = voucher.entries.clone();
    let taxes = voucher.taxes.clone();
    // Every posting attempt is its own event, so the identifier is unique.
    let attempt = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or(0);
    let audit_events = vec![AuditEvent {
        id: format!("aud-{}-{}", voucher.id, attempt),
        company_id: voucher.company_id.clone(),
        actor: "tester".into(),
        action: "voucher.posted".into(),
        record_type: "voucher".into(),
        record_id: voucher.id.clone(),
        record_label: voucher.number.clone(),
        timestamp: voucher.updated_at.clone(),
        detail: None,
    }];
    PostingPayload {
        voucher,
        entries,
        items,
        taxes,
        allocations: vec![],
        advances: vec![],
        affected_party_ids: vec![],
        movements,
        stock_pools,
        stock_locations,
        order_fulfilments: vec![],
        production_issues: vec![],
        production_completions: vec![],
        audit_events,
        actor: Some("tester".into()),
    }
}

/// A workspace with one company, its ledgers, one item and one godown.
fn workspace_with_masters(name: &str) -> TempWorkspace {
    let workspace = temp_workspace(name);
    insert_company(&workspace.database, company(COMPANY)).unwrap();
    save_ledger(
        &workspace.database,
        ledger(INVENTORY_LEDGER, COMPANY, "Inventory", "assets", "inventory"),
    )
    .unwrap();
    save_ledger(
        &workspace.database,
        ledger(PURCHASES_LEDGER, COMPANY, "Purchases", "expenses", "expense"),
    )
    .unwrap();
    save_ledger(
        &workspace.database,
        ledger(COST_LEDGER, COMPANY, "Cost of goods sold", "expenses", "expense"),
    )
    .unwrap();
    save_ledger(
        &workspace.database,
        ledger(VARIANCE_LEDGER, COMPANY, "Stock variance", "expenses", "expense"),
    )
    .unwrap();
    save_item(&workspace.database, item(ITEM, COMPANY, "Steel Bar")).unwrap();
    save_godown(&workspace.database, godown(GODOWN, COMPANY, "Main Godown")).unwrap();
    workspace
}

/// A workspace with two companies, each with its own item and godown.
fn workspace_with_two_companies(name: &str) -> TempWorkspace {
    let workspace = workspace_with_masters(name);
    insert_company(&workspace.database, company(OTHER_COMPANY)).unwrap();
    save_ledger(
        &workspace.database,
        ledger(
            OTHER_INVENTORY_LEDGER,
            OTHER_COMPANY,
            "Inventory Two",
            "assets",
            "inventory",
        ),
    )
    .unwrap();
    save_ledger(
        &workspace.database,
        ledger(
            OTHER_PURCHASES_LEDGER,
            OTHER_COMPANY,
            "Purchases Two",
            "expenses",
            "expense",
        ),
    )
    .unwrap();
    save_item(
        &workspace.database,
        item(OTHER_ITEM, OTHER_COMPANY, "Copper Wire"),
    )
    .unwrap();
    save_godown(
        &workspace.database,
        godown(OTHER_GODOWN, OTHER_COMPANY, "Second Godown"),
    )
    .unwrap();
    workspace
}

/// Post a receipt of ten units at a hundred rupees each, with the plan the
/// domain layer would produce.
fn post_receipt(
    workspace: &TempWorkspace,
    voucher_id: &str,
    date: &str,
) -> Result<Voucher, String> {
    let voucher = purchase_voucher(
        voucher_id,
        COMPANY,
        "PUR-0001",
        date,
        100_000,
        INVENTORY_LEDGER,
        PURCHASES_LEDGER,
    );
    let mut movement = movement_base(
        &format!("m-{voucher_id}"),
        voucher_id,
        &format!("{voucher_id}-i1"),
        "receipt",
        "in",
        date,
    );
    movement.quantity_milli = 10_000;
    movement.rate = 10_000;
    movement.value = 100_000;
    movement.resulting_quantity_milli = 10_000;
    movement.resulting_carrying_value = 100_000;

    post_voucher(
        &workspace.database,
        payload(
            voucher,
            vec![item_line(
                &format!("{voucher_id}-i1"),
                ITEM,
                10_000,
                10_000,
                100_000,
            )],
            vec![movement],
            vec![pool_state(COMPANY, ITEM, 10_000, 100_000, 0)],
            vec![location_state(COMPANY, ITEM, GODOWN, 10_000, 0)],
        ),
    )
}

#[test]
fn a_posting_with_movements_writes_the_voucher_the_movements_the_pools_and_the_balances() {
    let workspace = workspace_with_masters("inv_post");

    post_receipt(&workspace, "v1", "2026-05-04").unwrap();

    let vouchers = list_vouchers(&workspace.database, COMPANY, &Default::default()).unwrap();
    assert_eq!(vouchers.len(), 1);
    assert_eq!(vouchers[0].status, "posted");
    assert_eq!(vouchers[0].items.len(), 1);

    let movements = list_stock_movements(&workspace.database, COMPANY, None).unwrap();
    assert_eq!(movements.len(), 1);
    assert_eq!(movements[0].movement_type, "receipt");
    assert_eq!(movements[0].direction, "in");
    assert_eq!(movements[0].quantity_milli, 10_000);
    assert_eq!(movements[0].value, 100_000);
    assert_eq!(movements[0].cost, 0);
    assert_eq!(movements[0].valuation_method, "moving-weighted-average");
    assert_eq!(movements[0].voucher_item_id.as_deref(), Some("v1-i1"));

    let pools = list_stock_pools(&workspace.database, COMPANY).unwrap();
    assert_eq!(pools.len(), 1);
    assert_eq!(pools[0].quantity_milli, 10_000);
    assert_eq!(pools[0].carrying_value, 100_000);
    assert_eq!(pools[0].revision, 1);

    let balances = list_stock_balances(&workspace.database, COMPANY, None).unwrap();
    assert_eq!(balances.len(), 1);
    assert_eq!(balances[0].quantity_milli, 10_000);
    assert_eq!(balances[0].revision, 1);

    // The quantity column the earlier version used keeps the signed quantity
    // in units, beside the authoritative milli-unit column.
    let connection = workspace.database.lock();
    let legacy: f64 = connection
        .query_row(
            "SELECT quantity FROM stock_movements WHERE id = ?1",
            params!["m-v1"],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(legacy, 10.0);
}

#[test]
fn a_failure_part_way_through_the_write_leaves_nothing_behind() {
    let workspace = workspace_with_masters("inv_rollback");

    post_receipt(&workspace, "v1", "2026-05-04").unwrap();

    // The second posting reuses the identifier of a movement that is already
    // stored, so the write fails after the voucher has been written.
    let voucher = purchase_voucher(
        "v2",
        COMPANY,
        "PUR-0002",
        "2026-05-06",
        100_000,
        INVENTORY_LEDGER,
        PURCHASES_LEDGER,
    );
    let mut movement = movement_base("m-v1", "v2", "v2-i1", "receipt", "in", "2026-05-06");
    movement.quantity_milli = 10_000;
    movement.rate = 10_000;
    movement.value = 100_000;
    movement.resulting_quantity_milli = 20_000;
    movement.resulting_carrying_value = 200_000;

    let outcome = post_voucher(
        &workspace.database,
        payload(
            voucher,
            vec![item_line("v2-i1", ITEM, 10_000, 10_000, 100_000)],
            vec![movement],
            vec![pool_state(COMPANY, ITEM, 20_000, 200_000, 1)],
            vec![location_state(COMPANY, ITEM, GODOWN, 20_000, 1)],
        ),
    );
    assert!(outcome.is_err());

    // The voucher of the failed posting is gone.
    let vouchers = list_vouchers(&workspace.database, COMPANY, &Default::default()).unwrap();
    assert_eq!(vouchers.len(), 1);
    assert_eq!(vouchers[0].id, "v1");

    // The movement was not written a second time.
    let movements = list_stock_movements(&workspace.database, COMPANY, None).unwrap();
    assert_eq!(movements.len(), 1);
    assert_eq!(movements[0].voucher_id, "v1");

    // The balances are the ones the first posting left behind.
    let pools = list_stock_pools(&workspace.database, COMPANY).unwrap();
    assert_eq!(pools.len(), 1);
    assert_eq!(pools[0].quantity_milli, 10_000);
    assert_eq!(pools[0].carrying_value, 100_000);
    assert_eq!(pools[0].revision, 1);

    let balances = list_stock_balances(&workspace.database, COMPANY, None).unwrap();
    assert_eq!(balances.len(), 1);
    assert_eq!(balances[0].quantity_milli, 10_000);
    assert_eq!(balances[0].revision, 1);
}

#[test]
fn a_movement_that_names_another_companys_item_is_refused() {
    let workspace = workspace_with_two_companies("inv_foreign_item");

    let voucher = purchase_voucher(
        "v1",
        COMPANY,
        "PUR-0001",
        "2026-05-04",
        100_000,
        INVENTORY_LEDGER,
        PURCHASES_LEDGER,
    );
    let mut movement = movement_base("m1", "v1", "v1-i1", "receipt", "in", "2026-05-04");
    movement.item_id = OTHER_ITEM.into();
    movement.quantity_milli = 10_000;
    movement.rate = 10_000;
    movement.value = 100_000;

    let outcome = post_voucher(
        &workspace.database,
        payload(
            voucher,
            vec![item_line("v1-i1", ITEM, 10_000, 10_000, 100_000)],
            vec![movement],
            vec![pool_state(COMPANY, OTHER_ITEM, 10_000, 100_000, 0)],
            vec![location_state(COMPANY, OTHER_ITEM, GODOWN, 10_000, 0)],
        ),
    );
    assert!(outcome.is_err());
    assert!(outcome.unwrap_err().contains("does not belong to this company"));

    let vouchers = list_vouchers(&workspace.database, COMPANY, &Default::default()).unwrap();
    assert!(vouchers.is_empty());
    assert!(list_stock_movements(&workspace.database, COMPANY, None)
        .unwrap()
        .is_empty());
    assert!(list_stock_pools(&workspace.database, COMPANY).unwrap().is_empty());
}

#[test]
fn a_movement_for_a_voucher_line_that_already_has_one_is_refused() {
    let workspace = workspace_with_masters("inv_duplicate");

    post_receipt(&workspace, "v1", "2026-05-04").unwrap();

    // The same posting again: the voucher line already produced a movement of
    // this type, so the retry must not write it twice.
    let outcome = post_receipt(&workspace, "v1", "2026-05-04");
    assert!(outcome.is_err());
    assert_eq!(outcome.unwrap_err(), STOCK_DUPLICATE_MESSAGE);

    let movements = list_stock_movements(&workspace.database, COMPANY, None).unwrap();
    assert_eq!(movements.len(), 1);

    let pools = list_stock_pools(&workspace.database, COMPANY).unwrap();
    assert_eq!(pools[0].quantity_milli, 10_000);
    assert_eq!(pools[0].revision, 1);
}

#[test]
fn a_stale_revision_is_refused_and_nothing_is_written() {
    let workspace = workspace_with_masters("inv_stale");

    post_receipt(&workspace, "v1", "2026-05-04").unwrap();

    // The plan was built on the pool as it was before the first posting, so
    // it no longer matches the stored revision.
    let voucher = purchase_voucher(
        "v2",
        COMPANY,
        "PUR-0002",
        "2026-05-06",
        100_000,
        INVENTORY_LEDGER,
        PURCHASES_LEDGER,
    );
    let mut movement = movement_base("m2", "v2", "v2-i1", "receipt", "in", "2026-05-06");
    movement.quantity_milli = 10_000;
    movement.rate = 10_000;
    movement.value = 100_000;
    movement.resulting_quantity_milli = 20_000;
    movement.resulting_carrying_value = 200_000;

    let outcome = post_voucher(
        &workspace.database,
        payload(
            voucher,
            vec![item_line("v2-i1", ITEM, 10_000, 10_000, 100_000)],
            vec![movement],
            vec![pool_state(COMPANY, ITEM, 20_000, 200_000, 0)],
            vec![location_state(COMPANY, ITEM, GODOWN, 20_000, 0)],
        ),
    );
    assert!(outcome.is_err());
    assert_eq!(outcome.unwrap_err(), STOCK_CONFLICT_MESSAGE);

    let vouchers = list_vouchers(&workspace.database, COMPANY, &Default::default()).unwrap();
    assert_eq!(vouchers.len(), 1);
    assert_eq!(vouchers[0].id, "v1");

    let movements = list_stock_movements(&workspace.database, COMPANY, None).unwrap();
    assert_eq!(movements.len(), 1);

    let pools = list_stock_pools(&workspace.database, COMPANY).unwrap();
    assert_eq!(pools[0].quantity_milli, 10_000);
    assert_eq!(pools[0].revision, 1);
}

#[test]
fn a_movement_dated_before_the_last_movement_of_the_same_item_is_refused() {
    let workspace = workspace_with_masters("inv_backdated");

    post_receipt(&workspace, "v1", "2026-05-10").unwrap();

    let voucher = purchase_voucher(
        "v2",
        COMPANY,
        "PUR-0002",
        "2026-05-01",
        100_000,
        INVENTORY_LEDGER,
        PURCHASES_LEDGER,
    );
    let mut movement = movement_base("m2", "v2", "v2-i1", "receipt", "in", "2026-05-01");
    movement.quantity_milli = 10_000;
    movement.rate = 10_000;
    movement.value = 100_000;
    movement.resulting_quantity_milli = 20_000;
    movement.resulting_carrying_value = 200_000;

    let outcome = post_voucher(
        &workspace.database,
        payload(
            voucher,
            vec![item_line("v2-i1", ITEM, 10_000, 10_000, 100_000)],
            vec![movement],
            vec![pool_state(COMPANY, ITEM, 20_000, 200_000, 1)],
            vec![location_state(COMPANY, ITEM, GODOWN, 20_000, 1)],
        ),
    );
    assert!(outcome.is_err());
    assert!(outcome
        .unwrap_err()
        .contains("Recalculating historical inventory is not supported"));

    let vouchers = list_vouchers(&workspace.database, COMPANY, &Default::default()).unwrap();
    assert_eq!(vouchers.len(), 1);

    let movements = list_stock_movements(&workspace.database, COMPANY, None).unwrap();
    assert_eq!(movements.len(), 1);
}

#[test]
fn the_pools_and_the_balances_survive_closing_and_reopening_the_database() {
    let workspace = workspace_with_masters("inv_reopen");

    post_receipt(&workspace, "v1", "2026-05-04").unwrap();

    workspace.database.close_connection().unwrap();
    workspace.database.reopen().unwrap();

    let pools = list_stock_pools(&workspace.database, COMPANY).unwrap();
    assert_eq!(pools.len(), 1);
    assert_eq!(pools[0].quantity_milli, 10_000);
    assert_eq!(pools[0].carrying_value, 100_000);
    assert_eq!(pools[0].revision, 1);

    let balances = list_stock_balances(&workspace.database, COMPANY, None).unwrap();
    assert_eq!(balances.len(), 1);
    assert_eq!(balances[0].quantity_milli, 10_000);
    assert_eq!(balances[0].revision, 1);

    let movements = list_stock_movements(&workspace.database, COMPANY, None).unwrap();
    assert_eq!(movements.len(), 1);
}

#[test]
fn the_rebuild_reproduces_the_stored_balances_from_the_movement_ledger() {
    let workspace = workspace_with_masters("inv_rebuild");

    post_receipt(&workspace, "v1", "2026-05-04").unwrap();

    // Four units are issued at the average cost of a hundred rupees each.
    let voucher = voucher(
        "v2",
        COMPANY,
        "ISS-0001",
        "2026-05-06",
        vec![
            entry("v2-e1", COST_LEDGER, 40_000, 0),
            entry("v2-e2", INVENTORY_LEDGER, 0, 40_000),
        ],
    );
    let mut movement = movement_base("m2", "v2", "v2-i1", "issue", "out", "2026-05-06");
    movement.quantity_milli = 4_000;
    movement.rate = 10_000;
    movement.value = 40_000;
    movement.cost = 40_000;
    movement.resulting_quantity_milli = 6_000;
    movement.resulting_carrying_value = 60_000;

    post_voucher(
        &workspace.database,
        payload(
            voucher,
            vec![item_line("v2-i1", ITEM, 4_000, 10_000, 40_000)],
            vec![movement],
            vec![pool_state(COMPANY, ITEM, 6_000, 60_000, 1)],
            vec![location_state(COMPANY, ITEM, GODOWN, 6_000, 1)],
        ),
    )
    .unwrap();

    let rebuild = rebuild_stock_balances(&workspace.database, COMPANY).unwrap();
    assert_eq!(rebuild.movements.len(), 2);
    assert_eq!(rebuild.pools.len(), 1);
    assert_eq!(rebuild.pools[0].item_id, ITEM);
    assert_eq!(rebuild.pools[0].quantity_milli, 6_000);
    assert_eq!(rebuild.pools[0].carrying_value, 60_000);
    assert_eq!(rebuild.locations.len(), 1);
    assert_eq!(rebuild.locations[0].godown_id, GODOWN);
    assert_eq!(rebuild.locations[0].quantity_milli, 6_000);

    // The rebuilt balances agree with the stored projection.
    let pools = list_stock_pools(&workspace.database, COMPANY).unwrap();
    assert_eq!(pools[0].quantity_milli, rebuild.pools[0].quantity_milli);
    assert_eq!(pools[0].carrying_value, rebuild.pools[0].carrying_value);
    let balances = list_stock_balances(&workspace.database, COMPANY, None).unwrap();
    assert_eq!(
        balances[0].quantity_milli,
        rebuild.locations[0].quantity_milli
    );

    // The rebuild changed nothing that is stored.
    let pools_after = list_stock_pools(&workspace.database, COMPANY).unwrap();
    assert_eq!(pools_after[0].revision, 2);
    assert_eq!(pools_after[0].quantity_milli, 6_000);
}

#[test]
fn the_stock_of_one_company_never_appears_for_another() {
    let workspace = workspace_with_two_companies("inv_isolation");

    post_receipt(&workspace, "v1", "2026-05-04").unwrap();

    // The second company posts its own receipt of its own item.
    let voucher = purchase_voucher(
        "w1",
        OTHER_COMPANY,
        "PUR-0001",
        "2026-05-05",
        50_000,
        OTHER_INVENTORY_LEDGER,
        OTHER_PURCHASES_LEDGER,
    );
    let mut movement = movement_base("mw1", "w1", "w1-i2", "receipt", "in", "2026-05-05");
    movement.company_id = OTHER_COMPANY.into();
    movement.item_id = OTHER_ITEM.into();
    movement.godown_id = Some(OTHER_GODOWN.into());
    movement.quantity_milli = 5_000;
    movement.rate = 10_000;
    movement.value = 50_000;
    movement.resulting_quantity_milli = 5_000;
    movement.resulting_carrying_value = 50_000;

    let mut line = item_line("w1-i2", OTHER_ITEM, 5_000, 10_000, 50_000);
    line.godown_id = Some(OTHER_GODOWN.into());
    post_voucher(
        &workspace.database,
        payload(
            voucher,
            vec![line],
            vec![movement],
            vec![pool_state(OTHER_COMPANY, OTHER_ITEM, 5_000, 50_000, 0)],
            vec![location_state(OTHER_COMPANY, OTHER_ITEM, OTHER_GODOWN, 5_000, 0)],
        ),
    )
    .unwrap();

    // Each company sees only its own movements, pools and balances.
    let first_movements = list_stock_movements(&workspace.database, COMPANY, None).unwrap();
    assert_eq!(first_movements.len(), 1);
    assert_eq!(first_movements[0].company_id, COMPANY);
    assert_eq!(first_movements[0].item_id, ITEM);

    let second_movements = list_stock_movements(&workspace.database, OTHER_COMPANY, None).unwrap();
    assert_eq!(second_movements.len(), 1);
    assert_eq!(second_movements[0].company_id, OTHER_COMPANY);
    assert_eq!(second_movements[0].item_id, OTHER_ITEM);

    let first_pools = list_stock_pools(&workspace.database, COMPANY).unwrap();
    assert_eq!(first_pools.len(), 1);
    assert_eq!(first_pools[0].item_id, ITEM);

    let second_pools = list_stock_pools(&workspace.database, OTHER_COMPANY).unwrap();
    assert_eq!(second_pools.len(), 1);
    assert_eq!(second_pools[0].item_id, OTHER_ITEM);

    let first_balances = list_stock_balances(&workspace.database, COMPANY, None).unwrap();
    assert_eq!(first_balances.len(), 1);
    assert_eq!(first_balances[0].godown_id, GODOWN);

    let second_balances = list_stock_balances(&workspace.database, OTHER_COMPANY, None).unwrap();
    assert_eq!(second_balances.len(), 1);
    assert_eq!(second_balances[0].godown_id, OTHER_GODOWN);

    // A movement of one company is not reachable through the other one.
    let filtered = list_stock_movements(&workspace.database, COMPANY, Some(OTHER_ITEM)).unwrap();
    assert!(filtered.is_empty());
}

#[test]
fn the_inventory_accounts_are_saved_and_read_back_for_the_company() {
    let workspace = workspace_with_masters("inv_accounts");

    assert!(get_inventory_accounts(&workspace.database, COMPANY)
        .unwrap()
        .is_none());

    let accounts = InventoryAccounts {
        id: "inv-accounts-1".into(),
        company_id: COMPANY.into(),
        inventory_ledger_id: INVENTORY_LEDGER.into(),
        cogs_ledger_id: COST_LEDGER.into(),
        variance_ledger_id: VARIANCE_LEDGER.into(),
        purchases_ledger_id: PURCHASES_LEDGER.into(),
        production_ledger_id: None,
        valuation_method: "moving-weighted-average".into(),
        input_tax_recoverable: true,
        activated_at: Some("2026-04-01".into()),
        created_at: "2026-04-01T00:00:00.000Z".into(),
    };

    // The accounts must name ledgers of the company.
    let refused = save_inventory_accounts(
        &workspace.database,
        InventoryAccounts {
            cogs_ledger_id: "l-missing".into(),
            ..accounts.clone()
        },
    );
    assert!(refused.is_err());

    let saved = save_inventory_accounts(&workspace.database, accounts).unwrap();
    assert_eq!(saved.id, "inv-accounts-1");

    let stored = get_inventory_accounts(&workspace.database, COMPANY)
        .unwrap()
        .unwrap();
    assert_eq!(stored.inventory_ledger_id, INVENTORY_LEDGER);
    assert_eq!(stored.valuation_method, "moving-weighted-average");
    assert!(stored.input_tax_recoverable);

    // Saving again keeps one record for the company.
    let again = save_inventory_accounts(
        &workspace.database,
        InventoryAccounts {
            id: "another-id".into(),
            valuation_method: "moving-weighted-average".into(),
            ..stored.clone()
        },
    )
    .unwrap();
    assert_eq!(again.id, "inv-accounts-1");

    assert!(get_inventory_accounts(&workspace.database, OTHER_COMPANY)
        .unwrap()
        .is_none());
}

#[test]
fn a_seeded_movement_without_a_sequence_is_still_readable() {
    // The sample books are seeded without a posting sequence: the database
    // assigns one when the movement is written. A movement that arrives
    // without one must still be readable, or the sample workspace cannot be
    // opened at all.
    let json = r#"{
        "id": "mov-1",
        "companyId": "c1",
        "voucherId": "v1",
        "voucherItemId": null,
        "voucherNumber": "PUR-0001",
        "date": "2026-05-04",
        "itemId": "i1",
        "godownId": "g1",
        "movementType": "receipt",
        "direction": "in",
        "quantityMilli": 10000,
        "rate": 10000,
        "value": 100000,
        "cost": 0,
        "valuationMethod": "moving-weighted-average",
        "resultingQuantityMilli": 10000,
        "resultingCarryingValue": 100000,
        "reversesMovementId": null,
        "createdAt": "2026-05-04T00:00:00.000Z"
    }"#;

    let movement: StockMovementRecord =
        serde_json::from_str(json).expect("the movement is readable without a sequence");
    assert_eq!(movement.sequence_no, 0);
    assert_eq!(movement.quantity_milli, 10_000);
    assert_eq!(movement.value, 100_000);
}

#[test]
fn an_activation_opens_the_stock_books_and_records_the_decision() {
    let workspace = workspace_with_masters("inv_activation");
    save_godown(&workspace.database, godown("g2", COMPANY, "Second Godown")).unwrap();

    let request = OpeningStockRequest {
        company_id: COMPANY.into(),
        cutover_date: "2026-05-01".into(),
        accounts: InventoryAccounts {
            id: "inv-accounts-1".into(),
            company_id: COMPANY.into(),
            inventory_ledger_id: INVENTORY_LEDGER.into(),
            cogs_ledger_id: COST_LEDGER.into(),
            variance_ledger_id: VARIANCE_LEDGER.into(),
            purchases_ledger_id: PURCHASES_LEDGER.into(),
            production_ledger_id: None,
            valuation_method: "moving-weighted-average".into(),
            input_tax_recoverable: true,
            activated_at: None,
            created_at: "2026-05-01T00:00:00.000Z".into(),
        },
        lines: vec![
            OpeningStockLine {
                item_id: ITEM.into(),
                godown_id: GODOWN.into(),
                quantity_milli: 10_000,
                carrying_value: 100_000,
            },
            OpeningStockLine {
                item_id: ITEM.into(),
                godown_id: OTHER_GODOWN.into(),
                quantity_milli: 5_000,
                carrying_value: 60_000,
            },
        ],
        stock_item_ids: vec![ITEM.into()],
        reason: "Stock tracking starts with the new financial year".into(),
        actor: "tester".into(),
    };

    let result = create_opening_stock(&workspace.database, request).unwrap();

    // The accounts are in force, and the cutover date is recorded.
    let accounts = get_inventory_accounts(&workspace.database, COMPANY).unwrap().unwrap();
    assert_eq!(accounts.activated_at.as_deref(), Some("2026-05-01"));
    assert_eq!(accounts.valuation_method, "moving-weighted-average");

    // One movement per opening line, and the movements carry the costing.
    assert_eq!(result.movements.len(), 2);
    for movement in &result.movements {
        assert_eq!(movement.movement_type, "opening");
        assert_eq!(movement.direction, "in");
        assert_eq!(movement.valuation_method, "moving-weighted-average");
    }

    // The pool holds both lines of the item, and each location its own.
    let pools = list_stock_pools(&workspace.database, COMPANY).unwrap();
    assert_eq!(pools.len(), 1);
    assert_eq!(pools[0].quantity_milli, 15_000);
    assert_eq!(pools[0].carrying_value, 160_000);

    let balances = list_stock_balances(&workspace.database, COMPANY, None).unwrap();
    assert_eq!(balances.len(), 2);
    let total: i64 = balances.iter().map(|balance| balance.quantity_milli).sum();
    assert_eq!(total, 15_000);

    // The decision is in the audit trail.
    let events = list_audit_events(&workspace.database, COMPANY, &Default::default()).unwrap();
    assert!(
        events.iter().any(|event| event.action == "inventory.activated"),
        "the activation is recorded in the audit trail"
    );

    // The stock books are opened once. A second activation is refused.
    let again = create_opening_stock(
        &workspace.database,
        OpeningStockRequest {
            company_id: COMPANY.into(),
            cutover_date: "2026-05-01".into(),
            accounts: InventoryAccounts {
                id: "inv-accounts-1".into(),
                company_id: COMPANY.into(),
                inventory_ledger_id: INVENTORY_LEDGER.into(),
                cogs_ledger_id: COST_LEDGER.into(),
                variance_ledger_id: VARIANCE_LEDGER.into(),
                purchases_ledger_id: PURCHASES_LEDGER.into(),
                production_ledger_id: None,
                valuation_method: "moving-weighted-average".into(),
                input_tax_recoverable: true,
                activated_at: None,
                created_at: "2026-05-01T00:00:00.000Z".into(),
            },
            lines: vec![OpeningStockLine {
                item_id: ITEM.into(),
                godown_id: GODOWN.into(),
                quantity_milli: 1_000,
                carrying_value: 10_000,
            }],
            stock_item_ids: vec![ITEM.into()],
            reason: String::new(),
            actor: "tester".into(),
        },
    );
    assert!(again.is_err(), "a second activation is refused");
}

#[test]
fn a_cancellation_writes_a_compensating_movement_and_gives_the_stock_back() {
    let workspace = workspace_with_masters("inv_cancel");

    post_receipt(&workspace, "v1", "2026-05-04").unwrap();

    let pools = list_stock_pools(&workspace.database, COMPANY).unwrap();
    assert_eq!(pools[0].quantity_milli, 10_000);
    assert_eq!(pools[0].carrying_value, 100_000);

    // The domain answers the receipt with a movement that takes the same
    // quantity and value back out, linked to the movement it reverses.
    let mut voucher = purchase_voucher(
        "v1",
        COMPANY,
        "PUR-0001",
        "2026-05-04",
        100_000,
        INVENTORY_LEDGER,
        PURCHASES_LEDGER,
    );
    voucher.status = "cancelled".into();

    let mut reversal = movement_base(
        "m-v1-reversal",
        "v1",
        "v1-i1",
        "reversal-out",
        "out",
        "2026-05-04",
    );
    reversal.quantity_milli = 10_000;
    reversal.rate = 10_000;
    reversal.value = 100_000;
    reversal.cost = 100_000;
    reversal.resulting_quantity_milli = 0;
    reversal.resulting_carrying_value = 0;
    reversal.reverses_movement_id = Some("m-v1".into());

    let cancelled = cancel_voucher(
        &workspace.database,
        payload(
            voucher,
            vec![item_line("v1-i1", ITEM, 10_000, 10_000, 100_000)],
            vec![reversal],
            vec![pool_state(COMPANY, ITEM, 0, 0, 1)],
            vec![location_state(COMPANY, ITEM, GODOWN, 0, 1)],
        ),
    )
    .unwrap();
    assert_eq!(cancelled.status, "cancelled");

    // The original movement is kept, and the reversal is written beside it.
    let movements = list_stock_movements(&workspace.database, COMPANY, None).unwrap();
    assert_eq!(movements.len(), 2);
    let reversal = movements
        .iter()
        .find(|movement| movement.movement_type == "reversal-out")
        .expect("the compensating movement is in the ledger");
    assert_eq!(reversal.direction, "out");
    assert_eq!(reversal.quantity_milli, 10_000);
    assert_eq!(reversal.value, 100_000);
    assert_eq!(
        reversal.reverses_movement_id.as_deref(),
        Some("m-v1"),
        "the reversal names the movement it reverses"
    );
    let original = movements
        .iter()
        .find(|movement| movement.movement_type == "receipt")
        .expect("the original movement is kept");
    assert!(
        reversal.sequence_no > original.sequence_no,
        "the reversal is posted after the movement it reverses"
    );

    // The stock and its value are back where they were before the purchase.
    let pools = list_stock_pools(&workspace.database, COMPANY).unwrap();
    assert_eq!(pools[0].quantity_milli, 0);
    assert_eq!(pools[0].carrying_value, 0);

    let balances = list_stock_balances(&workspace.database, COMPANY, None).unwrap();
    assert_eq!(balances[0].quantity_milli, 0);

    // Replaying the ledger reproduces the same answer.
    let rebuilt = rebuild_stock_balances(&workspace.database, COMPANY).unwrap();
    assert_eq!(rebuilt.pools[0].quantity_milli, 0);
    assert_eq!(rebuilt.pools[0].carrying_value, 0);
}
