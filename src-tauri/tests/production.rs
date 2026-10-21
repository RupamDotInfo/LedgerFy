//! Integration tests for bills of materials and production.
//!
//! These drive the same functions the Tauri commands call, against a real
//! SQLite database in a temporary directory.

use std::path::PathBuf;

use ledgerfy_lib::commands::{
    get_production_order, insert_company, list_boms, list_production_orders, post_voucher,
    release_bom, release_production_order, save_bom, save_godown, save_inventory_accounts,
    save_item, save_ledger, save_production_order, PRODUCTION_ISSUE_DUPLICATE_MESSAGE,
};
use ledgerfy_lib::db::Database;
use ledgerfy_lib::entities::*;

const COMPANY: &str = "c1";
const OTHER_COMPANY: &str = "c2";
const COMPONENT: &str = "i1";
const FINISHED: &str = "i2";
const GODOWN: &str = "g1";
const INVENTORY_LEDGER: &str = "l1";
const COST_LEDGER: &str = "l2";
const VARIANCE_LEDGER: &str = "l3";
const PURCHASES_LEDGER: &str = "l4";
const PRODUCTION_LEDGER: &str = "l5";

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
        "ledgerfy-production-{name}-{}-{:?}",
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

fn bom(id: &str, company_id: &str, item_id: &str, version: i64, output_milli: i64) -> Bom {
    Bom {
        id: id.into(),
        company_id: company_id.into(),
        item_id: item_id.into(),
        version,
        output_quantity_milli: output_milli,
        status: "draft".into(),
        effective_from: Some("2026-05-04".into()),
        narration: "The structure of the test".into(),
        created_at: "2026-05-04T00:00:00.000Z".into(),
        updated_at: "2026-05-04T00:00:00.000Z".into(),
    }
}

fn bom_line(
    id: &str,
    company_id: &str,
    bom_id: &str,
    item_id: &str,
    quantity_milli: i64,
    conversion_milli: i64,
) -> BomLine {
    BomLine {
        id: id.into(),
        company_id: company_id.into(),
        bom_id: bom_id.into(),
        item_id: item_id.into(),
        quantity_milli,
        conversion_milli,
        created_at: "2026-05-04T00:00:00.000Z".into(),
    }
}

fn production_order(
    id: &str,
    company_id: &str,
    number: &str,
    item_id: &str,
    bom_id: &str,
    bom_version: i64,
    planned_milli: i64,
) -> ProductionOrder {
    ProductionOrder {
        id: id.into(),
        company_id: company_id.into(),
        number: number.into(),
        item_id: item_id.into(),
        bom_id: bom_id.into(),
        bom_version,
        planned_quantity_milli: planned_milli,
        status: "draft".into(),
        godown_id: GODOWN.into(),
        planned_at: "2026-05-04".into(),
        narration: "Made by the test".into(),
        revision: 0,
        created_at: "2026-05-04T00:00:00.000Z".into(),
        updated_at: "2026-05-04T00:00:00.000Z".into(),
    }
}

fn production_issue(
    id: &str,
    company_id: &str,
    production_order_id: &str,
    requirement_id: &str,
    item_id: &str,
    quantity_milli: i64,
    voucher_id: &str,
    voucher_item_id: &str,
) -> ProductionIssue {
    ProductionIssue {
        id: id.into(),
        company_id: company_id.into(),
        production_order_id: production_order_id.into(),
        requirement_id: requirement_id.into(),
        item_id: item_id.into(),
        godown_id: GODOWN.into(),
        quantity_milli,
        rate: 10_000,
        cost: 100_000,
        voucher_id: voucher_id.into(),
        voucher_item_id: voucher_item_id.into(),
        created_at: "2026-05-04T00:00:00.000Z".into(),
    }
}

fn production_completion(
    id: &str,
    company_id: &str,
    production_order_id: &str,
    item_id: &str,
    quantity_milli: i64,
    voucher_id: &str,
    voucher_item_id: &str,
) -> ProductionCompletion {
    ProductionCompletion {
        id: id.into(),
        company_id: company_id.into(),
        production_order_id: production_order_id.into(),
        item_id: item_id.into(),
        godown_id: GODOWN.into(),
        quantity_milli,
        rate: 10_000,
        cost: 100_000,
        voucher_id: voucher_id.into(),
        voucher_item_id: voucher_item_id.into(),
        created_at: "2026-05-04T00:00:00.000Z".into(),
    }
}

/// A stock journal that issues components against a production order.
fn issue_voucher(
    id: &str,
    company_id: &str,
    number: &str,
    item_id: &str,
    quantity_milli: i64,
    requirement_id: &str,
) -> Voucher {
    Voucher {
        id: id.into(),
        company_id: company_id.into(),
        kind: "stock-journal".into(),
        number: number.into(),
        date: "2026-05-04".into(),
        due_date: None,
        payment_term_id: None,
        party_id: None,
        narration: "Materials issued to production".into(),
        reference: String::new(),
        status: "posted".into(),
        entries: vec![
            entry(&format!("{id}-e1"), PRODUCTION_LEDGER, 100_000, 0),
            entry(&format!("{id}-e2"), INVENTORY_LEDGER, 0, 100_000),
        ],
        items: vec![VoucherItemLine {
            id: format!("{id}-i1"),
            item_id: item_id.into(),
            quantity_milli,
            rate: 10_000,
            discount: 0,
            direct_cost: None,
            tax_category_id: None,
            amount: 100_000,
            godown_id: Some(GODOWN.into()),
            to_godown_id: None,
            order_line_id: None,
            production_requirement_id: Some(requirement_id.into()),
            batch: None,
        }],
        taxes: vec![],
        linked_voucher_id: None,
        reversed_by_voucher_id: None,
        is_locked: false,
        created_at: "2026-05-04T00:00:00.000Z".into(),
        updated_at: "2026-05-04T00:00:00.000Z".into(),
    }
}

/// A stock journal that receives the finished goods into stock.
fn completion_voucher(
    id: &str,
    company_id: &str,
    number: &str,
    item_id: &str,
    quantity_milli: i64,
) -> Voucher {
    Voucher {
        id: id.into(),
        company_id: company_id.into(),
        kind: "stock-journal".into(),
        number: number.into(),
        date: "2026-05-04".into(),
        due_date: None,
        payment_term_id: None,
        party_id: None,
        narration: "Finished goods received".into(),
        reference: String::new(),
        status: "posted".into(),
        entries: vec![
            entry(&format!("{id}-e1"), INVENTORY_LEDGER, 100_000, 0),
            entry(&format!("{id}-e2"), PRODUCTION_LEDGER, 0, 100_000),
        ],
        items: vec![VoucherItemLine {
            id: format!("{id}-i1"),
            item_id: item_id.into(),
            quantity_milli,
            rate: 10_000,
            discount: 0,
            direct_cost: None,
            tax_category_id: None,
            amount: 100_000,
            godown_id: Some(GODOWN.into()),
            to_godown_id: None,
            order_line_id: None,
            production_requirement_id: None,
            batch: None,
        }],
        taxes: vec![],
        linked_voucher_id: None,
        reversed_by_voucher_id: None,
        is_locked: false,
        created_at: "2026-05-04T00:00:00.000Z".into(),
        updated_at: "2026-05-04T00:00:00.000Z".into(),
    }
}

fn payload(
    voucher: Voucher,
    issues: Vec<ProductionIssue>,
    completions: Vec<ProductionCompletion>,
) -> PostingPayload {
    let entries = voucher.entries.clone();
    let items = voucher.items.clone();
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
        movements: vec![],
        stock_pools: vec![],
        stock_locations: vec![],
        order_fulfilments: vec![],
        production_issues: issues,
        production_completions: completions,
        audit_events,
        actor: Some("tester".into()),
    }
}

/// A workspace with one company, its ledgers, its items and its godown.
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
        ledger(COST_LEDGER, COMPANY, "Cost of goods sold", "expenses", "expense"),
    )
    .unwrap();
    save_ledger(
        &workspace.database,
        ledger(VARIANCE_LEDGER, COMPANY, "Stock variance", "expenses", "expense"),
    )
    .unwrap();
    save_ledger(
        &workspace.database,
        ledger(PURCHASES_LEDGER, COMPANY, "Purchases", "expenses", "expense"),
    )
    .unwrap();
    save_ledger(
        &workspace.database,
        ledger(
            PRODUCTION_LEDGER,
            COMPANY,
            "Work in progress",
            "assets",
            "inventory",
        ),
    )
    .unwrap();
    save_item(&workspace.database, item(COMPONENT, COMPANY, "Bolt")).unwrap();
    save_item(&workspace.database, item(FINISHED, COMPANY, "Bracket")).unwrap();
    save_godown(&workspace.database, godown(GODOWN, COMPANY, "Main Godown")).unwrap();
    workspace
}

/// A workspace with inventory in force, which production needs.
fn workspace_with_inventory(name: &str) -> TempWorkspace {
    let workspace = workspace_with_masters(name);
    save_inventory_accounts(
        &workspace.database,
        InventoryAccounts {
            id: "inv-accounts-1".into(),
            company_id: COMPANY.into(),
            inventory_ledger_id: INVENTORY_LEDGER.into(),
            cogs_ledger_id: COST_LEDGER.into(),
            variance_ledger_id: VARIANCE_LEDGER.into(),
            purchases_ledger_id: PURCHASES_LEDGER.into(),
            production_ledger_id: Some(PRODUCTION_LEDGER.into()),
            valuation_method: "moving-weighted-average".into(),
            input_tax_recoverable: true,
            activated_at: Some("2026-04-01".into()),
            created_at: "2026-04-01T00:00:00.000Z".into(),
        },
    )
    .unwrap();
    workspace
}

/// A released structure of one bolt per bracket, and a released production
/// order of ten brackets.
fn released_production_order(workspace: &TempWorkspace) -> (String, String) {
    save_bom(
        &workspace.database,
        bom("b1", COMPANY, FINISHED, 1, 1_000),
        vec![bom_line("b1-l1", COMPANY, "b1", COMPONENT, 2_000, 1_000)],
    )
    .unwrap();
    release_bom(&workspace.database, COMPANY, "b1", "tester").unwrap();

    save_production_order(
        &workspace.database,
        production_order("p1", COMPANY, "PRD-0001", FINISHED, "b1", 1, 10_000),
        vec![],
    )
    .unwrap();
    release_production_order(&workspace.database, COMPANY, "p1", "tester").unwrap();

    ("b1".to_string(), "p1".to_string())
}

#[test]
fn a_structure_can_be_saved_and_released_and_releasing_supersedes_the_previous_version() {
    let workspace = workspace_with_masters("prd_bom");

    let saved = save_bom(
        &workspace.database,
        bom("b1", COMPANY, FINISHED, 1, 1_000),
        vec![bom_line("b1-l1", COMPANY, "b1", COMPONENT, 2_000, 1_000)],
    )
    .unwrap();
    assert_eq!(saved.bom.status, "draft");
    assert_eq!(saved.lines.len(), 1);
    assert_eq!(saved.lines[0].quantity_milli, 2_000);

    let released = release_bom(&workspace.database, COMPANY, "b1", "tester").unwrap();
    assert_eq!(released.bom.status, "released");

    // The second version of the same structure supersedes the first.
    save_bom(
        &workspace.database,
        bom("b2", COMPANY, FINISHED, 2, 1_000),
        vec![bom_line("b2-l1", COMPANY, "b2", COMPONENT, 3_000, 1_000)],
    )
    .unwrap();
    release_bom(&workspace.database, COMPANY, "b2", "tester").unwrap();

    let structures = list_boms(&workspace.database, COMPANY, None).unwrap();
    assert_eq!(structures.len(), 2);
    let first = structures
        .iter()
        .find(|detail| detail.bom.id == "b1")
        .unwrap();
    let second = structures
        .iter()
        .find(|detail| detail.bom.id == "b2")
        .unwrap();
    assert_eq!(first.bom.status, "superseded");
    assert_eq!(second.bom.status, "released");

    // The structures of another company are not the structures of this one.
    assert!(list_boms(&workspace.database, OTHER_COMPANY, None)
        .unwrap()
        .is_empty());

    // The list can be narrowed to one item.
    assert_eq!(
        list_boms(&workspace.database, COMPANY, Some(FINISHED))
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        list_boms(&workspace.database, COMPANY, Some(COMPONENT))
            .unwrap()
            .len(),
        0
    );
    assert_eq!(
        list_boms(&workspace.database, COMPANY, Some("all"))
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn a_structure_with_no_components_cannot_be_released() {
    let workspace = workspace_with_masters("prd_empty_bom");
    save_bom(
        &workspace.database,
        bom("b1", COMPANY, FINISHED, 1, 1_000),
        vec![],
    )
    .unwrap();

    let refused = release_bom(&workspace.database, COMPANY, "b1", "tester");
    assert!(refused.is_err());
}

#[test]
fn a_production_order_can_be_released_and_its_requirements_are_the_exact_snapshot_of_the_structure() {
    let workspace = workspace_with_inventory("prd_release");

    save_bom(
        &workspace.database,
        bom("b1", COMPANY, FINISHED, 1, 1_000),
        vec![bom_line("b1-l1", COMPANY, "b1", COMPONENT, 2_000, 1_000)],
    )
    .unwrap();
    release_bom(&workspace.database, COMPANY, "b1", "tester").unwrap();

    save_production_order(
        &workspace.database,
        production_order("p1", COMPANY, "PRD-0001", FINISHED, "b1", 1, 10_000),
        vec![],
    )
    .unwrap();

    let released = release_production_order(&workspace.database, COMPANY, "p1", "tester").unwrap();
    assert_eq!(released.order.status, "released");
    assert_eq!(released.requirements.len(), 1);

    let requirement = &released.requirements[0];
    assert_eq!(requirement.item_id, COMPONENT);
    // The requirement is the structure's line.
    assert_eq!(requirement.requirement_quantity_milli, 2_000);
    assert_eq!(requirement.conversion_milli, 1_000);
    // Two bolts for every bracket, and ten brackets.
    assert_eq!(requirement.required_quantity_milli, 20_000);
    assert_eq!(requirement.issued_quantity_milli, 0);

    // The order is listed with its state.
    let listed = list_production_orders(&workspace.database, COMPANY).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, "p1");
    assert_eq!(listed[0].status, "released");
}

#[test]
fn a_released_structure_snapshots_the_exact_quantity_each_component_is_needed_for() {
    let workspace = workspace_with_inventory("prd_formula");

    // The requirement per unit of output, the conversion, the planned output,
    // the output the structure makes, and the quantity that follows.
    let cases: [(i64, i64, i64, i64, i64); 4] = [
        (2_000, 1_000, 10_000, 1_000, 20_000),
        (2_000, 500, 10_000, 1_000, 10_000),
        (20_000, 1_000, 10_000, 10_000, 20_000),
        (1, 1_000, 500, 1_000, 1),
    ];

    for (index, (requirement, conversion, planned, output, expected)) in
        cases.iter().enumerate()
    {
        let component = format!("formula-component-{index}");
        let finished = format!("formula-finished-{index}");
        let structure = format!("formula-structure-{index}");
        let order = format!("formula-order-{index}");

        save_item(
            &workspace.database,
            item(&component, COMPANY, &format!("Component {index}")),
        )
        .unwrap();
        save_item(
            &workspace.database,
            item(&finished, COMPANY, &format!("Finished {index}")),
        )
        .unwrap();

        save_bom(
            &workspace.database,
            bom(&structure, COMPANY, &finished, 1, *output),
            vec![bom_line(
                &format!("{structure}-l1"),
                COMPANY,
                &structure,
                &component,
                *requirement,
                *conversion,
            )],
        )
        .unwrap();
        release_bom(&workspace.database, COMPANY, &structure, "tester").unwrap();

        save_production_order(
            &workspace.database,
            production_order(
                &order,
                COMPANY,
                &format!("PRD-{index:04}"),
                &finished,
                &structure,
                1,
                *planned,
            ),
            vec![],
        )
        .unwrap();
        let released = release_production_order(&workspace.database, COMPANY, &order, "tester")
            .unwrap();

        assert_eq!(released.requirements.len(), 1);
        assert_eq!(
            released.requirements[0].required_quantity_milli, *expected,
            "requirement {requirement}, conversion {conversion}, planned {planned}, output {output}"
        );
    }
}

#[test]
fn a_production_order_cannot_be_released_against_a_structure_that_is_not_released() {
    let workspace = workspace_with_inventory("prd_not_released");

    save_bom(
        &workspace.database,
        bom("b1", COMPANY, FINISHED, 1, 1_000),
        vec![bom_line("b1-l1", COMPANY, "b1", COMPONENT, 2_000, 1_000)],
    )
    .unwrap();
    save_production_order(
        &workspace.database,
        production_order("p1", COMPANY, "PRD-0001", FINISHED, "b1", 1, 10_000),
        vec![],
    )
    .unwrap();

    let refused = release_production_order(&workspace.database, COMPANY, "p1", "tester");
    assert!(refused.is_err());
}

#[test]
fn a_production_order_cannot_be_released_without_inventory() {
    let workspace = workspace_with_masters("prd_no_inventory");

    save_bom(
        &workspace.database,
        bom("b1", COMPANY, FINISHED, 1, 1_000),
        vec![bom_line("b1-l1", COMPANY, "b1", COMPONENT, 2_000, 1_000)],
    )
    .unwrap();
    release_bom(&workspace.database, COMPANY, "b1", "tester").unwrap();
    save_production_order(
        &workspace.database,
        production_order("p1", COMPANY, "PRD-0001", FINISHED, "b1", 1, 10_000),
        vec![],
    )
    .unwrap();

    let refused = release_production_order(&workspace.database, COMPANY, "p1", "tester");
    assert!(refused.is_err());
    assert!(
        get_production_order(&workspace.database, COMPANY, "p1")
            .unwrap()
            .requirements
            .is_empty()
    );
}

#[test]
fn a_production_issue_writes_the_issue_row_increases_the_issued_quantity_and_is_refused_when_repeated() {
    let workspace = workspace_with_inventory("prd_issue");
    released_production_order(&workspace);

    let requirement_id = get_production_order(&workspace.database, COMPANY, "p1")
        .unwrap()
        .requirements[0]
        .id
        .clone();

    let voucher = issue_voucher(
        "v1",
        COMPANY,
        "STJ-0001",
        COMPONENT,
        20_000,
        &requirement_id,
    );
    post_voucher(
        &workspace.database,
        payload(
            voucher.clone(),
            vec![production_issue(
                "iss1",
                COMPANY,
                "p1",
                &requirement_id,
                COMPONENT,
                20_000,
                "v1",
                "v1-i1",
            )],
            vec![],
        ),
    )
    .unwrap();

    let stored = get_production_order(&workspace.database, COMPANY, "p1").unwrap();
    assert_eq!(stored.issues.len(), 1);
    assert_eq!(stored.issues[0].id, "iss1");
    assert_eq!(stored.issues[0].quantity_milli, 20_000);
    assert_eq!(stored.issues[0].voucher_item_id, "v1-i1");
    // The requirement records how much has been issued against it.
    assert_eq!(stored.requirements[0].issued_quantity_milli, 20_000);

    // The same voucher line cannot be issued twice.
    let refused = post_voucher(
        &workspace.database,
        payload(
            voucher,
            vec![production_issue(
                "iss2",
                COMPANY,
                "p1",
                &requirement_id,
                COMPONENT,
                20_000,
                "v1",
                "v1-i1",
            )],
            vec![],
        ),
    );
    assert_eq!(refused.unwrap_err(), PRODUCTION_ISSUE_DUPLICATE_MESSAGE);

    // Nothing was written the second time.
    let stored = get_production_order(&workspace.database, COMPANY, "p1").unwrap();
    assert_eq!(stored.issues.len(), 1);
    assert_eq!(stored.requirements[0].issued_quantity_milli, 20_000);
}

#[test]
fn a_production_completion_marks_the_order_completed() {
    let workspace = workspace_with_inventory("prd_completion");
    released_production_order(&workspace);

    let voucher = completion_voucher("v1", COMPANY, "STJ-0001", FINISHED, 10_000);
    post_voucher(
        &workspace.database,
        payload(
            voucher,
            vec![],
            vec![production_completion(
                "cmp1",
                COMPANY,
                "p1",
                FINISHED,
                10_000,
                "v1",
                "v1-i1",
            )],
        ),
    )
    .unwrap();

    let stored = get_production_order(&workspace.database, COMPANY, "p1").unwrap();
    assert_eq!(stored.completions.len(), 1);
    assert_eq!(stored.completions[0].id, "cmp1");
    assert_eq!(stored.completions[0].quantity_milli, 10_000);
    // The production order is complete.
    assert_eq!(stored.order.status, "completed");
}

#[test]
fn a_failure_part_way_through_leaves_nothing_behind() {
    let workspace = workspace_with_inventory("prd_rollback");
    released_production_order(&workspace);

    let requirement_id = get_production_order(&workspace.database, COMPANY, "p1")
        .unwrap()
        .requirements[0]
        .id
        .clone();

    // The second issue repeats the first one, so the transaction fails after
    // it has already written part of the work.
    let voucher = issue_voucher(
        "v1",
        COMPANY,
        "STJ-0001",
        COMPONENT,
        20_000,
        &requirement_id,
    );
    let refused = post_voucher(
        &workspace.database,
        payload(
            voucher,
            vec![
                production_issue(
                    "iss1",
                    COMPANY,
                    "p1",
                    &requirement_id,
                    COMPONENT,
                    20_000,
                    "v1",
                    "v1-i1",
                ),
                production_issue(
                    "iss2",
                    COMPANY,
                    "p1",
                    &requirement_id,
                    COMPONENT,
                    20_000,
                    "v1",
                    "v1-i1",
                ),
            ],
            vec![],
        ),
    );
    assert!(refused.is_err());

    // Nothing was written: no issue, and the requirement is untouched.
    let stored = get_production_order(&workspace.database, COMPANY, "p1").unwrap();
    assert!(stored.issues.is_empty());
    assert_eq!(stored.requirements[0].issued_quantity_milli, 0);
}

#[test]
fn everything_survives_closing_and_reopening_the_database() {
    let workspace = workspace_with_inventory("prd_reopen");
    released_production_order(&workspace);

    let requirement_id = get_production_order(&workspace.database, COMPANY, "p1")
        .unwrap()
        .requirements[0]
        .id
        .clone();
    let voucher = issue_voucher(
        "v1",
        COMPANY,
        "STJ-0001",
        COMPONENT,
        20_000,
        &requirement_id,
    );
    post_voucher(
        &workspace.database,
        payload(
            voucher,
            vec![production_issue(
                "iss1",
                COMPANY,
                "p1",
                &requirement_id,
                COMPONENT,
                20_000,
                "v1",
                "v1-i1",
            )],
            vec![],
        ),
    )
    .unwrap();

    workspace.database.close_connection().unwrap();
    workspace.database.reopen().unwrap();

    let stored = get_production_order(&workspace.database, COMPANY, "p1").unwrap();
    assert_eq!(stored.order.status, "released");
    assert_eq!(stored.requirements.len(), 1);
    assert_eq!(stored.requirements[0].required_quantity_milli, 20_000);
    assert_eq!(stored.requirements[0].issued_quantity_milli, 20_000);
    assert_eq!(stored.issues.len(), 1);

    let structures = list_boms(&workspace.database, COMPANY, None).unwrap();
    assert_eq!(structures.len(), 1);
    assert_eq!(structures[0].bom.status, "released");
    assert_eq!(structures[0].lines.len(), 1);
}
