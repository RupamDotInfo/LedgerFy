//! Integration tests for orders and their fulfilment.
//!
//! These drive the same functions the Tauri commands call, against a real
//! SQLite database in a temporary directory.

use std::path::PathBuf;

use ledgerfy_lib::commands::{
    next_order_number,
    amend_order, cancel_order, confirm_order, get_order, insert_company, list_orders, list_vouchers,
    post_voucher, save_godown, save_item, save_ledger, save_order, ORDER_FULFILMENT_DUPLICATE_MESSAGE,
};
use ledgerfy_lib::db::Database;
use ledgerfy_lib::entities::*;

const COMPANY: &str = "c1";
const OTHER_COMPANY: &str = "c2";
const ITEM: &str = "i1";
const OTHER_ITEM: &str = "i2";
const GODOWN: &str = "g1";
const CUSTOMER: &str = "l1";
const SALES: &str = "l2";

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
        "ledgerfy-orders-{name}-{}-{:?}",
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

fn order(id: &str, company_id: &str, number: &str, status: &str) -> Order {
    Order {
        id: id.into(),
        company_id: company_id.into(),
        kind: "sales".into(),
        number: number.into(),
        date: "2026-05-04".into(),
        expected_date: Some("2026-06-04".into()),
        party_id: CUSTOMER.into(),
        narration: "Ordered by the test".into(),
        reference: String::new(),
        status: status.into(),
        payment_term_id: None,
        revision: 0,
        created_at: "2026-05-04T00:00:00.000Z".into(),
        updated_at: "2026-05-04T00:00:00.000Z".into(),
    }
}

fn order_line(
    id: &str,
    company_id: &str,
    order_id: &str,
    item_id: &str,
    quantity_milli: i64,
    rate: i64,
    amount: i64,
) -> OrderLine {
    OrderLine {
        id: id.into(),
        company_id: company_id.into(),
        order_id: order_id.into(),
        item_id: item_id.into(),
        quantity_milli,
        rate,
        discount: 0,
        tax_category_id: None,
        amount,
    }
}

fn fulfilment(
    id: &str,
    company_id: &str,
    order_id: &str,
    order_line_id: &str,
    voucher_id: &str,
    voucher_item_id: &str,
    quantity_milli: i64,
    amount: i64,
) -> OrderFulfilment {
    OrderFulfilment {
        id: id.into(),
        company_id: company_id.into(),
        order_id: order_id.into(),
        order_line_id: order_line_id.into(),
        voucher_id: voucher_id.into(),
        voucher_item_id: voucher_item_id.into(),
        quantity_milli,
        amount,
        created_at: "2026-05-04T00:00:00.000Z".into(),
    }
}

/// A sales invoice that delivers against one order line.
fn invoice(
    id: &str,
    company_id: &str,
    number: &str,
    order_id: &str,
    order_line_id: &str,
    quantity_milli: i64,
    amount: i64,
) -> Voucher {
    Voucher {
        id: id.into(),
        company_id: company_id.into(),
        kind: "sales".into(),
        number: number.into(),
        date: "2026-05-04".into(),
        due_date: None,
        payment_term_id: None,
        party_id: Some(CUSTOMER.into()),
        narration: "Invoice raised against the order".into(),
        reference: String::new(),
        status: "posted".into(),
        entries: vec![
            entry(&format!("{id}-e1"), CUSTOMER, amount, 0),
            entry(&format!("{id}-e2"), SALES, 0, amount),
        ],
        items: vec![VoucherItemLine {
            id: format!("{id}-i1"),
            item_id: ITEM.into(),
            quantity_milli,
            rate: 10_000,
            discount: 0,
            direct_cost: None,
            tax_category_id: None,
            amount,
            godown_id: Some(GODOWN.into()),
            to_godown_id: None,
            order_line_id: Some(order_line_id.into()),
            production_requirement_id: None,
            batch: None,
        }],
        taxes: vec![],
        linked_voucher_id: Some(order_id.into()),
        reversed_by_voucher_id: None,
        is_locked: false,
        created_at: "2026-05-04T00:00:00.000Z".into(),
        updated_at: "2026-05-04T00:00:00.000Z".into(),
    }
}

fn payload(voucher: Voucher, fulfilments: Vec<OrderFulfilment>) -> PostingPayload {
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
        order_fulfilments: fulfilments,
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
        ledger(CUSTOMER, COMPANY, "Customer One", "assets", "receivable"),
    )
    .unwrap();
    save_ledger(
        &workspace.database,
        ledger(SALES, COMPANY, "Sales", "income", "sales"),
    )
    .unwrap();
    save_item(&workspace.database, item(ITEM, COMPANY, "Steel Bar")).unwrap();
    save_godown(&workspace.database, godown(GODOWN, COMPANY, "Main Godown")).unwrap();
    workspace
}

/// A workspace with two companies, each with its own item.
fn workspace_with_two_companies(name: &str) -> TempWorkspace {
    let workspace = workspace_with_masters(name);
    insert_company(&workspace.database, company(OTHER_COMPANY)).unwrap();
    save_ledger(
        &workspace.database,
        ledger("l3", OTHER_COMPANY, "Customer Two", "assets", "receivable"),
    )
    .unwrap();
    save_ledger(
        &workspace.database,
        ledger("l4", OTHER_COMPANY, "Sales Two", "income", "sales"),
    )
    .unwrap();
    save_item(
        &workspace.database,
        item(OTHER_ITEM, OTHER_COMPANY, "Copper Wire"),
    )
    .unwrap();
    workspace
}

/// An order with one line of ten units at a hundred rupees.
fn saved_order(workspace: &TempWorkspace, id: &str, number: &str) -> Order {
    save_order(
        &workspace.database,
        order(id, COMPANY, number, "draft"),
        vec![order_line(
            &format!("{id}-l1"),
            COMPANY,
            id,
            ITEM,
            10_000,
            10_000,
            100_000,
        )],
    )
    .unwrap()
    .order
}

#[test]
fn an_order_is_saved_read_back_and_listed() {
    let workspace = workspace_with_masters("ord_save");

    saved_order(&workspace, "o1", "SO-0001");

    let stored = get_order(&workspace.database, COMPANY, "o1").unwrap();
    assert_eq!(stored.order.id, "o1");
    assert_eq!(stored.order.number, "SO-0001");
    assert_eq!(stored.order.status, "draft");
    assert_eq!(stored.order.kind, "sales");
    assert_eq!(stored.lines.len(), 1);
    assert_eq!(stored.lines[0].quantity_milli, 10_000);
    assert_eq!(stored.lines[0].amount, 100_000);
    assert_eq!(stored.fulfilments.len(), 0);

    let listed = list_orders(&workspace.database, COMPANY, None).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].order.id, "o1");
    assert_eq!(listed[0].lines.len(), 1);

    // The list can be narrowed to one kind of order.
    assert_eq!(
        list_orders(&workspace.database, COMPANY, Some("sales"))
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        list_orders(&workspace.database, COMPANY, Some("purchase"))
            .unwrap()
            .len(),
        0
    );
    assert_eq!(
        list_orders(&workspace.database, COMPANY, Some("all"))
            .unwrap()
            .len(),
        1
    );

    // The orders of another company are not the orders of this one.
    assert!(list_orders(&workspace.database, OTHER_COMPANY, None)
        .unwrap()
        .is_empty());
    assert!(get_order(&workspace.database, OTHER_COMPANY, "o1").is_err());
}

#[test]
fn an_order_is_confirmed_amended_and_cancelled_and_the_history_holds_the_previous_lines() {
    let workspace = workspace_with_masters("ord_amend");
    saved_order(&workspace, "o1", "SO-0001");

    let confirmed = confirm_order(&workspace.database, COMPANY, "o1", "tester").unwrap();
    assert_eq!(confirmed.order.status, "confirmed");
    assert_eq!(confirmed.order.revision, 1);

    // The amendment replaces the line and keeps the previous one in the
    // history.
    let amended = amend_order(
        &workspace.database,
        COMPANY,
        "o1",
        vec![order_line(
            "o1-l1",
            COMPANY,
            "o1",
            ITEM,
            12_000,
            10_000,
            120_000,
        )],
        "The customer asked for more",
        "tester",
    )
    .unwrap();

    assert_eq!(amended.order.revision, 2);
    assert_eq!(amended.lines.len(), 1);
    assert_eq!(amended.lines[0].quantity_milli, 12_000);
    assert_eq!(amended.revisions.len(), 1);
    assert_eq!(amended.revisions[0].reason, "The customer asked for more");
    assert_eq!(amended.revisions[0].actor, "tester");
    assert_eq!(amended.revision_lines.len(), 1);
    // The history holds the line as it stood, not the amended one.
    assert_eq!(amended.revision_lines[0].order_line_id, "o1-l1");
    assert_eq!(amended.revision_lines[0].quantity_milli, 10_000);
    assert_eq!(amended.revision_lines[0].amount, 100_000);

    let cancelled = cancel_order(
        &workspace.database,
        COMPANY,
        "o1",
        "The customer withdrew the order",
        "tester",
    )
    .unwrap();
    assert_eq!(cancelled.order.status, "cancelled");
    assert_eq!(cancelled.order.revision, 3);
    // The cancellation is kept in the history, with its reason.
    assert_eq!(cancelled.revisions.len(), 2);
    assert_eq!(
        cancelled.revisions[1].reason,
        "The customer withdrew the order"
    );

    // A cancelled order cannot be confirmed again.
    let refused = confirm_order(&workspace.database, COMPANY, "o1", "tester");
    assert!(refused.is_err());
}

#[test]
fn an_amendment_without_a_reason_is_refused() {
    let workspace = workspace_with_masters("ord_reason");
    saved_order(&workspace, "o1", "SO-0001");
    confirm_order(&workspace.database, COMPANY, "o1", "tester").unwrap();

    let refused = amend_order(
        &workspace.database,
        COMPANY,
        "o1",
        vec![order_line(
            "o1-l1",
            COMPANY,
            "o1",
            ITEM,
            12_000,
            10_000,
            120_000,
        )],
        "   ",
        "tester",
    );
    assert!(refused.is_err());

    // Nothing was changed.
    let stored = get_order(&workspace.database, COMPANY, "o1").unwrap();
    assert_eq!(stored.order.revision, 1);
    assert_eq!(stored.lines[0].quantity_milli, 10_000);
    assert!(stored.revisions.is_empty());
}

#[test]
fn a_line_cannot_be_reduced_below_what_has_been_delivered() {
    let workspace = workspace_with_masters("ord_reduce");
    saved_order(&workspace, "o1", "SO-0001");
    confirm_order(&workspace.database, COMPANY, "o1", "tester").unwrap();

    // The invoice delivers four of the ten units.
    let invoice = invoice("v1", COMPANY, "INV-0001", "o1", "o1-l1", 4_000, 40_000);
    post_voucher(
        &workspace.database,
        payload(
            invoice,
            vec![fulfilment(
                "f1",
                COMPANY,
                "o1",
                "o1-l1",
                "v1",
                "v1-i1",
                4_000,
                40_000,
            )],
        ),
    )
    .unwrap();

    let refused = amend_order(
        &workspace.database,
        COMPANY,
        "o1",
        vec![order_line(
            "o1-l1",
            COMPANY,
            "o1",
            ITEM,
            3_000,
            10_000,
            30_000,
        )],
        "The customer reduced the order",
        "tester",
    );
    assert!(refused.is_err());

    // The order is unchanged.
    let stored = get_order(&workspace.database, COMPANY, "o1").unwrap();
    assert_eq!(stored.lines[0].quantity_milli, 10_000);
    assert_eq!(stored.order.revision, 1);
}

#[test]
fn an_order_with_a_fulfilment_cannot_be_cancelled() {
    let workspace = workspace_with_masters("ord_fulfil");
    saved_order(&workspace, "o1", "SO-0001");
    confirm_order(&workspace.database, COMPANY, "o1", "tester").unwrap();

    let invoice = invoice("v1", COMPANY, "INV-0001", "o1", "o1-l1", 4_000, 40_000);
    post_voucher(
        &workspace.database,
        payload(
            invoice,
            vec![fulfilment(
                "f1",
                COMPANY,
                "o1",
                "o1-l1",
                "v1",
                "v1-i1",
                4_000,
                40_000,
            )],
        ),
    )
    .unwrap();

    let refused = cancel_order(&workspace.database, COMPANY, "o1", "Changed his mind", "tester");
    let message = refused.unwrap_err();
    assert!(message.contains("invoice"), "the message names the invoice: {message}");
    assert!(message.contains("credit"), "the message says what to do: {message}");

    // The order is still confirmed.
    let stored = get_order(&workspace.database, COMPANY, "o1").unwrap();
    assert_eq!(stored.order.status, "confirmed");
}

#[test]
fn a_fulfilment_written_twice_for_the_same_voucher_line_is_refused_and_nothing_is_written() {
    let workspace = workspace_with_masters("ord_twice");
    saved_order(&workspace, "o1", "SO-0001");
    confirm_order(&workspace.database, COMPANY, "o1", "tester").unwrap();

    let invoice = invoice("v1", COMPANY, "INV-0001", "o1", "o1-l1", 4_000, 40_000);
    let fulfilment_row = fulfilment(
        "f1",
        COMPANY,
        "o1",
        "o1-l1",
        "v1",
        "v1-i1",
        4_000,
        40_000,
    );
    post_voucher(
        &workspace.database,
        payload(invoice.clone(), vec![fulfilment_row.clone()]),
    )
    .unwrap();

    // The same voucher line cannot fulfil the order line twice.
    let refused = post_voucher(
        &workspace.database,
        payload(
            invoice,
            vec![fulfilment(
                "f2",
                COMPANY,
                "o1",
                "o1-l1",
                "v1",
                "v1-i1",
                4_000,
                40_000,
            )],
        ),
    );
    let message = refused.unwrap_err();
    assert_eq!(message, ORDER_FULFILMENT_DUPLICATE_MESSAGE);

    // The first fulfilment is the only one, and the voucher is unchanged.
    let stored = get_order(&workspace.database, COMPANY, "o1").unwrap();
    assert_eq!(stored.fulfilments.len(), 1);
    assert_eq!(stored.fulfilments[0].id, "f1");
}

#[test]
fn a_fulfilment_for_another_companys_order_line_is_refused() {
    let workspace = workspace_with_two_companies("ord_other");
    saved_order(&workspace, "o1", "SO-0001");

    // The same order line identifier, in another company.
    save_order(
        &workspace.database,
        Order {
            id: "o2".into(),
            company_id: OTHER_COMPANY.into(),
            kind: "sales".into(),
            number: "SO-0002".into(),
            date: "2026-05-04".into(),
            expected_date: None,
            party_id: "l3".into(),
            narration: String::new(),
            reference: String::new(),
            status: "confirmed".into(),
            payment_term_id: None,
            revision: 1,
            created_at: "2026-05-04T00:00:00.000Z".into(),
            updated_at: "2026-05-04T00:00:00.000Z".into(),
        },
        vec![order_line(
            "o2-l1",
            OTHER_COMPANY,
            "o2",
            OTHER_ITEM,
            10_000,
            10_000,
            100_000,
        )],
    )
    .unwrap();

    let invoice = invoice("v1", COMPANY, "INV-0001", "o1", "o1-l1", 4_000, 40_000);
    let refused = post_voucher(
        &workspace.database,
        payload(
            invoice,
            vec![fulfilment(
                "f1",
                COMPANY,
                "o1",
                "o2-l1",
                "v1",
                "v1-i1",
                4_000,
                40_000,
            )],
        ),
    );
    let message = refused.unwrap_err();
    assert!(
        message.contains("does not belong to this company"),
        "the message names the company: {message}"
    );

    // Nothing was written: no voucher, and no fulfilment anywhere.
    let vouchers = list_vouchers(&workspace.database, COMPANY, &Default::default()).unwrap();
    assert!(vouchers.is_empty());
    assert!(get_order(&workspace.database, COMPANY, "o1")
        .unwrap()
        .fulfilments
        .is_empty());
    assert!(get_order(&workspace.database, OTHER_COMPANY, "o2")
        .unwrap()
        .fulfilments
        .is_empty());
}

#[test]
fn an_order_of_another_company_cannot_be_changed_here() {
    let workspace = workspace_with_two_companies("ord_isolation");
    saved_order(&workspace, "o1", "SO-0001");

    // The same identifier, in another company.
    let refused = save_order(
        &workspace.database,
        order("o1", OTHER_COMPANY, "SO-0002", "draft"),
        vec![order_line(
            "o1-l1",
            OTHER_COMPANY,
            "o1",
            OTHER_ITEM,
            1_000,
            10_000,
            10_000,
        )],
    );
    assert!(refused.is_err());

    // The order of the first company is untouched.
    let stored = get_order(&workspace.database, COMPANY, "o1").unwrap();
    assert_eq!(stored.order.company_id, COMPANY);
    assert_eq!(stored.order.number, "SO-0001");
}

#[test]
fn a_failure_part_way_through_leaves_nothing_behind() {
    let workspace = workspace_with_masters("ord_rollback");
    saved_order(&workspace, "o1", "SO-0001");
    confirm_order(&workspace.database, COMPANY, "o1", "tester").unwrap();

    // The second fulfilment repeats the first one, so the transaction fails
    // after it has already written part of the work.
    let invoice = invoice("v1", COMPANY, "INV-0001", "o1", "o1-l1", 4_000, 40_000);
    let refused = post_voucher(
        &workspace.database,
        payload(
            invoice,
            vec![
                fulfilment("f1", COMPANY, "o1", "o1-l1", "v1", "v1-i1", 4_000, 40_000),
                fulfilment("f2", COMPANY, "o1", "o1-l1", "v1", "v1-i1", 4_000, 40_000),
            ],
        ),
    );
    assert!(refused.is_err());

    // Nothing was written: no voucher, no fulfilment, no audit event.
    let vouchers = list_vouchers(&workspace.database, COMPANY, &Default::default()).unwrap();
    assert!(vouchers.is_empty());
    let stored = get_order(&workspace.database, COMPANY, "o1").unwrap();
    assert!(stored.fulfilments.is_empty());
}

#[test]
fn everything_survives_closing_and_reopening_the_database() {
    let workspace = workspace_with_masters("ord_reopen");
    saved_order(&workspace, "o1", "SO-0001");
    confirm_order(&workspace.database, COMPANY, "o1", "tester").unwrap();
    amend_order(
        &workspace.database,
        COMPANY,
        "o1",
        vec![order_line(
            "o1-l1",
            COMPANY,
            "o1",
            ITEM,
            12_000,
            10_000,
            120_000,
        )],
        "The customer asked for more",
        "tester",
    )
    .unwrap();

    workspace.database.close_connection().unwrap();
    workspace.database.reopen().unwrap();

    let stored = get_order(&workspace.database, COMPANY, "o1").unwrap();
    assert_eq!(stored.order.status, "confirmed");
    assert_eq!(stored.order.revision, 2);
    assert_eq!(stored.lines[0].quantity_milli, 12_000);
    assert_eq!(stored.revisions.len(), 1);
    assert_eq!(stored.revision_lines.len(), 1);
    assert_eq!(stored.revision_lines[0].quantity_milli, 10_000);
}

#[test]
fn an_order_is_numbered_from_the_company_scheme_and_only_one_series_counts() {
    let workspace = workspace_with_masters("ord_number");

    saved_order(&workspace, "o1", "SO-0001");
    saved_order(&workspace, "o2", "SO-0002");

    let next = next_order_number(&workspace.database, COMPANY, "sales", None, None).unwrap();
    assert_eq!(next, "SO-0003");

    // A number in another series does not restart the count.
    let mut purchase_order = order("o3", COMPANY, "PO-0001", "draft");
    purchase_order.kind = "purchase".into();
    save_order(&workspace.database, purchase_order, vec![]).unwrap();
    let next = next_order_number(&workspace.database, COMPANY, "sales", None, None).unwrap();
    assert_eq!(next, "SO-0003");

    // The purchase series is counted on its own.
    let next = next_order_number(&workspace.database, COMPANY, "purchase", None, None).unwrap();
    assert_eq!(next, "PO-0002");
}
