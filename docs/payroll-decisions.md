# Open payroll decisions, and the findings not yet fixed

This note records the parts of payroll that are **not decided** and the parts
that are **known to be wrong but are not fixed here**. Nothing in it grants a
permission or changes an accounting rule. Each item says what the code does
today, what the alternatives are, and what each one is worth.

The items marked **decided** are the ones this change settles. The rest are
outstanding and need either a decision from the owner or a further change.

---

## Decided in this change

| # | Finding | What was done |
|---|---|---|
| B1a | The salary assignment was chosen by comparing a `YYYY-MM-DD` date with a `YYYY-MM` period. A revision that began inside the run month was ignored, and an employee whose only assignment began inside the month was dropped from the run altogether. | `assignmentInForce()` in `src/domain/payrollRules.ts` compares dates, against the period bounds, and follows the same rule the statutory rules follow: the assignment that started most recently wins. |
| F3 | The projected annual gross added up the **fixed** components only, so the salary tax was projected from less money than the run pays. | `projectedMonthlyGross()` in `src/domain/payroll.ts` includes every earning and reimbursement component, each on its own basis. |
| — | The proration of a fixed or per-day amount multiplied money by a floating-point fraction, which the policy forbids. For an amount carrying paise it posted a rupee less than it should: 4 858 paise over 17 of 28 days is 2 949.5 paise, which posts 30 rupees exactly, but the floating-point division gives 2 949.499999999999999545 and posts 29. | The proration is worked out in integers, rounded half away from zero, and the amount is never multiplied by a fraction. |
| — | A negative, fractional or out-of-range attendance figure was silently clamped, so an attendance record could pay an amount nobody asked for. | `validateAttendance()` refuses those figures with a message that names the field and the value. |

---

## Open decisions

### 1. A salary revision that takes effect part-way through the period

**What the code does now.** The structure in force for the period is the one
whose effective window overlaps the period, and where several overlap the one
that started most recently wins. So a revision effective 15 April applies to
the whole of April.

**Why it is a decision.** The policy says the earnings are computed from "the
structure in force" and does not say what happens when a revision lands inside
the period. The statutory rules have a documented answer for the one case the
sources cover - a wage ceiling that changes part-way through a month is
applied on each side of the change, with the employer's share split
(`docs/payroll-compliance-sources.md`). Salary structures have no such rule.

**The options.**

| | Treatment | A revision effective 15 April on a ₹50 000 structure, period April 2026 (30 days) |
|---|---|---|
| A | The later structure for the whole period (what the code does) | ₹50 000 for April, at the new rate |
| B | The structure in force at the start of the period | ₹50 000 for April, at the old rate |
| C | Split the period: each part at its own structure, each part's fixed components prorated by its days | 14 days at the old rate, 16 days at the new rate |

**The impact.** Option C is the only one that matches what the employer
actually owes an employee whose pay changed mid-month, and it is the only one
that costs anything to implement: the calculation runs twice, the component
amounts are apportioned by days, and the rounding happens twice, so a part
that rounds up and a part that rounds down can differ by a rupee from the
single-computation answer. Option A and B differ from each other by the whole
of the revision for that month.

**Recommendation.** C, because the product already applies a part-month split
to a wage ceiling that changes mid-month, and an employee and an employer
would expect the same treatment for a pay revision. But it is the owner's
call: it is a change to what a run means, not a defect.

### 2. An employee who leaves part-way through the period

**What the code does now.** A structure whose effective window ends inside the
period still qualifies, and the employee's fixed components are paid for the
**whole** period, not for the days they were there. A revision that ends on
10 April pays 30 days.

**Why it is a decision.** This is the same question as decision 1, from the
other end: does the period get split at the point the structure changes?

**Recommendation.** Whatever is decided for decision 1 applies here. A
part-period employee needs a part-period calculation, and the days-in-period
and payable-days figures already exist to carry it.

### 3. Extra days, and what a day lost without pay is worth

**What the code does now.** `extraDays` - "days paid at a different rate, such
as overtime" - is stored, shown in the interface, and **never read**. Nothing
in the sources says what an extra day is paid at.

Loss of pay is not lost in the same way: it is applied through `payableDays`,
which is the number of days the employee is paid for. The fixture derives one
from the other; the interface does not, so the two can disagree.

**Why it is a decision.** There is no formula anywhere for an overtime day: no
multiplier, no daily rate, no rounding rule. A statutory source does not
settle it, because the daily wage ceiling that would fix it is not among the
rules in force.

**The options.** An extra day is paid at the daily wage derived from the
structure (the rate the structure itself already computes for a per-day
component); or it is paid at a multiple of it; or it is carried as a quantity
for a later workflow and not paid in this run at all.

**Recommendation.** The third, until the daily rate is settled: an extra day
that is recorded and not paid is visible, and a day that is paid by an invented
multiplier is not.

### 4. Employee tax declarations

**What the code does now.** `declaredDeductions` is passed to the calculation
as a hardcoded `0`. The employee's declared regime **is** honoured, so the old
regime is worked out with its own slabs; only the employee's claims are
dropped.

**Why this is not a line to change.** There is no data model for a
declaration at all: no field on the employee, no repository method, no table.
The calculation is asked for an input the system cannot express. Setting the
constant to something else would be inventing a rule.

**The impact.** The liability does not move - the total deduction is the same
either way. What moves is the split between Net salary payable and Statutory
deductions payable: in the worked case, an old-regime employee with 3 lakh of
claims is over-deducted and over-remitted by 7 800 a month, because the claims
are not applied.

**The options.** Add a declaration to the employee - a yearly figure per
employee, with the regime it belongs to - and pass it through; or state in the
interface and the run that the tax is provisional because no declarations are
recorded; or keep the old regime out of scope until declarations exist, so that
no tax is computed from a regime whose inputs are missing.

**Recommendation.** The second, as the immediate step, and the first as the
proper fix. A warning that says "the tax is provisional" is better than a
number that looks final and is wrong.

### 5. Which date the statutory rules are chosen by

**What the code does now.** Every rule set is chosen by `paymentDate`. The
policy says the rule used is the one in force **on the date of payment** for
salary tax deducted at source, and **on the last day of the period** for the
contributions. `periodStart` and `periodEnd` are carried on the run and never
read.

**The impact.** When the two dates fall in different months, or a rule version
changes between them, the contributions are worked out on the wrong rule. The
worked case is 1 200 per employee per month.

**Recommendation.** Use the last day of the period for the contribution rule
sets and the payment date for salary tax, exactly as the policy says. The
dates are already on the run; they only have to be passed to the right place.

### 6. The part-month split for a wage ceiling

**What the code does now.** The evidence register describes a wage ceiling that
changes part-way through a month being applied on each side of the change, with
the employer's share split 3.67% / 8.33% on each part. The code does not
implement it.

**Recommendation.** Implement it, or say in the policy that the ceiling is
applied whole. The register is the source of truth, and a register that
describes a rule the code does not follow is worse than one that admits the
rule is not implemented.

---

## Findings that are known, and are not fixed here

These were found by reading and by running the code. Each is a real defect.
None is fixed in this change, because each is either a decision (above) or a
change to the persistence layer that deserves its own review.

| # | Where | What happens |
|---|---|---|
| P1 | `src-tauri/src/commands.rs` | The run header and its snapshots are written in **two** transactions. A failure between them leaves a `calculated` run with no snapshots, and the interface shows it as a draft because the state is derived from the snapshots. The contract says the run and its snapshots are saved together. |
| P2 | `src-tauri/src/commands.rs` | Recalculating a run upserts the snapshots but never removes the ones for employees who are no longer in it, so the run's employee count and its stored snapshots disagree, and the journal is built from the stored snapshots. The demo implementation replaces the set wholesale, so the two do not agree. |
| P3 | `src/repositories/demo/demoRepository.ts` | The demo implementation of posting a run enforces none of the three guards the Rust path enforces: no state check, no posted-once check, no voucher-claimed check, and it overwrites an existing voucher. The same button gives two different outcomes. |
| P4 | `src-tauri/src/commands.rs` | A **posted** run can be re-saved as a draft, and a draft run can be deleted, which removes the run and its snapshots while the posted journal and its salary debit stay in the ledger. The lifecycle transitions are not validated at the persistence boundary. |
| P5 | `src-tauri/src/migrations.rs` | `payroll_run_snapshots.employee_id` and `payroll_payments.employee_id` have no foreign key to the employees table, unlike the attendance table, and `payroll_payments` has no unique constraint on `(company_id, run_id, employee_id)`, so a duplicate payment row would double the paid total. |
| P6 | `src-tauri/src/commands.rs` | A run with no snapshots can be posted; only the interface refuses. The run number is allocated in a separate, racy call, so two concurrent raises can collide on it. |
| P7 | `src/domain/payroll.ts` | The state insurance daily wage divides already-prorated wages by the whole month, so an employee who is paid for half the month can fall below the exemption and escape the contribution entirely. |
| P8 | `src/domain/payroll.ts` | The percentage of a component truncates rather than rounds, where every other computed amount is rounded half away from zero. |
| P9 | `src/domain/types.ts` | The snapshot records the figures but not the attendance they came from, so a payslip cannot show the payable days or the days lost without pay. The policy says the snapshot holds every input, and the attendance is an input. |
| P10 | `src/views/payroll/` | Three guards live only in the interface: the blocking-rule check, the payroll-accounts-mapped check and the must-have-snapshots check. Anything that calls the repository directly can pass all three. |

## The test that is missing

`src/views/payroll/payrollActions.ts` has **no test file at all**, and no test
anywhere imports it. That is why the two money-moving defects above survived
205 green tests: the assembly layer - the place a run is put together from
assignments, structures and attendance - is not covered by anything. A
`tests/payrollActions.spec.ts` over the repository contract, with a stub
repository, is the highest-value test still outstanding.
