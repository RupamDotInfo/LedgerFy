# LedgerFy

**Offline-first desktop accounting and ERP for Indian businesses.**

LedgerFy is a single-edition desktop application for recording business books:
double-entry vouchers, ledgers and parties, stock, GST-ready tax computation,
banking, financial reports, payroll and statutory workflows. Everything the
accountant needs to work offline works offline. Only operations that genuinely
require a government portal or a bank explicitly say so.

This repository holds a complete, navigable, keyboard-driven desktop
application. The accounting domain is implemented as pure functions, and the
interface talks to a repository rather than to storage: the local SQLite
database when the application runs in the desktop shell, and a deterministic
sample workspace when it runs in a browser. The sample books are produced
through the same domain service the interface uses, so they are held to the
same rules as real ones.

> **Licence.** This repository is published for inspection. No licence has been
> chosen yet, so no general permission to use, copy or redistribute it has been
> granted. The options under consideration and the reasoning are in
> [docs/licensing-decision.md](docs/licensing-decision.md).

---

## Running it

```bash
npm install
npm run dev          # browser: http://127.0.0.1:5191
npm run tauri:dev    # desktop shell (needs Rust toolchain + WebView2)
```

Quality gates:

```bash
npm run type-check   # vue-tsc, must pass
npm run lint         # ESLint, must pass
npm run test         # Vitest
npm run build        # type-check + production bundle
npm run tauri:build  # packaged Windows installer
cd src-tauri && cargo test   # the persistence layer
```

Requirements: Node 22.12 or newer (what Vite 8 and Vitest 5 require), Rust
1.77+, and the Microsoft Edge WebView2 runtime.

### Visual check

`scripts/visual-pass.mjs` drives the installed Chrome in headless mode and
captures every screen at 1366 × 768 and 1920 × 1080 into `artifacts/screens`,
reporting console errors and horizontal overflow per route. It shows no window
on the desktop and never moves the cursor.

```bash
npm run dev
node scripts/visual-pass.mjs
```

It drives a Chrome or Edge install that is already on the machine, through
`puppeteer-core`. That is a dev dependency and deliberately downloads no
browser of its own.

---

## Where the books live

A local SQLite database, in the operating system's per-application *local*
data directory, resolved through Tauri's path API. On Windows that is
`%LOCALAPPDATA%\info.rupam.ledgerfy\ledgerfy.sqlite3`. Nothing depends on the
current working directory or on running the development server.

The connection runs with foreign keys enforced, write-ahead logging so a reader
is never blocked by a writer, a busy timeout so concurrent access waits instead
of failing, and full synchronisation, so a committed financial record survives
a power loss.

**A voucher is one transaction.** Its header, its double-entry lines, its item
and tax lines and its audit event are written together. A write that fails
half way leaves nothing behind — there is no state in which a voucher exists
without its entries.

**Company isolation is enforced by the database.** Every child table carries a
company column and references its parent with a composite foreign key, so a
ledger from one company cannot be posted to by a voucher belonging to another.
The database refuses it even if the interface does not.

**Migrations are versioned and ordered.** Each runs inside its own transaction,
so a failed migration leaves the database at the last version that applied
cleanly. A released migration is never edited: a checksum detects that, and a
schema written by a newer build is refused rather than half-read.

**Money is integer minor units** with a documented ceiling at the safe integer
range, so an amount crosses the JavaScript / Rust / JSON boundary unchanged.
Anything outside it is rejected rather than silently rounded.

**Backups are real.** They are SQLite snapshots taken with `VACUUM INTO`, so
they include everything held in the write-ahead log. Each one is reopened and
integrity-checked before it is reported as a backup, and a restore keeps a copy
of the current database before replacing it.

### Sample data

The sample workspace lives in the same database as real books, as its own
company flagged as sample data. It is never mixed into a real company's
records, and a real company's books are never overwritten by sample data. If
the database cannot be opened, the application says so with the path it tried —
it never quietly falls back to sample data and presents it as a working
company.

---

## What is genuinely working today

**Voucher entry** — the highest-traffic screen. Sales, purchase, receipt,
payment, contra, journal, credit note, debit note and order vouchers share one
consistent interaction framework with type-specific layouts. The voucher type
dock, the live tax breakup and the double-entry preview are all driven by the
domain layer, so what you see before posting is exactly what gets posted.
Every voucher is validated (balanced entries, party present, period open,
unique number) before it can be posted.

**Financial reporting** — balance sheet, profit and loss, trial balance,
receivables and payables ageing, and a GST summary. All figures come from
`src/domain/accounting.ts`; a report never re-implements an accounting rule.
Every report drills down to the vouchers behind it, exports to CSV, and prints.

**Working capital and dashboard** — cash and bank positions, receivables and
payables with ageing, a period trend chart, the live voucher log, GST
readiness, critical-stock alerts and bank reconciliation progress. Every
number drills down.

**Banking and reconciliation** — bank and cash ledgers with running balances,
a reconciliation screen that explains *why* each suggested match was made and
never reconciles silently, and a CSV statement import wizard with column
mapping and per-row validation.

**Inventory** — a perpetual moving weighted-average costing engine over a
shared company-and-item pool, with exact integer quantities throughout. Every
receipt, issue, sales return, purchase return, transfer and count variance
writes one immutable movement row carrying the costing result and the balance
that followed it, in the same transaction as the financial entries. Stock
balances are derived from that ledger and can be rebuilt from it at any time.
The screens cover the stock summary, the movement register, the valuation
report and the per-item stock ledger, with reorder-level alerts. The costing
policy is written down in `docs/inventory-accounting-policy.md`.

**Orders** — a sales order and a purchase order are records of their own, not
vouchers, so they never touch the general ledger. An order is written,
confirmed, amended with a recorded reason, partly delivered and closed. The
deliveries are written in the same transaction as the invoice that makes them,
and the state the application shows is derived from those deliveries rather
than stored, so a displayed state can never disagree with the invoices behind
it. An invoice is raised from an order and carries the ordered items,
quantities, rates and tax treatment across.

**Manufacturing** — a bill of materials says what a finished item is made of.
A released structure is immutable, and a production order snapshots the
structure it uses, so a later revision cannot change work already under way.
Materials are issued from stock at the moving average, and the cost sits in
the work in progress account until the finished goods are received — a
material issue is never a debit to cost of goods sold. The rules are written
down in `docs/order-and-manufacturing-policy.md`.

**Masters** — chart of accounts, customers and suppliers, items and services,
tax categories, godowns, cost centres, currencies, price lists and payment
terms, each with search, inline creation and dependency-aware deletion
(deactivation rather than deletion when history exists).

**Data tools** — backup and restore, import and export, a migration wizard
with Tally XML recognition, and an integrity checker that really runs the
checks and reports failures by name.

**Desktop shell** — a Tauri 2 shell that owns native capability only: the
on-disk workspace location, backup create/list/verify/restore/delete, native
save and open dialogs.

---

## Feature readiness register

Honest status for every area. Nothing is claimed as working when it is not.

### Fully implemented and connected to the books

| Area | Status |
| --- | --- |
| Double-entry vouchers, all types | Working |
| Ledger balances, trial balance, balance sheet, profit and loss | Working |
| Receivables and payables allocation and ageing | Working |
| GST computation with intra-state CGST + SGST pairing | Working |
| Tax category master with separate output and input ledgers | Working |
| Bank reconciliation with explained suggestions | Working |
| Perpetual moving weighted-average stock valuation | Working |
| Durable stock movement ledger, rebuildable from itself | Working |
| Stock posting inside the voucher transaction, with a stale-plan refusal | Working |
| Bill-wise allocation persisted and auditable | Working |
| Financial-year boundaries and period locking checks | Working |
| Audit trail of posting and editing | Working |
| CSV import and export, print preview | Working |
| Local SQLite database with ordered, transactional migrations | Working |
| Atomic multi-record writes, enforced company isolation | Working |
| Verified database backups and safe restore | Working |
| Ledgers, items, tax categories, godowns, cost centres, currencies | Working |
| Inventory activation with an explicit, audited cutover | Working |
| Sales orders and purchase orders with persisted state and delivery history | Working |
| An invoice raised from an order, delivering against it in the same transaction | Working |
| Bills of materials with released, immutable versions and a cycle check | Working |
| Production orders with snapshotted requirements, material issue and completion | Working |
| Manufacturing cost held in work in progress until the goods are received | Working |

### Implemented in the interface, still needs work

These screens are complete and honest about the gap.

- Company profile and financial periods can be created, but editing an
  existing company's details and changing the voucher numbering scheme need
  their own write paths.
- Stock groups, units, price lists and payment terms can be stored, but their screens are still read-only.
- Users, roles and permissions (single-user local mode).
- Only **moving weighted average** costing is offered. FIFO, serial or batch
  tracking, standard costing, landed-cost allocation across stock, a separate
  goods-receipt document and a net-realisable-value review or write-down are
  not implemented, and the application does not claim they are.

### Requires connectivity or an authorised credential

The interface is built and the state is labelled; the operation itself cannot
complete without an external service.

| Capability | Why it cannot complete offline |
| --- | --- |
| GSTR-1 and GSTR-3B filing | Needs the GST portal. The app prepares the data locally and exports it; it never shows a filing status it did not receive. |
| E-invoice IRN and signed QR code | Issued by the IRP. No IRN or QR is ever displayed because none has been issued. |
| E-way bill generation | Issued by the portal. The app identifies qualifying invoices only. |
| Live bank connectivity | Not configured. Reconciliation works on imported statements. |
| TDS/TCS remittance | Needs a government channel and per-section rates that are not implemented. |

### Not yet built

- Foreign currency transactions, realised and unrealised exchange differences.
- Multi-currency revaluation.
- Batch, serial and expiry tracking.
- By-products and scrap; a production order produces one finished item.
- Job work and subcontracting: a component is bought and consumed, not sent
  to a job worker and costed there.
- Labour and overhead allocation, work centres and machine-capacity planning.
- Multi-level bill-of-materials explosion: a structure names its components,
  and a production order consumes one level.
- Partial completion of a production order. It completes in one operation for
  its whole planned output, because transferring part of an order needs an
  assumption about how the materials were consumed.
- Payroll processing, statutory contributions and payslips.
- POS billing, extensions and a public API.
- LAN multi-user and synchronisation.
- Encryption of the local database and per-company master passwords.

Statutory thresholds, rates and return schemas change. The values shown in the
interface are configurable and labelled; confirm them against the current
notification before filing.

---

## Keyboard model

Built for accountants who already live in function keys.

| Key | Action |
| --- | --- |
| F2 | Voucher date |
| F3 | Voucher register / day book |
| F4 | Contra voucher |
| F5 | Payment voucher |
| F6 | Receipt voucher |
| F7 | Journal voucher |
| F8 | Sales voucher |
| F9 | Purchase voucher |
| Alt + F8 / Alt + F9 | Credit note / debit note |
| Enter / Esc | Next field / close a list |
| Ctrl + S | Save as draft |
| Ctrl + Enter | Post the voucher |
| Alt + P | Print and preview |
| Alt + C | Create the party inline |
| Ctrl + K | Command palette |
| F1 | Shortcut reference |

---

## Architecture

```
src/
  domain/        accounting rules — pure functions, no framework imports
  repositories/  typed data-access contracts + the SQLite and sample implementations
  stores/        Pinia session and UI state
  components/    ui/ design system, layout/ shell, charts/
  features/      voucher entry pieces and its draft model
  views/         one screen per route, grouped by area
  lib/           money, datetime, number-to-words helpers
  app/           navigation model and label helpers
src-tauri/       Rust shell: native paths, backups, file dialogs
Design/          the desktop design reference the interface is built from
```

Money is always an integer number of minor units. The frontend never
re-implements an accounting rule; `src/domain/accounting.ts` is the single
authority for balances, tax and allocation, and the repository is the only
thing that talks to storage.

The demo repository (`src/repositories/demo/`) is deterministic: the same
books on every machine, generated through the same domain service the UI uses,
which is why the demo trial balance nets to zero and every demo voucher
balances. All names, numbers and tax identifiers in the fixtures are
fictional.

---

## Tests

```bash
npm run test          # 171 tests
cd src-tauri && cargo test   # 75 tests
```

The TypeScript tests cover exact money arithmetic, exact quantity arithmetic,
number-to-words, voucher construction and balancing, validation rules, tax
computation and rounding, ledger reconciliation, trial balance, balance sheet
consistency, outstanding allocation, the demo repository's behaviour and
company isolation, and the combobox's keyboard interaction.

The integrity of the demo books is asserted, not assumed: every voucher
balances, every company's trial balance nets to zero, every company's balance
sheet reconciles with its profit and loss, and open invoices never exceed the
balance the party ledger actually carries.

The inventory engine has its own invariant suite. Every planned voucher
balances, the inventory asset and the stock pools move together, a sale and
the sales return that reverses it unwind revenue and cost exactly, a purchase
return keeps the invoice amount and the carrying value apart, a count variance
goes to the variance account rather than to cost of goods sold, and cancelling
a posted voucher gives the stock back with a compensating movement.

The order and manufacturing rules have theirs. An order's state is derived
from its deliveries and never stored, a delivery can never exceed the order it
belongs to, a cancellation is refused when something has been delivered, an
amendment needs a reason and keeps the previous lines, a released structure is
immutable, a structure whose components would make themselves is refused, and
the cost transferred to the finished goods is exactly the cost of the
materials issued. The generated sample books are held to the same rules, and
the sample workspace is checked for references the database would refuse.

The Rust tests drive the same functions the Tauri commands call against a real
SQLite database: a posting writes its voucher, entries, movements, pools and
balances together or not at all, a failure part way through leaves nothing
behind, a movement that names another company's item is refused, a stale plan
is refused, a backdated movement is refused, the stock survives closing and
reopening the database, and replaying the movement ledger reproduces the
stored balances.

---

## Next milestone

Workstream C of Milestone 5 is complete: orders are real records with
persisted state and delivery history, and manufacturing produces a traceable
finished good whose cost is reconciled to the inventory and the general
ledger.

**Workstream D — payroll.** Employee masters already exist; what is missing
is the payroll run: the attendance and the earnings, the statutory
contributions, the payslip and the journal that posts the month's cost. That
is a milestone of its own, and it should not be started before the costing of
manufacturing has been in use long enough to be trusted.

The limitations that stand between LedgerFy and a full manufacturing suite are
listed in `docs/order-and-manufacturing-policy.md` §6 and are not hidden: no
by-products, no job work, no labour or overhead allocation, no multi-level
explosion and no partial completion.
