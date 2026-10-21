# Payroll accounting policy

**Status:** implemented and tested
**Applies to:** Milestone 5D — payroll
**Companion documents:** `docs/payroll-compliance-sources.md` (the evidence
for every rule used) and `docs/inventory-accounting-policy.md` (the costing
policy a payroll journal inherits).

---

## 1. What a payroll run is

A payroll run is the calculation and the posting of one period's pay for one
company. It is a **record of its own**, not a voucher, because it has a
lifecycle, a history and a snapshot. The journal it produces is an ordinary
journal voucher, posted through the ordinary posting path.

A run is therefore:

| State | What it means | What may happen |
| --- | --- | --- |
| `draft` | the employees and the period are chosen | employees may be added or removed |
| `calculated` | the pay has been computed and the snapshot taken | it may be recalculated, or approved |
| `approved` | a person has checked it | it may be posted, or sent back to `calculated` |
| `posted` | the journal has been written | it may be paid, or reversed |
| `paid` | the salary has been settled | nothing; the run is closed |
| `cancelled` | withdrawn before posting | it may be reopened as a `draft` |
| `reversed` | posted and then withdrawn | a new run must be created instead |

**A posted run is never edited.** A correction is a reversal and a new run, so
that the ledger and the payslips that were given to people keep saying what
they said.

---

## 2. The calculation

The calculation is a **pure function**. It takes the employee's salary
structure, the attendance, the rules in force for the period and the period
itself, and it returns a snapshot. It reads nothing and writes nothing.

### 2.1 The order of the calculation

1. **Earnings.** Each earning component of the structure in force is computed
   for the period, using the component's own basis — a fixed amount, a
   percentage of another component, or a rate per unit of attendance.
2. **Gross earnings** is the sum of the earnings.
3. **Employee deductions.** The employee's own statutory contributions (EPF,
   ESIC) are computed on the wage base the relevant rule names, and the
   employee's other deductions (advances, recoveries) are taken from the
   attendance record.
4. **Statutory deductions.** Professional tax and salary tax deducted at
   source are computed.
5. **Net pay** is gross earnings less every deduction.
6. **Employer contributions** are computed on the same bases the employee
   contributions used.
7. **The run totals** are the sums, and the run balances: gross earnings plus
   employer contributions, less every deduction, is exactly the sum of the
   liabilities created.

### 2.2 Exactness and rounding

Every amount is an integer number of **minor units** (paise), and every
percentage is applied with exact integer arithmetic — never a floating-point
multiplication. A rate is held as a numerator and a denominator in basis
points, so 12% is `1200 / 10000` and the product is exact before it is
rounded.

Each computed amount is rounded to the nearest rupee, half away from zero,
because that is what is paid and what is remitted. **The rounded amounts are
the amounts that are posted**, so the journal and the payslip always agree to
the paisa. The unrounded figure is kept in the snapshot, so the rounding is
visible and explainable.

### 2.3 The rule in force

Each statutory rule is effective-dated. The rule used is the one in force on
the **date of payment** for salary tax deducted at source, and on the **last
day of the period** for the contributions, which is the convention the
notifications use. The snapshot records the version of every rule used, with
its source and its status.

A rule whose status is not `In force` **blocks the run**. The refusal names
the rule and the period. A person with the authority to decide may
acknowledge it, and the acknowledgement is written to the audit trail with
who and when.

---

## 3. The journal

A posted run writes **one** journal voucher. It is not a second salary
voucher, and the expense is not posted twice: the earnings are not a separate
debit anywhere else.

| Account | Debit | Credit |
| --- | --- | --- |
| Salary expense (the cost of employment) | gross earnings + employer contributions | — |
| Net salary payable | — | gross earnings − every employee deduction |
| Employee deductions payable (EPF, ESIC) | — | the employee's own contributions |
| Statutory deductions payable (professional tax, salary tax) | — | the statutory deductions |
| Employer contributions payable (EPF, ESIC) | — | the employer's contributions |

The debit equals the sum of the credits, and the run carries the proof.

**The accounts are the company's.** A company maps them once, in the same way
it maps its inventory accounts. A company that has not chosen them cannot
post a payroll run, and the refusal says which setting is missing. No ledger
identifier is ever invented, and no account is assumed to exist.

The journal is posted through the ordinary posting path, so it is one
transaction with its entries, its audit event and its voucher number, and it
obeys the same period locks as every other voucher. A run for a closed period
is refused.

---

## 4. Payments

A salary payment is an ordinary **payment voucher** made against the net
salary payable account, through the ordinary payment screen. The run records
which payment vouchers settled it and how much is still outstanding.

The application does not pay anyone. It produces the voucher a person can
pay, and it tracks the settlement. No bank transfer is made and no payment is
reported as made without a payment voucher against it.

---

## 5. The snapshot

A calculated run stores a snapshot per employee. The snapshot holds:

- every input: the salary structure and its version, the attendance, the
  period, and the version and status of every rule applied;
- every intermediate figure: each earning, each wage base, each contribution
  before and after rounding;
- every output: the gross, each deduction, the net pay, the employer's
  contributions, and the liability created.

**The payslip is rendered from the snapshot, never recomputed.** If a salary
structure is changed tomorrow, a payslip issued last month still says what it
said, and the run still reconciles.

---

## 6. What is not implemented

- **Statutory bonus, gratuity, leave encashment and equal remuneration.** They
  are separate obligations with their own conditions. The thresholds are
  recorded in `docs/payroll-compliance-sources.md` §7 for reference only.
- **Any filing, deposit or challan.** The application computes the figures for
  a return; the filing is a government portal. No filing status is shown,
  because none has been received.
- **The states' professional tax schedules other than West Bengal's.** A
  company in another state gets no professional tax until its schedule is
  entered and acknowledged, and the application says so.
- **Leave management, shifts, rosters, loan and advance management, and
  benefits administration.**
- **Contractor payroll and multi-establishment compliance.**

---

## 7. The invariants

| # | Invariant | Checked by |
| --- | --- | --- |
| 1 | A run's debit equals its credit, to the paisa | `tests/payroll.spec.ts` |
| 2 | Net pay is never negative, and an over-deduction is refused | `tests/payroll.spec.ts` |
| 3 | The snapshot reproduces the payslip exactly | `tests/payroll.spec.ts` |
| 4 | A posted run is never edited, and a run is posted at most once | `tests/payroll.spec.ts` and the Rust tests |
| 5 | Every figure in the journal is the figure on the payslip | `tests/payroll.spec.ts` |
| 6 | A rule that is not in force blocks the run | `tests/payroll.spec.ts` |
| 7 | The employer contribution is expensed once | `tests/payroll.spec.ts` |
| 8 | A run in a closed period is refused | the existing posting rules |
| 9 | The payroll journal balances in the trial balance | `tests/payroll.spec.ts` |
| 10 | A company without an account mapping cannot post | `tests/payroll.spec.ts` |
