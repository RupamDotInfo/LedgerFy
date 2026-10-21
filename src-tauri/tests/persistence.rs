//! Integration tests against a real SQLite database in a temporary directory.
//!
//! These exercise the same functions the Tauri commands call, so they cover
//! the actual write path: transactions, foreign keys, company isolation and
//! what survives a reload.

use std::path::PathBuf;

use ledgerfy_lib::commands::{
    delete_voucher, get_voucher, insert_company, list_companies, list_godowns, list_ledgers,
    list_vouchers, next_voucher_number, save_godown, save_ledger, save_voucher,
};
use ledgerfy_lib::db::Database;
use ledgerfy_lib::entities::*;

struct TempWorkspace {
    database: Database,
    directory: PathBuf,
}

impl Drop for TempWorkspace {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.directory);
    }
}

fn temp_workspace(name: &str) -> TempWorkspace {
    let directory = std::env::temp_dir().join(format!(
        "ledgerfy-it-{name}-{}-{:?}",
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

fn balanced_voucher(id: &str, company_id: &str, number: &str, customer: &str, sales: &str) -> Voucher {
    Voucher {
        id: id.into(),
        company_id: company_id.into(),
        kind: "sales".into(),
        number: number.into(),
        date: "2026-05-04".into(),
        due_date: Some("2026-06-03".into()),
        payment_term_id: None,
        party_id: Some(customer.into()),
        narration: "Integration test sale".into(),
        reference: "TEST".into(),
        status: "posted".into(),
        entries: vec![
            VoucherEntry {
                id: format!("{id}-e1"),
                ledger_id: customer.into(),
                debit: 118000,
                credit: 0,
                narration: None,
                cost_centre_id: None,
            },
            VoucherEntry {
                id: format!("{id}-e2"),
                ledger_id: sales.into(),
                debit: 0,
                credit: 100000,
                narration: None,
                cost_centre_id: None,
            },
            VoucherEntry {
                id: format!("{id}-e3"),
                ledger_id: sales.into(),
                debit: 0,
                credit: 18000,
                narration: None,
                cost_centre_id: None,
            },
        ],
        items: vec![],
        taxes: vec![],
        linked_voucher_id: None,
        reversed_by_voucher_id: None,
        is_locked: false,
        created_at: "2026-05-04T00:00:00.000Z".into(),
        updated_at: "2026-05-04T00:00:00.000Z".into(),
    }
}

#[test]
fn records_survive_a_reopen_of_the_database() {
    let workspace = temp_workspace("reopen");
    let path = workspace.database.path().to_path_buf();

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
    save_voucher(
        &workspace.database,
        balanced_voucher("v1", "c1", "INV-0001", "l1", "l2"),
        "tester",
    )
    .unwrap();

    // Close the connection and open the same file again.
    workspace.database.close_connection().unwrap();
    let reopened = Database::open(&path).unwrap();

    let companies = list_companies(&reopened).unwrap();
    assert_eq!(companies.len(), 1);
    assert_eq!(companies[0].id, "c1");

    let ledgers = list_ledgers(&reopened, "c1").unwrap();
    assert_eq!(ledgers.len(), 2);

    let vouchers = list_vouchers(&reopened, "c1", &Default::default()).unwrap();
    assert_eq!(vouchers.len(), 1);
    assert_eq!(vouchers[0].number, "INV-0001");
    assert_eq!(vouchers[0].entries.len(), 3);
}

#[test]
fn a_reloaded_voucher_still_balances() {
    let workspace = temp_workspace("balanced");
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
    save_voucher(
        &workspace.database,
        balanced_voucher("v1", "c1", "INV-0001", "l1", "l2"),
        "tester",
    )
    .unwrap();

    let loaded = get_voucher(&workspace.database, "c1", "v1").unwrap().unwrap();
    let debit: i64 = loaded.entries.iter().map(|entry| entry.debit).sum();
    let credit: i64 = loaded.entries.iter().map(|entry| entry.credit).sum();
    assert_eq!(debit, credit, "a voucher reloaded from the database must balance");
    assert_eq!(debit, 118000);
}

#[test]
fn a_failed_multi_record_write_leaves_nothing_behind() {
    let workspace = temp_workspace("atomic");
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

    // The third entry points at a ledger that does not exist. The whole
    // voucher must be rejected, not half written.
    let mut voucher = balanced_voucher("v2", "c1", "INV-0002", "l1", "l2");
    voucher.entries.push(VoucherEntry {
        id: "v2-e4".into(),
        ledger_id: "missing-ledger".into(),
        debit: 0,
        credit: 5000,
        narration: None,
        cost_centre_id: None,
    });

    let outcome = save_voucher(&workspace.database, voucher, "tester");
    assert!(outcome.is_err(), "the write should have been rejected");

    let vouchers = list_vouchers(&workspace.database, "c1", &Default::default()).unwrap();
    assert!(
        vouchers.is_empty(),
        "a rejected voucher must not leave a partial record: {:?}",
        vouchers.iter().map(|v| &v.number).collect::<Vec<_>>()
    );

    // The entry rows must be gone as well.
    let connection = workspace.database.lock();
    let entry_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM voucher_entries", [], |row| row.get(0))
        .unwrap();
    assert_eq!(entry_count, 0);
}

#[test]
fn a_voucher_cannot_reach_a_ledger_of_another_company() {
    let workspace = temp_workspace("isolation");
    insert_company(&workspace.database, company("c1")).unwrap();
    insert_company(&workspace.database, company("c2")).unwrap();
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
    // A ledger that belongs to the other company.
    save_ledger(
        &workspace.database,
        ledger("l3", "c2", "Other Company Sales", "income", "sales"),
    )
    .unwrap();

    let mut voucher = balanced_voucher("v1", "c1", "INV-0001", "l1", "l2");
    voucher.entries[1].ledger_id = "l3".into();

    let outcome = save_voucher(&workspace.database, voucher, "tester");
    assert!(
        outcome.is_err(),
        "a voucher must not be able to post to another company's ledger"
    );

    let vouchers = list_vouchers(&workspace.database, "c1", &Default::default()).unwrap();
    assert!(vouchers.is_empty());
}

#[test]
fn a_company_cannot_see_another_company_s_records() {
    let workspace = temp_workspace("scoping");
    insert_company(&workspace.database, company("c1")).unwrap();
    insert_company(&workspace.database, company("c2")).unwrap();
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
    save_voucher(
        &workspace.database,
        balanced_voucher("v1", "c1", "INV-0001", "l1", "l2"),
        "tester",
    )
    .unwrap();

    let for_other = list_vouchers(&workspace.database, "c2", &Default::default()).unwrap();
    assert!(for_other.is_empty());
    assert!(get_voucher(&workspace.database, "c2", "v1").unwrap().is_none());
}

#[test]
fn voucher_numbers_do_not_collide_after_a_deletion() {
    let workspace = temp_workspace("numbering");
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

    for index in 1..=3 {
        save_voucher(
            &workspace.database,
            balanced_voucher(&format!("v{index}"), "c1", &format!("INV-{index:04}"), "l1", "l2"),
            "tester",
        )
        .unwrap();
    }

    delete_voucher(&workspace.database, "c1", "v2").unwrap();

    let next = next_voucher_number(&workspace.database, "c1", "sales", None, None).unwrap();
    assert_eq!(next, "INV-0004", "a deleted number must not be handed out again");
}

#[test]
fn a_voucher_saved_twice_keeps_one_record() {
    let workspace = temp_workspace("resave");
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

    let voucher = balanced_voucher("v1", "c1", "INV-0001", "l1", "l2");
    save_voucher(&workspace.database, voucher.clone(), "tester").unwrap();
    save_voucher(&workspace.database, voucher, "tester").unwrap();

    let vouchers = list_vouchers(&workspace.database, "c1", &Default::default()).unwrap();
    assert_eq!(vouchers.len(), 1);
    assert_eq!(vouchers[0].entries.len(), 3, "the lines must be replaced, not doubled");
}

#[test]
fn a_duplicate_voucher_number_is_refused() {
    let workspace = temp_workspace("duplicate");
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

    save_voucher(
        &workspace.database,
        balanced_voucher("v1", "c1", "INV-0001", "l1", "l2"),
        "tester",
    )
    .unwrap();

    let clash = balanced_voucher("v2", "c1", "INV-0001", "l1", "l2");
    assert!(save_voucher(&workspace.database, clash, "tester").is_err());
}

#[test]
fn money_outside_the_supported_range_is_refused() {
    let workspace = temp_workspace("range");
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

    let mut voucher = balanced_voucher("v1", "c1", "INV-0001", "l1", "l2");
    voucher.entries[0].debit = MAX_MONEY_MINOR + 1;

    let outcome = save_voucher(&workspace.database, voucher, "tester");
    assert!(outcome.is_err());
    assert!(outcome.unwrap_err().contains("supported range"));
}

#[test]
fn master_records_can_be_written_and_read_back() {
    let workspace = temp_workspace("masters");
    insert_company(&workspace.database, company("c1")).unwrap();

    let godown = Godown {
        id: "g1".into(),
        company_id: "c1".into(),
        name: "Main Store".into(),
        location: Some("Ahmedabad".into()),
    };
    save_godown(&workspace.database, godown.clone()).unwrap();
    assert_eq!(list_godowns(&workspace.database, "c1").unwrap().len(), 1);

    // Saving the same record again updates it rather than duplicating it.
    let renamed = Godown {
        id: godown.id.clone(),
        company_id: godown.company_id.clone(),
        name: "Head Store".into(),
        location: godown.location.clone(),
    };
    save_godown(&workspace.database, renamed.clone()).unwrap();
    let godowns = list_godowns(&workspace.database, "c1").unwrap();
    assert_eq!(godowns.len(), 1);
    assert_eq!(godowns[0].name, "Head Store");
}

#[test]
fn a_master_record_of_another_company_is_refused() {
    let workspace = temp_workspace("master_scope");
    insert_company(&workspace.database, company("c1")).unwrap();
    insert_company(&workspace.database, company("c2")).unwrap();

    let orphan = Godown {
        id: "g1".into(),
        company_id: "missing".into(),
        name: "Orphan Store".into(),
        location: None,
    };
    assert!(save_godown(&workspace.database, orphan).is_err());
    assert!(list_godowns(&workspace.database, "c1").unwrap().is_empty());
}
