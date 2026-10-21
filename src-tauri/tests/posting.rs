//! Integration tests for the posting path.
//!
//! These drive the same functions the Tauri commands call, against a real
//! SQLite database in a temporary directory.

use std::path::PathBuf;

use ledgerfy_lib::commands::{
    cancel_voucher, get_voucher_numbering, insert_company, list_allocations, list_advances,
    list_vouchers, next_voucher_number, post_voucher, save_ledger, save_voucher_numbering,
};
use ledgerfy_lib::db::Database;
use ledgerfy_lib::entities::*;

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
        "ledgerfy-post-{name}-{}-{:?}",
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
    kind: &str,
    date: &str,
    party_id: Option<&str>,
    entries: Vec<VoucherEntry>,
) -> Voucher {
    Voucher {
        id: id.into(),
        company_id: company_id.into(),
        kind: kind.into(),
        number: number.into(),
        date: date.into(),
        due_date: Some("2026-06-03".into()),
        payment_term_id: None,
        party_id: party_id.map(|value| value.to_string()),
        narration: "Posted by the test".into(),
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

fn payload(
    voucher: Voucher,
    allocations: Vec<AllocationRecord>,
    advances: Vec<AdvanceRecord>,
    affected_party_ids: Vec<String>,
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
        allocations,
        advances,
        affected_party_ids,
        // The stock effect of the voucher. The posting tests cover the
        // financial path; the stock plan has its own tests.
        movements: vec![],
        stock_pools: vec![],
        stock_locations: vec![],
        order_fulfilments: vec![],
        production_issues: vec![],
        production_completions: vec![],
        audit_events,
        actor: Some("tester".into()),
    }
}

fn allocation(id: &str, company_id: &str, payment: &str, invoice: &str, party: &str, amount: i64) -> AllocationRecord {
    AllocationRecord {
        id: id.into(),
        company_id: company_id.into(),
        side: "receivable".into(),
        payment_voucher_id: payment.into(),
        payment_entry_id: format!("{payment}-e1"),
        invoice_voucher_id: invoice.into(),
        invoice_entry_id: format!("{invoice}-e1"),
        party_id: party.into(),
        amount,
        created_at: "2026-05-10T00:00:00.000Z".into(),
    }
}

fn workspace_with_ledgers(name: &str) -> TempWorkspace {
    let workspace = temp_workspace(name);
    insert_company(&workspace.database, company("c1")).unwrap();
    save_ledger(
        &workspace.database,
        ledger("l1", "c1", "Customer One", "assets", "receivable"),
    )
    .unwrap();
    save_ledger(
        &workspace.database,
        ledger("l2", "c1", "Sales", "income", "sales"),
    )
    .unwrap();
    save_ledger(
        &workspace.database,
        ledger("l3", "c1", "Cash", "assets", "cash"),
    )
    .unwrap();
    workspace
}

#[test]
fn posting_a_sales_invoice_persists_the_voucher_and_its_entries() {
    let workspace = workspace_with_ledgers("post_sale");

    let sale = voucher(
        "v1",
        "c1",
        "INV-0001",
        "sales",
        "2026-05-04",
        Some("l1"),
        vec![entry("v1-e1", "l1", 118_000, 0), entry("v1-e2", "l2", 0, 118_000)],
    );

    post_voucher(
        &workspace.database,
        payload(sale, vec![], vec![], vec!["l1".into()]),
    )
    .unwrap();

    let vouchers = list_vouchers(&workspace.database, "c1", &Default::default()).unwrap();
    assert_eq!(vouchers.len(), 1);
    assert_eq!(vouchers[0].entries.len(), 2);
    assert_eq!(vouchers[0].status, "posted");
    assert_eq!(vouchers[0].due_date.as_deref(), Some("2026-06-03"));
}

#[test]
fn posting_a_receipt_records_which_invoice_it_settled() {
    let workspace = workspace_with_ledgers("post_receipt");

    let sale = voucher(
        "v1",
        "c1",
        "INV-0001",
        "sales",
        "2026-05-04",
        Some("l1"),
        vec![entry("v1-e1", "l1", 100_000, 0), entry("v1-e2", "l2", 0, 100_000)],
    );
    post_voucher(
        &workspace.database,
        payload(sale, vec![], vec![], vec!["l1".into()]),
    )
    .unwrap();

    let receipt = voucher(
        "v2",
        "c1",
        "RCP-0001",
        "receipt",
        "2026-05-10",
        Some("l1"),
        vec![entry("v2-e1", "l3", 60_000, 0), entry("v2-e2", "l1", 0, 60_000)],
    );
    let allocation = allocation("alloc-1", "c1", "v2", "v1", "l1", 60_000);
    post_voucher(
        &workspace.database,
        payload(receipt, vec![allocation], vec![], vec!["l1".into()]),
    )
    .unwrap();

    let allocations = list_allocations(&workspace.database, "c1").unwrap();
    assert_eq!(allocations.len(), 1);
    assert_eq!(allocations[0].payment_voucher_id, "v2");
    assert_eq!(allocations[0].invoice_voucher_id, "v1");
    assert_eq!(allocations[0].amount, 60_000);
    assert_eq!(allocations[0].party_id, "l1");
}

#[test]
fn an_unbalanced_voucher_is_refused_and_nothing_is_written() {
    let workspace = workspace_with_ledgers("post_unbalanced");

    let sale = voucher(
        "v1",
        "c1",
        "INV-0001",
        "sales",
        "2026-05-04",
        Some("l1"),
        vec![entry("v1-e1", "l1", 100_000, 0), entry("v1-e2", "l2", 0, 90_000)],
    );

    let outcome = post_voucher(
        &workspace.database,
        payload(sale, vec![], vec![], vec!["l1".into()]),
    );
    assert!(outcome.is_err());
    assert!(outcome.unwrap_err().contains("must balance"));

    let vouchers = list_vouchers(&workspace.database, "c1", &Default::default()).unwrap();
    assert!(vouchers.is_empty());
}

#[test]
fn a_posting_that_cannot_write_its_allocations_rolls_back_completely() {
    let workspace = workspace_with_ledgers("post_rollback");

    // The allocation points at an invoice that does not exist, so the
    // foreign key refuses it and the whole posting must be undone.
    let sale = voucher(
        "v1",
        "c1",
        "INV-0001",
        "sales",
        "2026-05-04",
        Some("l1"),
        vec![entry("v1-e1", "l1", 100_000, 0), entry("v1-e2", "l2", 0, 100_000)],
    );
    let bad = allocation("alloc-1", "c1", "v1", "missing-invoice", "l1", 50_000);

    let outcome = post_voucher(
        &workspace.database,
        payload(sale, vec![bad], vec![], vec!["l1".into()]),
    );
    assert!(outcome.is_err());

    let vouchers = list_vouchers(&workspace.database, "c1", &Default::default()).unwrap();
    assert!(
        vouchers.is_empty(),
        "the voucher must not survive a failed posting: {:?}",
        vouchers.iter().map(|v| &v.number).collect::<Vec<_>>()
    );
    assert!(list_allocations(&workspace.database, "c1").unwrap().is_empty());
}

#[test]
fn re_posting_the_same_voucher_does_not_duplicate_its_allocation() {
    let workspace = workspace_with_ledgers("post_idempotent");

    let sale = voucher(
        "v1",
        "c1",
        "INV-0001",
        "sales",
        "2026-05-04",
        Some("l1"),
        vec![entry("v1-e1", "l1", 100_000, 0), entry("v1-e2", "l2", 0, 100_000)],
    );
    post_voucher(
        &workspace.database,
        payload(sale, vec![], vec![], vec!["l1".into()]),
    )
    .unwrap();

    let receipt = voucher(
        "v2",
        "c1",
        "RCP-0001",
        "receipt",
        "2026-05-10",
        Some("l1"),
        vec![entry("v2-e1", "l3", 60_000, 0), entry("v2-e2", "l1", 0, 60_000)],
    );
    let allocation = allocation("alloc-1", "c1", "v2", "v1", "l1", 60_000);

    for _ in 0..3 {
        post_voucher(
            &workspace.database,
            payload(receipt.clone(), vec![allocation.clone()], vec![], vec!["l1".into()]),
        )
        .unwrap();
    }

    let allocations = list_allocations(&workspace.database, "c1").unwrap();
    assert_eq!(
        allocations.len(),
        1,
        "re-posting must not duplicate the allocation: {:?}",
        allocations.iter().map(|a| &a.id).collect::<Vec<_>>()
    );
    let vouchers = list_vouchers(&workspace.database, "c1", &Default::default()).unwrap();
    assert_eq!(vouchers.len(), 2);
}

#[test]
fn an_unallocated_payment_is_stored_as_an_advance() {
    let workspace = workspace_with_ledgers("post_advance");

    let receipt = voucher(
        "v1",
        "c1",
        "RCP-0001",
        "receipt",
        "2026-05-10",
        Some("l1"),
        vec![entry("v1-e1", "l3", 25_000, 0), entry("v1-e2", "l1", 0, 25_000)],
    );
    let advance = AdvanceRecord {
        id: "adv-1".into(),
        company_id: "c1".into(),
        side: "receivable".into(),
        voucher_id: "v1".into(),
        entry_id: "v1-e2".into(),
        party_id: "l1".into(),
        amount: 25_000,
        date: "2026-05-10".into(),
    };

    post_voucher(
        &workspace.database,
        payload(receipt, vec![], vec![advance], vec!["l1".into()]),
    )
    .unwrap();

    let advances = list_advances(&workspace.database, "c1").unwrap();
    assert_eq!(advances.len(), 1);
    assert_eq!(advances[0].amount, 25_000);
    assert_eq!(advances[0].party_id, "l1");
}

#[test]
fn the_saved_numbering_scheme_numbers_the_vouchers() {
    let workspace = workspace_with_ledgers("numbering");

    let numbering = VoucherNumbering {
        id: "numbering-c1".into(),
        company_id: "c1".into(),
        sales_prefix: "SI".into(),
        purchase_prefix: "BILL".into(),
        payment_prefix: "PAY".into(),
        receipt_prefix: "RCP".into(),
        contra_prefix: "CNT".into(),
        journal_prefix: "JNL".into(),
        credit_note_prefix: "CN".into(),
        debit_note_prefix: "DN".into(),
        sales_order_prefix: "SO".into(),
        purchase_order_prefix: "PO".into(),
        padding: 5,
        updated_at: "2026-05-01T00:00:00.000Z".into(),
    };
    save_voucher_numbering(&workspace.database, numbering.clone()).unwrap();

    let stored = get_voucher_numbering(&workspace.database, "c1").unwrap();
    assert_eq!(stored.sales_prefix, "SI");
    assert_eq!(stored.padding, 5);

    let first = next_voucher_number(&workspace.database, "c1", "sales", None, None).unwrap();
    assert_eq!(first, "SI-00001");

    // A voucher already issued in this series moves the count on.
    let sale = voucher(
        "v1",
        "c1",
        "SI-00001",
        "sales",
        "2026-05-04",
        Some("l1"),
        vec![entry("v1-e1", "l1", 100_000, 0), entry("v1-e2", "l2", 0, 100_000)],
    );
    post_voucher(
        &workspace.database,
        payload(sale, vec![], vec![], vec!["l1".into()]),
    )
    .unwrap();

    let second = next_voucher_number(&workspace.database, "c1", "sales", None, None).unwrap();
    assert_eq!(second, "SI-00002");
}

#[test]
fn cancelling_a_receipt_releases_the_allocation_it_held() {
    let workspace = workspace_with_ledgers("post_cancel");

    let sale = voucher(
        "v1",
        "c1",
        "INV-0001",
        "sales",
        "2026-05-04",
        Some("l1"),
        vec![entry("v1-e1", "l1", 100_000, 0), entry("v1-e2", "l2", 0, 100_000)],
    );
    post_voucher(
        &workspace.database,
        payload(sale, vec![], vec![], vec!["l1".into()]),
    )
    .unwrap();

    let receipt = voucher(
        "v2",
        "c1",
        "RCP-0001",
        "receipt",
        "2026-05-10",
        Some("l1"),
        vec![entry("v2-e1", "l3", 60_000, 0), entry("v2-e2", "l1", 0, 60_000)],
    );
    let allocation = allocation("alloc-1", "c1", "v2", "v1", "l1", 60_000);
    post_voucher(
        &workspace.database,
        payload(receipt.clone(), vec![allocation], vec![], vec!["l1".into()]),
    )
    .unwrap();
    assert_eq!(list_allocations(&workspace.database, "c1").unwrap().len(), 1);

    // Cancelling the receipt must release the allocation it held.
    let mut cancelled = receipt.clone();
    cancelled.status = "cancelled".into();
    cancel_voucher(
        &workspace.database,
        payload(cancelled, vec![], vec![], vec!["l1".into()]),
    )
    .unwrap();

    assert!(
        list_allocations(&workspace.database, "c1").unwrap().is_empty(),
        "the cancelled receipt must not hold an allocation"
    );
    let vouchers = list_vouchers(&workspace.database, "c1", &Default::default()).unwrap();
    let cancelled_voucher = vouchers
        .iter()
        .find(|voucher| voucher.id == "v2")
        .expect("the cancelled voucher is still recorded");
    assert_eq!(cancelled_voucher.status, "cancelled");
}

#[test]
fn an_allocation_for_another_company_is_refused() {    let workspace = workspace_with_ledgers("post_company");
    insert_company(&workspace.database, company("c2")).unwrap();

    let sale = voucher(
        "v1",
        "c1",
        "INV-0001",
        "sales",
        "2026-05-04",
        Some("l1"),
        vec![entry("v1-e1", "l1", 100_000, 0), entry("v1-e2", "l2", 0, 100_000)],
    );
    // The party belongs to the other company.
    let bad = allocation("alloc-1", "c2", "v1", "v1", "missing-party", 50_000);

    let outcome = post_voucher(
        &workspace.database,
        payload(sale, vec![bad], vec![], vec!["l1".into()]),
    );
    assert!(outcome.is_err());
    assert!(list_vouchers(&workspace.database, "c1", &Default::default())
        .unwrap()
        .is_empty());
}
