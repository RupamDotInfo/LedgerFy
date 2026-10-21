//! Integration tests for payroll.
//!
//! These drive the same functions the Tauri commands call, against a real
//! SQLite database in a temporary directory.

use std::path::PathBuf;

use ledgerfy_lib::commands::{
    delete_payroll_run, get_payroll_accounts, get_payroll_run, get_salary_structure,
    insert_company, list_attendance, list_payroll_payments, list_payroll_runs, list_salary_assignments,
    list_salary_structures, list_statutory_rules, list_vouchers, payroll_number, post_payroll_run,
    save_attendance, save_employee, save_ledger, save_payroll_accounts, save_payroll_payment,
    save_payroll_run, save_payroll_snapshots, save_salary_assignment, save_salary_structure,
    save_statutory_rule, PAYROLL_RUN_DELETE_MESSAGE, PAYROLL_RUN_POSTED_MESSAGE,
    SALARY_STRUCTURE_LOCKED_MESSAGE,
};
use ledgerfy_lib::db::Database;
use ledgerfy_lib::entities::*;

const COMPANY: &str = "c1";
const OTHER_COMPANY: &str = "c2";
const EMPLOYEE: &str = "e1";
const SALARY_EXPENSE: &str = "l1";
const NET_SALARY_PAYABLE: &str = "l2";
const EMPLOYEE_DEDUCTIONS: &str = "l3";
const STATUTORY_DEDUCTIONS: &str = "l4";
const EMPLOYER_CONTRIBUTIONS: &str = "l5";

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
        "ledgerfy-payroll-{name}-{}-{:?}",
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

fn employee(id: &str, company_id: &str, name: &str, code: &str) -> Employee {
    Employee {
        id: id.into(),
        company_id: company_id.into(),
        name: name.into(),
        code: code.into(),
        department: "Operations".into(),
        designation: "Operator".into(),
        date_of_joining: "2026-04-01".into(),
        monthly_gross: 60_000,
        is_active: true,
        cost_centre_id: None,
        pan: Some("ABCDE1234F".into()),
        tax_regime: Some("new".into()),
        is_provident_fund_member: true,
        is_state_insurance_member: false,
        is_person_with_disability: false,
        professional_tax_jurisdiction: Some("West Bengal".into()),
        bank_name: Some("Bank of India".into()),
        bank_account_number: Some("000111222333".into()),
        bank_ifsc: Some("BOI0001112".into()),
    }
}

fn structure(id: &str, company_id: &str, name: &str, version: i64, from: &str) -> SalaryStructure {
    SalaryStructure {
        id: id.into(),
        company_id: company_id.into(),
        name: name.into(),
        version,
        effective_from: from.into(),
        effective_to: None,
        is_active: true,
        created_at: "2026-04-01T00:00:00.000Z".into(),
        updated_at: "2026-04-01T00:00:00.000Z".into(),
    }
}

fn component(
    id: &str,
    company_id: &str,
    structure_id: &str,
    code: &str,
    kind: &str,
    amount: i64,
    position: i64,
) -> SalaryComponent {
    SalaryComponent {
        id: id.into(),
        company_id: company_id.into(),
        structure_id: structure_id.into(),
        code: code.into(),
        name: code.into(),
        kind: kind.into(),
        calculation: serde_json::json!({ "type": "fixed", "amount": amount }),
        bases: serde_json::json!(["basic"]),
        position,
    }
}

fn attendance(id: &str, company_id: &str, employee_id: &str, period: &str) -> PayrollAttendance {
    PayrollAttendance {
        id: id.into(),
        company_id: company_id.into(),
        employee_id: employee_id.into(),
        period: period.into(),
        payable_days: 30,
        lop_days: 2,
        extra_days: 0,
        other_deductions: 500,
        note: "Two days lost without pay".into(),
        created_at: "2026-04-30T00:00:00.000Z".into(),
        updated_at: "2026-04-30T00:00:00.000Z".into(),
    }
}

fn run(id: &str, company_id: &str, number: &str, status: &str) -> PayrollRun {
    PayrollRun {
        id: id.into(),
        company_id: company_id.into(),
        number: number.into(),
        period: "2026-04".into(),
        period_start: "2026-04-01".into(),
        period_end: "2026-04-30".into(),
        payment_date: "2026-04-30".into(),
        status: status.into(),
        employee_count: 1,
        gross_earnings: 100_000,
        employee_deductions: 10_000,
        statutory_deductions: 0,
        employer_contributions: 0,
        net_pay: 90_000,
        journal_voucher_id: None,
        created_at: "2026-04-30T00:00:00.000Z".into(),
        updated_at: "2026-04-30T00:00:00.000Z".into(),
        revision: 0,
    }
}

fn snapshot(id: &str, company_id: &str, run_id: &str, employee_id: &str) -> PayrollSnapshot {
    PayrollSnapshot {
        id: id.into(),
        company_id: company_id.into(),
        run_id: run_id.into(),
        employee_id: employee_id.into(),
        snapshot: serde_json::json!({
            "employeeId": employee_id,
            "employeeName": "Asha Rao",
            "period": "2026-04",
            "grossEarnings": 100000,
            "netPay": 90000,
            "components": [{ "code": "BASIC", "amount": 100000 }]
        }),
        created_at: "2026-04-30T00:00:00.000Z".into(),
    }
}

fn payroll_accounts(id: &str, company_id: &str) -> PayrollAccounts {
    PayrollAccounts {
        id: id.into(),
        company_id: company_id.into(),
        salary_expense_ledger_id: SALARY_EXPENSE.into(),
        net_salary_payable_ledger_id: NET_SALARY_PAYABLE.into(),
        employee_deductions_payable_ledger_id: EMPLOYEE_DEDUCTIONS.into(),
        statutory_deductions_payable_ledger_id: STATUTORY_DEDUCTIONS.into(),
        employer_contributions_payable_ledger_id: EMPLOYER_CONTRIBUTIONS.into(),
        created_at: "2026-04-01T00:00:00.000Z".into(),
    }
}

fn rule(id: &str, company_id: &str, rule_set: &str, from: &str) -> StatutoryRuleVersion {
    StatutoryRuleVersion {
        id: id.into(),
        company_id: company_id.into(),
        rule_set: rule_set.into(),
        effective_from: from.into(),
        effective_to: None,
        status: "in-force".into(),
        source: "Employee's Provident Fund Scheme, 1952".into(),
        summary: "Twelve per cent of the wages, up to the ceiling.".into(),
        parameters: serde_json::json!({
            "kind": "epf",
            "employeeRateBps": 1200,
            "employerRateBps": 1200,
            "wageCeiling": 1500000
        }),
        acknowledged: false,
        acknowledged_by: None,
        acknowledged_at: None,
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

/// The payroll journal: the cost of employment debited, the pay and the
/// deductions credited.
fn journal(voucher_id: &str, company_id: &str, broken_ledger: Option<&str>) -> PostingPayload {
    let debit_ledger = SALARY_EXPENSE;
    let credit_ledger = NET_SALARY_PAYABLE;
    let deduction_ledger = match broken_ledger {
        Some(ledger) => ledger,
        None => EMPLOYEE_DEDUCTIONS,
    };
    let voucher = Voucher {
        id: voucher_id.into(),
        company_id: company_id.into(),
        kind: "journal".into(),
        number: format!("JNL-{voucher_id}"),
        date: "2026-04-30".into(),
        due_date: None,
        payment_term_id: None,
        party_id: None,
        narration: "Payroll for April 2026".into(),
        reference: String::new(),
        status: "posted".into(),
        entries: vec![
            entry(&format!("{voucher_id}-e1"), debit_ledger, 100_000, 0),
            entry(&format!("{voucher_id}-e2"), credit_ledger, 0, 90_000),
            entry(&format!("{voucher_id}-e3"), deduction_ledger, 0, 10_000),
        ],
        items: vec![],
        taxes: vec![],
        linked_voucher_id: None,
        reversed_by_voucher_id: None,
        is_locked: false,
        created_at: "2026-04-30T00:00:00.000Z".into(),
        updated_at: "2026-04-30T00:00:00.000Z".into(),
    };
    let entries = voucher.entries.clone();
    let attempt = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or(0);
    let audit_events = vec![AuditEvent {
        id: format!("aud-{voucher_id}-{attempt}"),
        company_id: company_id.into(),
        actor: "tester".into(),
        action: "payroll.posted".into(),
        record_type: "payroll_run".into(),
        record_id: voucher_id.into(),
        record_label: "PR-2026-04".into(),
        timestamp: voucher.updated_at.clone(),
        detail: None,
    }];
    PostingPayload {
        voucher,
        entries,
        items: vec![],
        taxes: vec![],
        allocations: vec![],
        advances: vec![],
        affected_party_ids: vec![],
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

/// A workspace with one company, its ledgers and one employee.
fn workspace_with_masters(name: &str) -> TempWorkspace {
    let workspace = temp_workspace(name);
    insert_company(&workspace.database, company(COMPANY)).unwrap();
    for (id, name, group, kind) in [
        (SALARY_EXPENSE, "Salaries", "expenses", "expense"),
        (NET_SALARY_PAYABLE, "Net Salary Payable", "liabilities", "payable"),
        (
            EMPLOYEE_DEDUCTIONS,
            "Employee Deductions Payable",
            "liabilities",
            "payable",
        ),
        (
            STATUTORY_DEDUCTIONS,
            "Statutory Deductions Payable",
            "liabilities",
            "payable",
        ),
        (
            EMPLOYER_CONTRIBUTIONS,
            "Employer Contributions Payable",
            "liabilities",
            "payable",
        ),
    ] {
        save_ledger(&workspace.database, ledger(id, COMPANY, name, group, kind)).unwrap();
    }
    save_employee(&workspace.database, employee(EMPLOYEE, COMPANY, "Asha Rao", "E001")).unwrap();
    workspace
}

/// A workspace with two companies, each with its own ledgers.
fn workspace_with_two_companies(name: &str) -> TempWorkspace {
    let workspace = workspace_with_masters(name);
    insert_company(&workspace.database, company(OTHER_COMPANY)).unwrap();
    save_ledger(
        &workspace.database,
        ledger("l9", OTHER_COMPANY, "Other Salaries", "expenses", "expense"),
    )
    .unwrap();
    save_employee(
        &workspace.database,
        employee("e2", OTHER_COMPANY, "Bhanu Shah", "E002"),
    )
    .unwrap();
    workspace
}

#[test]
fn a_salary_structure_and_its_components_are_saved_and_read_back() {
    let workspace = workspace_with_masters("structure");

    let saved = save_salary_structure(
        &workspace.database,
        structure("s1", COMPANY, "Technician", 1, "2026-04-01"),
        vec![
            component("sc1", COMPANY, "s1", "BASIC", "earning", 60_000, 1),
            component("sc2", COMPANY, "s1", "HRA", "earning", 40_000, 2),
        ],
    )
    .unwrap();
    assert_eq!(saved.id, "s1");
    assert_eq!(saved.version, 1);
    assert_eq!(saved.is_active, true);

    let detail = get_salary_structure(&workspace.database, COMPANY, "s1").unwrap();
    assert_eq!(detail.structure.name, "Technician");
    assert_eq!(detail.components.len(), 2);
    assert_eq!(detail.components[0].code, "BASIC");
    assert_eq!(detail.components[0].kind, "earning");
    assert_eq!(detail.components[0].position, 1);
    // The calculation is a JSON document, and it survives the round trip.
    assert_eq!(
        detail.components[0].calculation,
        serde_json::json!({ "type": "fixed", "amount": 60000 })
    );
    assert_eq!(detail.components[0].bases, serde_json::json!(["basic"]));

    // The structure is listed with its components.
    let listed = list_salary_structures(&workspace.database, COMPANY).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, "s1");

    // The structure of another company is not this company's structure.
    assert!(list_salary_structures(&workspace.database, OTHER_COMPANY)
        .unwrap()
        .is_empty());
    assert!(get_salary_structure(&workspace.database, OTHER_COMPANY, "s1").is_err());
}

#[test]
fn a_used_salary_structure_version_cannot_be_rewritten() {
    let workspace = workspace_with_masters("locked");
    save_salary_structure(
        &workspace.database,
        structure("s1", COMPANY, "Technician", 1, "2026-04-01"),
        vec![component("sc1", COMPANY, "s1", "BASIC", "earning", 60_000, 1)],
    )
    .unwrap();

    // The same version, saved again with the same components, is the same
    // version: it is accepted.
    save_salary_structure(
        &workspace.database,
        structure("s1", COMPANY, "Technician", 1, "2026-04-01"),
        vec![component("sc1", COMPANY, "s1", "BASIC", "earning", 60_000, 1)],
    )
    .unwrap();

    // The same version with different components is refused.
    let refused = save_salary_structure(
        &workspace.database,
        structure("s1", COMPANY, "Technician", 1, "2026-04-01"),
        vec![component("sc1", COMPANY, "s1", "BASIC", "earning", 90_000, 1)],
    );
    assert!(refused.is_err());
    assert_eq!(refused.unwrap_err(), SALARY_STRUCTURE_LOCKED_MESSAGE);

    // Nothing was changed.
    let detail = get_salary_structure(&workspace.database, COMPANY, "s1").unwrap();
    assert_eq!(detail.components.len(), 1);
    assert_eq!(
        detail.components[0].calculation,
        serde_json::json!({ "type": "fixed", "amount": 60000 })
    );

    // A second structure cannot take the version's place.
    let duplicate = save_salary_structure(
        &workspace.database,
        structure("s2", COMPANY, "Technician", 1, "2026-04-01"),
        vec![component("sc3", COMPANY, "s2", "BASIC", "earning", 60_000, 1)],
    );
    assert!(duplicate.is_err());
    assert!(duplicate.unwrap_err().contains("already has a version"));
}

#[test]
fn two_versions_of_a_structure_can_exist_and_both_are_listed() {
    let workspace = workspace_with_masters("versions");

    save_salary_structure(
        &workspace.database,
        structure("s1", COMPANY, "Technician", 1, "2026-04-01"),
        vec![component("sc1", COMPANY, "s1", "BASIC", "earning", 60_000, 1)],
    )
    .unwrap();
    save_salary_structure(
        &workspace.database,
        structure("s2", COMPANY, "Technician", 2, "2026-10-01"),
        vec![component("sc2", COMPANY, "s2", "BASIC", "earning", 70_000, 1)],
    )
    .unwrap();

    let listed = list_salary_structures(&workspace.database, COMPANY).unwrap();
    assert_eq!(listed.len(), 2);
    assert_eq!(listed[0].version, 1);
    assert_eq!(listed[0].effective_from, "2026-04-01");
    assert_eq!(listed[1].version, 2);
    assert_eq!(listed[1].effective_from, "2026-10-01");
}

#[test]
fn a_salary_assignment_is_saved_and_read_back() {
    let workspace = workspace_with_masters("assignment");
    save_salary_structure(
        &workspace.database,
        structure("s1", COMPANY, "Technician", 1, "2026-04-01"),
        vec![component("sc1", COMPANY, "s1", "BASIC", "earning", 60_000, 1)],
    )
    .unwrap();

    let saved = save_salary_assignment(
        &workspace.database,
        SalaryAssignment {
            id: "a1".into(),
            company_id: COMPANY.into(),
            employee_id: EMPLOYEE.into(),
            structure_id: "s1".into(),
            effective_from: "2026-04-01".into(),
            effective_to: None,
            created_at: "2026-04-01T00:00:00.000Z".into(),
        },
    )
    .unwrap();
    assert_eq!(saved.id, "a1");

    let listed = list_salary_assignments(&workspace.database, COMPANY).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].employee_id, EMPLOYEE);
    assert_eq!(listed[0].structure_id, "s1");

    // The assignment of another company is not this company's assignment.
    assert!(list_salary_assignments(&workspace.database, OTHER_COMPANY)
        .unwrap()
        .is_empty());
}

#[test]
fn an_attendance_record_is_saved_and_read_back_for_its_period() {
    let workspace = workspace_with_masters("attendance");

    save_attendance(
        &workspace.database,
        attendance("at1", COMPANY, EMPLOYEE, "2026-04"),
    )
    .unwrap();

    let listed = list_attendance(&workspace.database, COMPANY, "2026-04").unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].employee_id, EMPLOYEE);
    assert_eq!(listed[0].payable_days, 30);
    assert_eq!(listed[0].lop_days, 2);
    assert_eq!(listed[0].other_deductions, 500);
    assert_eq!(listed[0].note, "Two days lost without pay");

    // Another period has no attendance.
    assert!(list_attendance(&workspace.database, COMPANY, "2026-05")
        .unwrap()
        .is_empty());

    // The attendance of another company is not this company's attendance.
    assert!(list_attendance(&workspace.database, OTHER_COMPANY, "2026-04")
        .unwrap()
        .is_empty());
}

#[test]
fn an_attendance_record_keeps_its_identity_and_never_moves_to_another_employee() {
    let workspace = workspace_with_masters("attendance_identity");
    save_employee(
        &workspace.database,
        employee("e2", COMPANY, "Bhanu Shah", "E002"),
    )
    .unwrap();

    save_attendance(
        &workspace.database,
        attendance("at1", COMPANY, EMPLOYEE, "2026-04"),
    )
    .unwrap();

    // The same employee and period, saved again under another identifier,
    // is the same record and keeps its identity.
    let mut again = attendance("at2", COMPANY, EMPLOYEE, "2026-04");
    again.payable_days = 29;
    let saved = save_attendance(&workspace.database, again).unwrap();
    assert_eq!(saved.id, "at1");
    let listed = list_attendance(&workspace.database, COMPANY, "2026-04").unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, "at1");
    assert_eq!(listed[0].payable_days, 29);

    // An identifier that belongs to another employee's record is refused.
    let mut moved = attendance("at1", COMPANY, "e2", "2026-04");
    moved.payable_days = 20;
    let refused = save_attendance(&workspace.database, moved);
    assert!(refused.is_err());
    let listed = list_attendance(&workspace.database, COMPANY, "2026-04").unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].employee_id, EMPLOYEE);
}

#[test]
fn a_run_is_saved_read_back_with_its_snapshots_and_deleted_while_it_is_a_draft() {
    let workspace = workspace_with_masters("run_draft");

    let saved = save_payroll_run(
        &workspace.database,
        run("r1", COMPANY, "PR-2026-04", "draft"),
    )
    .unwrap();
    assert_eq!(saved.id, "r1");
    assert_eq!(saved.status, "draft");
    assert_eq!(saved.gross_earnings, 100_000);
    assert_eq!(saved.net_pay, 90_000);

    save_payroll_snapshots(
        &workspace.database,
        vec![snapshot("sn1", COMPANY, "r1", EMPLOYEE)],
    )
    .unwrap();

    let detail = get_payroll_run(&workspace.database, COMPANY, "r1").unwrap();
    assert_eq!(detail.run.id, "r1");
    assert_eq!(detail.run.number, "PR-2026-04");
    assert_eq!(detail.snapshots.len(), 1);
    assert_eq!(detail.snapshots[0].employee_id, EMPLOYEE);
    // The snapshot is the figures as they were calculated.
    assert_eq!(
        detail.snapshots[0].snapshot,
        snapshot("sn1", COMPANY, "r1", EMPLOYEE).snapshot
    );

    let listed = list_payroll_runs(&workspace.database, COMPANY).unwrap();
    assert_eq!(listed.len(), 1);

    // A draft run can be deleted.
    delete_payroll_run(&workspace.database, COMPANY, "r1").unwrap();
    assert!(list_payroll_runs(&workspace.database, COMPANY).unwrap().is_empty());
    // Its snapshots went with it.
    assert!(get_payroll_run(&workspace.database, COMPANY, "r1").is_err());
}

#[test]
fn a_posted_run_cannot_be_deleted() {
    let workspace = workspace_with_masters("run_posted_delete");
    save_payroll_run(
        &workspace.database,
        run("r1", COMPANY, "PR-2026-04", "posted"),
    )
    .unwrap();

    let refused = delete_payroll_run(&workspace.database, COMPANY, "r1");
    assert!(refused.is_err());
    assert_eq!(refused.unwrap_err(), PAYROLL_RUN_DELETE_MESSAGE);
    assert_eq!(list_payroll_runs(&workspace.database, COMPANY).unwrap().len(), 1);
}

#[test]
fn posting_a_run_writes_the_journal_and_marks_the_run_posted() {
    let workspace = workspace_with_masters("run_post");
    save_payroll_run(
        &workspace.database,
        run("r1", COMPANY, "PR-2026-04", "calculated"),
    )
    .unwrap();

    let posted = post_payroll_run(
        &workspace.database,
        COMPANY,
        "r1",
        journal("v1", COMPANY, None),
    )
    .unwrap();
    assert_eq!(posted.status, "posted");
    assert_eq!(posted.journal_voucher_id.as_deref(), Some("v1"));
    assert_eq!(posted.revision, 1);

    // The journal was written through the ordinary posting path.
    let vouchers = list_vouchers(&workspace.database, COMPANY, &Default::default()).unwrap();
    assert_eq!(vouchers.len(), 1);
    assert_eq!(vouchers[0].id, "v1");
    assert_eq!(vouchers[0].status, "posted");
    assert_eq!(vouchers[0].entries.len(), 3);
    let debit: i64 = vouchers[0].entries.iter().map(|entry| entry.debit).sum();
    let credit: i64 = vouchers[0].entries.iter().map(|entry| entry.credit).sum();
    assert_eq!(debit, credit, "the payroll journal must balance");

    // The run says so too.
    let detail = get_payroll_run(&workspace.database, COMPANY, "r1").unwrap();
    assert_eq!(detail.run.status, "posted");
    assert_eq!(detail.run.journal_voucher_id.as_deref(), Some("v1"));
}

#[test]
fn posting_a_run_twice_is_refused_and_writes_nothing() {
    let workspace = workspace_with_masters("run_post_twice");
    save_payroll_run(
        &workspace.database,
        run("r1", COMPANY, "PR-2026-04", "calculated"),
    )
    .unwrap();
    post_payroll_run(
        &workspace.database,
        COMPANY,
        "r1",
        journal("v1", COMPANY, None),
    )
    .unwrap();

    let refused = post_payroll_run(
        &workspace.database,
        COMPANY,
        "r1",
        journal("v2", COMPANY, None),
    );
    assert!(refused.is_err());
    assert_eq!(refused.unwrap_err(), PAYROLL_RUN_POSTED_MESSAGE);

    // Nothing was written the second time.
    let vouchers = list_vouchers(&workspace.database, COMPANY, &Default::default()).unwrap();
    assert_eq!(vouchers.len(), 1);
    assert_eq!(vouchers[0].id, "v1");
}

#[test]
fn a_run_cannot_be_posted_from_a_state_that_does_not_allow_it() {
    let workspace = workspace_with_masters("run_post_draft");
    save_payroll_run(
        &workspace.database,
        run("r1", COMPANY, "PR-2026-04", "draft"),
    )
    .unwrap();

    let refused = post_payroll_run(
        &workspace.database,
        COMPANY,
        "r1",
        journal("v1", COMPANY, None),
    );
    assert!(refused.is_err());
    assert_eq!(
        refused.unwrap_err(),
        "This payroll run cannot be posted from its current state."
    );
    assert!(list_vouchers(&workspace.database, COMPANY, &Default::default())
        .unwrap()
        .is_empty());
}

#[test]
fn a_failure_part_way_through_leaves_the_run_as_it_was_and_writes_no_voucher() {
    let workspace = workspace_with_masters("run_post_failure");
    save_payroll_run(
        &workspace.database,
        run("r1", COMPANY, "PR-2026-04", "calculated"),
    )
    .unwrap();

    // The third entry points at a ledger that does not exist. The whole
    // posting must be rejected, not half written.
    let refused = post_payroll_run(
        &workspace.database,
        COMPANY,
        "r1",
        journal("v1", COMPANY, Some("missing-ledger")),
    );
    assert!(refused.is_err());

    // The run is unchanged.
    let detail = get_payroll_run(&workspace.database, COMPANY, "r1").unwrap();
    assert_eq!(detail.run.status, "calculated");
    assert_eq!(detail.run.journal_voucher_id, None);
    assert_eq!(detail.run.revision, 0);

    // And no voucher was left behind.
    assert!(list_vouchers(&workspace.database, COMPANY, &Default::default())
        .unwrap()
        .is_empty());
}

#[test]
fn a_run_may_not_claim_a_journal_voucher_another_run_claims() {
    let workspace = workspace_with_masters("run_claim");
    save_payroll_run(
        &workspace.database,
        run("r1", COMPANY, "PR-2026-04", "calculated"),
    )
    .unwrap();
    save_payroll_run(
        &workspace.database,
        run("r2", COMPANY, "PR-2026-04-2", "calculated"),
    )
    .unwrap();

    post_payroll_run(
        &workspace.database,
        COMPANY,
        "r1",
        journal("v1", COMPANY, None),
    )
    .unwrap();

    // The second run cannot claim the journal the first run posted.
    let refused = post_payroll_run(
        &workspace.database,
        COMPANY,
        "r2",
        journal("v1", COMPANY, None),
    );
    assert!(refused.is_err());
    assert!(refused.unwrap_err().contains("already claimed"));

    // The second run is untouched.
    let detail = get_payroll_run(&workspace.database, COMPANY, "r2").unwrap();
    assert_eq!(detail.run.status, "calculated");
    assert_eq!(detail.run.journal_voucher_id, None);

    // Nor may a run be saved with the journal another run claims.
    let mut claiming = run("r2", COMPANY, "PR-2026-04-2", "calculated");
    claiming.journal_voucher_id = Some("v1".into());
    let refused = save_payroll_run(&workspace.database, claiming);
    assert!(refused.is_err());
    assert!(refused.unwrap_err().contains("already claimed"));
}

#[test]
fn a_posted_run_keeps_the_journal_voucher_it_was_posted_with() {
    let workspace = workspace_with_masters("run_keep_voucher");
    save_payroll_run(
        &workspace.database,
        run("r1", COMPANY, "PR-2026-04", "calculated"),
    )
    .unwrap();
    post_payroll_run(
        &workspace.database,
        COMPANY,
        "r1",
        journal("v1", COMPANY, None),
    )
    .unwrap();

    // The run is saved again as it is paid, and it keeps its journal.
    let mut paid = run("r1", COMPANY, "PR-2026-04", "paid");
    paid.journal_voucher_id = None;
    let saved = save_payroll_run(&workspace.database, paid).unwrap();
    assert_eq!(saved.journal_voucher_id.as_deref(), Some("v1"));

    // It cannot be pointed at another journal.
    let mut moved = run("r1", COMPANY, "PR-2026-04", "paid");
    moved.journal_voucher_id = Some("v2".into());
    let refused = save_payroll_run(&workspace.database, moved);
    assert!(refused.is_err());
    assert!(refused.unwrap_err().contains("keeps the journal voucher"));

    // And it still claims the journal it was posted with.
    let detail = get_payroll_run(&workspace.database, COMPANY, "r1").unwrap();
    assert_eq!(detail.run.journal_voucher_id.as_deref(), Some("v1"));
}

#[test]
fn a_payroll_account_mapping_is_saved_and_read_back() {
    let workspace = workspace_with_masters("accounts");

    let saved = save_payroll_accounts(
        &workspace.database,
        payroll_accounts("pa1", COMPANY),
    )
    .unwrap();
    assert_eq!(saved.id, "pa1");

    let stored = get_payroll_accounts(&workspace.database, COMPANY).unwrap().unwrap();
    assert_eq!(stored.id, "pa1");
    assert_eq!(stored.salary_expense_ledger_id, SALARY_EXPENSE);
    assert_eq!(stored.net_salary_payable_ledger_id, NET_SALARY_PAYABLE);
    assert_eq!(
        stored.employee_deductions_payable_ledger_id,
        EMPLOYEE_DEDUCTIONS
    );
    assert_eq!(
        stored.statutory_deductions_payable_ledger_id,
        STATUTORY_DEDUCTIONS
    );
    assert_eq!(
        stored.employer_contributions_payable_ledger_id,
        EMPLOYER_CONTRIBUTIONS
    );

    // Saving again replaces the accounts in force and keeps the identity of
    // the record.
    let mut changed = payroll_accounts("pa-other", COMPANY);
    changed.net_salary_payable_ledger_id = EMPLOYEE_DEDUCTIONS.into();
    let saved = save_payroll_accounts(&workspace.database, changed).unwrap();
    assert_eq!(saved.id, "pa1");
    let stored = get_payroll_accounts(&workspace.database, COMPANY).unwrap().unwrap();
    assert_eq!(stored.id, "pa1");
    assert_eq!(stored.net_salary_payable_ledger_id, EMPLOYEE_DEDUCTIONS);

    // A company that has not chosen its accounts has none.
    assert!(get_payroll_accounts(&workspace.database, OTHER_COMPANY)
        .unwrap()
        .is_none());
}

#[test]
fn a_payroll_account_of_another_company_is_refused() {
    let workspace = workspace_with_two_companies("accounts_scope");

    let mut foreign = payroll_accounts("pa1", COMPANY);
    foreign.salary_expense_ledger_id = "l9".into();
    let refused = save_payroll_accounts(&workspace.database, foreign);
    assert!(refused.is_err());
    assert_eq!(
        refused.unwrap_err(),
        "The salary expense account does not belong to this company."
    );

    // Nothing was saved.
    assert!(get_payroll_accounts(&workspace.database, COMPANY)
        .unwrap()
        .is_none());
}

#[test]
fn a_statutory_rule_version_is_saved_and_read_back_with_its_parameters() {
    let workspace = workspace_with_masters("rules");

    let saved = save_statutory_rule(&workspace.database, rule("r1", COMPANY, "epf", "2026-04-01"))
        .unwrap();
    assert_eq!(saved.id, "r1");
    assert_eq!(saved.status, "in-force");

    let listed = list_statutory_rules(&workspace.database, COMPANY).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].rule_set, "epf");
    assert_eq!(listed[0].effective_from, "2026-04-01");
    assert_eq!(listed[0].source, "Employee's Provident Fund Scheme, 1952");
    assert_eq!(listed[0].acknowledged, false);
    // The parameters are a JSON document, and they survive the round trip.
    assert_eq!(
        listed[0].parameters,
        serde_json::json!({
            "kind": "epf",
            "employeeRateBps": 1200,
            "employerRateBps": 1200,
            "wageCeiling": 1500000
        })
    );

    // One version of a rule applies from one date.
    let refused = save_statutory_rule(&workspace.database, rule("r2", COMPANY, "epf", "2026-04-01"));
    assert!(refused.is_err());

    // The rules of another company are not this company's rules.
    assert!(list_statutory_rules(&workspace.database, OTHER_COMPANY)
        .unwrap()
        .is_empty());
}

#[test]
fn a_payroll_payment_is_saved_and_read_back() {
    let workspace = workspace_with_masters("payments");
    save_payroll_run(
        &workspace.database,
        run("r1", COMPANY, "PR-2026-04", "posted"),
    )
    .unwrap();

    let saved = save_payroll_payment(
        &workspace.database,
        PayrollPayment {
            id: "p1".into(),
            company_id: COMPANY.into(),
            run_id: "r1".into(),
            employee_id: EMPLOYEE.into(),
            amount: 90_000,
            payment_voucher_id: Some("pay1".into()),
            paid_on: "2026-04-30".into(),
            created_at: "2026-04-30T00:00:00.000Z".into(),
        },
    )
    .unwrap();
    assert_eq!(saved.amount, 90_000);

    let listed = list_payroll_payments(&workspace.database, COMPANY, "r1").unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].employee_id, EMPLOYEE);
    assert_eq!(listed[0].payment_voucher_id.as_deref(), Some("pay1"));

    // The payments of another run are not these payments.
    assert!(list_payroll_payments(&workspace.database, COMPANY, "r2")
        .unwrap()
        .is_empty());
}

#[test]
fn the_next_run_number_counts_the_runs_of_the_period() {
    let workspace = workspace_with_masters("numbering");

    assert_eq!(
        payroll_number(&workspace.database, COMPANY, "2026-04").unwrap(),
        "PR-2026-04"
    );

    save_payroll_run(
        &workspace.database,
        run("r1", COMPANY, "PR-2026-04", "draft"),
    )
    .unwrap();
    assert_eq!(
        payroll_number(&workspace.database, COMPANY, "2026-04").unwrap(),
        "PR-2026-04-2"
    );

    // Another period is counted on its own.
    assert_eq!(
        payroll_number(&workspace.database, COMPANY, "2026-05").unwrap(),
        "PR-2026-05"
    );
}

#[test]
fn payroll_records_survive_a_reopen_of_the_database() {
    let workspace = workspace_with_masters("reopen");
    let path = workspace.database.path().to_path_buf();

    save_salary_structure(
        &workspace.database,
        structure("s1", COMPANY, "Technician", 1, "2026-04-01"),
        vec![component("sc1", COMPANY, "s1", "BASIC", "earning", 60_000, 1)],
    )
    .unwrap();
    save_attendance(
        &workspace.database,
        attendance("at1", COMPANY, EMPLOYEE, "2026-04"),
    )
    .unwrap();
    save_payroll_run(
        &workspace.database,
        run("r1", COMPANY, "PR-2026-04", "calculated"),
    )
    .unwrap();
    save_payroll_snapshots(
        &workspace.database,
        vec![snapshot("sn1", COMPANY, "r1", EMPLOYEE)],
    )
    .unwrap();
    save_payroll_accounts(
        &workspace.database,
        payroll_accounts("pa1", COMPANY),
    )
    .unwrap();
    save_statutory_rule(&workspace.database, rule("r1", COMPANY, "epf", "2026-04-01")).unwrap();

    // Close the connection and open the same file again.
    workspace.database.close_connection().unwrap();
    let reopened = Database::open(&path).unwrap();

    let detail = get_salary_structure(&reopened, COMPANY, "s1").unwrap();
    assert_eq!(detail.components.len(), 1);
    assert_eq!(
        detail.components[0].calculation,
        serde_json::json!({ "type": "fixed", "amount": 60000 })
    );
    assert_eq!(
        list_attendance(&reopened, COMPANY, "2026-04").unwrap().len(),
        1
    );
    let run = get_payroll_run(&reopened, COMPANY, "r1").unwrap();
    assert_eq!(run.run.status, "calculated");
    assert_eq!(run.snapshots.len(), 1);
    assert_eq!(
        run.snapshots[0].snapshot,
        snapshot("sn1", COMPANY, "r1", EMPLOYEE).snapshot
    );
    assert!(get_payroll_accounts(&reopened, COMPANY).unwrap().is_some());
    assert_eq!(list_statutory_rules(&reopened, COMPANY).unwrap().len(), 1);
}

#[test]
fn a_company_cannot_see_another_company_s_payroll_records() {
    let workspace = workspace_with_two_companies("scoping");

    save_salary_structure(
        &workspace.database,
        structure("s1", COMPANY, "Technician", 1, "2026-04-01"),
        vec![component("sc1", COMPANY, "s1", "BASIC", "earning", 60_000, 1)],
    )
    .unwrap();
    save_payroll_run(
        &workspace.database,
        run("r1", COMPANY, "PR-2026-04", "calculated"),
    )
    .unwrap();
    save_payroll_snapshots(
        &workspace.database,
        vec![snapshot("sn1", COMPANY, "r1", EMPLOYEE)],
    )
    .unwrap();
    save_statutory_rule(&workspace.database, rule("r1", COMPANY, "epf", "2026-04-01")).unwrap();

    // The other company sees none of it.
    assert!(list_salary_structures(&workspace.database, OTHER_COMPANY)
        .unwrap()
        .is_empty());
    assert!(list_payroll_runs(&workspace.database, OTHER_COMPANY)
        .unwrap()
        .is_empty());
    assert!(list_statutory_rules(&workspace.database, OTHER_COMPANY)
        .unwrap()
        .is_empty());
    assert!(get_payroll_run(&workspace.database, OTHER_COMPANY, "r1").is_err());

    // And the other company's employee cannot be attached to this company's
    // records.
    let mut foreign = attendance("at1", OTHER_COMPANY, "e2", "2026-04");
    foreign.employee_id = EMPLOYEE.into();
    let refused = save_attendance(&workspace.database, foreign);
    assert!(refused.is_err());
    assert!(refused.unwrap_err().contains("does not belong to this company"));
}
