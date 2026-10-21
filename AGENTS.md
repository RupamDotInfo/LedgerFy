# LedgerFy — working agreements

Offline-first desktop accounting and ERP for Indian businesses. One edition, no
commercial tiers, local data first.

- **Stack:** Tauri 2 (Rust shell) + Vue 3 `<script setup>` + TypeScript (strict)
  + Vite + Tailwind CSS v4 + Vue Router + Pinia.
- **Package manager:** npm. TypeScript is pinned to 5.9.x because `vue-tsc` needs
  the classic compiler API.
- **Money:** always an integer number of minor units (paise). Never a float.
- **Icons:** Material Symbols Outlined, bundled locally. Use
  `<MaterialIcon name="receipt_long" :size="18" />` — never emoji, never an
  inline SVG, and never a second icon library.

## Commands

```bash
npm run dev          # Vite dev server on http://127.0.0.1:5191
npm run type-check   # vue-tsc, must pass
npm run lint         # ESLint, must pass
npm run test         # Vitest
npm run build        # type-check + production build
npm run tauri:dev    # desktop shell (requires Rust + WebView2)
npm run tauri:build  # packaged desktop build
```

## Architecture

```
src/
  domain/        accounting rules — pure functions, no framework imports
  repositories/  typed data-access contracts + the two implementations
  stores/        Pinia session and UI state
  components/    ui/ (design system), layout/, charts/
  views/         one folder per area, one screen per route
  lib/           money, datetime, number-to-words helpers
  app/           navigation model and label helpers
  styles/        design tokens
src-tauri/
  src/migrations.rs  ordered schema migrations, applied transactionally
  src/entities.rs    typed records that cross the IPC boundary
  src/db.rs          connection, durability settings, the workspace state
  src/commands.rs    the atomic write path
  src/backup.rs      verified snapshots and safe restore
```

Rules that are not negotiable:

1. **Components never compute authoritative balances.** Totals, balances,
   trial balance, tax, and outstanding allocation live in
   `src/domain/accounting.ts` or come from the repository. If a screen needs a
   figure, ask the repository or the domain service for it.
2. **The UI talks to `LedgerFyRepository`**, never to fixtures directly. Read
   masters through `useSessionStore()`; read records through
   `session.repository`.
3. **Never fake a result.** A prepared return is not a filed return. A written
   file is not a verified backup. A demo record must be labelled as demo.
4. **Every screen resolves to a real route.** No dead menu items, no
   placeholder pages, no inert buttons.
5. **Errors are visible and specific.** Use `useToastStore()` for feedback and
   inline field errors for validation. Never use `alert()`.

## Persistence

The desktop shell owns a local SQLite database. The Vue layer never speaks
SQL — it calls typed Tauri commands, and the Rust layer owns the transaction.

- **Where the data lives:** the operating system's per-application *local*
  data directory, resolved through Tauri's path API. Never the current working
  directory, and never a path the user has to configure.
- **Durability:** foreign keys on, write-ahead logging, a busy timeout, and full
  synchronisation, so a committed financial record survives a power loss.
- **Atomicity:** a voucher header, its entries, its item and tax lines, its
  bill-wise allocations and its audit event are written in one transaction. A
  rejected write leaves nothing behind.
- **Drafts and posts are different operations.** `saveVoucher` stores a draft
  that allocates nothing and appears in no report. `postVoucher` writes the
  financial effect. Never post by setting a status on a saved draft.
- **Company isolation:** every child table carries a company column and
  references its parent with a composite foreign key, so a record cannot be
  attached to a company it does not belong to. The database refuses it even if
  the interface does not.
- **Migrations:** versioned, ordered, and applied inside a transaction. A
  released migration is never edited — a checksum detects that, and a schema
  from a newer build is refused rather than half-read.
- **Allocation records** are written by the domain and stored, so the effect of
  a payment on an invoice survives a restart and can be audited.
- **An order is not a voucher.** It has its own tables, its own state, and it
  never reaches the general ledger. The deliveries against it are written in
  the same transaction as the invoice that makes them, and the state the
  application shows is derived from those deliveries rather than stored.
- **Manufacturing costs sit in work in progress.** A material issue is not a
  debit to cost of goods sold: the cost goes to the work in progress account
  and reaches the inventory asset only when the finished goods are received.
- **The stock movement ledger** is the history of the stock. Every receipt,
  issue, return, transfer and count variance is one immutable row with the
  costing result and the balance that followed it. The balance projection is
  derived from it and can be rebuilt from it at any time; a rebuild never
  overwrites the stored projection and never posts a financial entry.
- **Stock postings are one transaction.** The voucher, its entries, its stock
  movements, its pool and location balances and its audit event commit
  together or not at all. The pool carries a revision, so a posting built on
  a stale balance is refused rather than applied.
- **Money:** integer minor units, bounded by the safe integer range so a
  JavaScript number can carry it unchanged across the IPC boundary. Anything
  outside that range is rejected, not rounded.
- **Quantities:** integer milli-units, on the same terms. A quantity is never
  a binary floating-point value, and `Unit.decimalPlaces` never reaches an
  arithmetic expression.
- **No second accounting engine.** The domain layer computes the entries, the
  tax split and the allocation; Rust stores and retrieves them.
- **Backups** are SQLite snapshots taken with `VACUUM INTO`, so they include
  everything held in the write-ahead log. Each one is reopened and checked
  before it is reported as a backup, and a restore keeps a copy of the current
  database.

### Sample data

The sample workspace lives in the same database as real books, as its own
company flagged `isDemo`. It is never mixed into a real company's records, and
a real company's books are never overwritten by sample data. A browser
preview has no database at all and says so on every screen.

If the local database cannot be opened, the application reports the failure
with the path it tried. It never falls back to sample data and presents it as
a working company.

## Design system

The visual language is Material 3 derived, defined in `src/styles/main.css`
(`@theme`). Use the tokens — never invent hex values in a component.

### Colour

| Role | Token | Typical use |
| --- | --- | --- |
| Brand | `primary` `#2248d1` | main actions, active nav, links |
| Brand container | `primary-container` `#4263eb` | filled secondary actions |
| Brand tint | `primary-fixed` `#dde1ff` | selected rows, soft highlights |
| Positive | `secondary` `#006c47`, `secondary-container` `#90f4c0` | success, income |
| Warning / debit | `tertiary` `#a52536`, `tertiary-fixed` `#ffdada` | warnings, overdue |
| Error | `error` `#ba1a1a`, `error-container` `#ffdad6` | validation, destructive |
| Page | `surface` `#f9f9ff` | app background |
| Card | `surface-container-lowest` `#ffffff` | cards, tables, panels |
| Inset | `surface-container-low` `#f1f3ff` | table headers, inset strips |
| Raised inset | `surface-container` / `-high` / `-highest` | headers, chips |
| Text | `on-surface` `#121b2e`, `on-surface-variant` `#444654`, `outline` `#747686` | hierarchy |
| Divider | `outline-variant` `#c4c5d7`, `surface-container` | borders |
| Inverse | `inverse-surface` `#273044` on `inverse-on-surface` | grand total block |

Classes follow the token name: `bg-primary`, `text-on-surface-variant`,
`border-surface-container`.

### Type

| Class | Size | Use |
| --- | --- | --- |
| `text-label-xs` | 11px / 700 / tracked | column headers, uppercase labels |
| `text-label-sm` | 12px / 600 | field labels, chips, button text |
| `text-label-md` | 13px / 600 | toolbars, nav items, table emphasis |
| `text-body-sm` | 13px | table cells, dense text |
| `text-body-md` | 14px | body copy, inputs |
| `text-body-lg` | 15px | longer prose |
| `text-numeric-sm` / `-md` / `-lg` | 13 / 14 / 20px | figures — always `tabular` |
| `text-headline-sm` / `-md` / `-lg` | 18 / 20 / 24px | card and page titles |

Use `section-label` for uppercase micro-labels. Use `kbd` for shortcut caps.

### Spacing, radius, elevation

- Spacing: `space-xs` 4px, `space-sm` 8px, `space-md` 12px, `space-lg` 16px,
  `space-xl` 24px, `gutter` 12px, `gutter-compact` 8px, `gutter-spacious` 16px.
- Radius: `rounded-xs` 2px, `rounded-sm` 4px (buttons, inputs),
  `rounded-md` 8px (cards, dropdowns), `rounded-lg` 12px, `rounded-full` circle.
- Elevation: `shadow-sm` cards, `shadow-md` hover, `shadow-lg` overlays.
- Cards: `rounded-md bg-surface-container-lowest p-space-md shadow-sm`.
- Inner strips: `rounded-sm bg-surface-container-low p-space-xs`.

### Component inventory (`@/components/ui/`)

| Component | Key props |
| --- | --- |
| `MaterialIcon` | `name` (ligature), `size`, `filled`, `label` |
| `BaseButton` | `variant` primary/tonal/neutral/outlined/text/danger/success, `size` xs/sm/md/lg, `icon`, `trailingIcon`, `loading`, `iconOnly`, `block` |
| `BaseInput` | `label`, `placeholder`, `error`, `hint`, `size`, `prefix`, `suffix`, `variant` filled/outlined |
| `BaseNumberInput` | money input, right aligned, `currency` |
| `BaseSelect` | `options: { value, label, disabled? }[]` |
| `BaseCombobox` | `options: ComboboxOption[]` (`id`, `label`, `sublabel?`, `meta?`), `allowCreate`, `create` event |
| `BaseCheckbox`, `BaseSwitch` | `label`, `description` |
| `BaseCard` | `title`, `description`, slots `actions`, `header`, `footer` |
| `BaseModal` | `open`, `title`, `description`, `size` sm/md/lg/xl, slot `footer` |
| `BaseDrawer` | `open`, `side`, `width` |
| `BaseDropdown` | `align`, `width`, slot `trigger` with `{ open }` |
| `BaseTabs`, `BaseSegmented` | `tabs` / `items`, `v-model` |
| `BaseBadge` | `tone` neutral/info/positive/warning/danger/primary/violet, `variant` soft/solid/outline, `icon`, `dot` |
| `BasePagination` | `page`, `pageSize`, `total`, `v-model:page`, `v-model:page-size` |
| `BaseEmptyState` | `title`, `description`, `icon` |
| `BaseSkeleton`, `BaseSpinner`, `BaseTooltip` | loading and hint states |
| `PageHeader` | `title`, `subtitle`, `breadcrumb`, `icon`, slot `actions` |
| `FilterBar` | filter row under the page header |
| `StatTile` | `label`, `value`, `delta`, `hint`, `icon`, `tone`, `clickable` |
| `DataTable` | `columns: TableColumn[]`, `rows`, `rowKey`, `cell:<key>` slots, `emptyTitle` |
| `ToastHost` | renders `useToastStore()` notifications |

## Screen conventions

A screen is a full-height column. The reference implementations are
`src/views/HomeView.vue` (dashboard) and `src/views/VoucherEntryView.vue`
(voucher entry) — read both before building a new screen.

```vue
<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader title="Cash and bank" subtitle="Balances held by each account" icon="account_balance_wallet">
      <template #actions>
        <BaseButton size="sm" variant="primary" icon="add">New</BaseButton>
      </template>
    </PageHeader>

    <FilterBar>
      <BaseInput v-model="search" placeholder="Search" size="sm" class="w-56" />
      <BaseSelect v-model="range" :options="ranges" size="sm" />
    </FilterBar>

    <div class="min-h-0 flex-1 overflow-auto p-space-lg">
      <!-- content -->
    </div>
  </div>
</template>
```

- Load data in `onMounted` and whenever the company or financial year changes.
  Show `BaseSkeleton` while loading and `BaseEmptyState` when a search returns
  nothing.
- Every figure comes from the repository or the domain layer.
- Financial columns are right aligned and `tabular`.
- Status is never conveyed by colour alone — pair it with a label or icon.
- Inline table headers use `bg-surface-container-low text-label-xs uppercase
  tracking-wider text-outline`, and rows divide with `divide-surface-container-low`.

## Keyboard model

Voucher entry is keyboard-first. The bindings are documented in
`src/components/layout/ShortcutHelpDialog.vue` and enforced in
`src/layouts/AppShell.vue`.

| Key | Action |
| --- | --- |
| F3 | Day book / voucher register |
| F4 | Contra voucher |
| F5 | Payment voucher |
| F6 | Receipt voucher |
| F7 | Journal voucher |
| F8 | Sales voucher |
| F9 | Purchase voucher |
| Alt+F8 / Alt+F9 | Credit note / Debit note |
| Ctrl+K | Command palette |
| F1 | Shortcut reference |
| Enter / Esc | Next field / close list |

## Domain reference

`src/domain/types.ts` — `Company`, `Ledger`, `Item`, `Voucher`, `VoucherEntry`,
`VoucherItemLine`, `VoucherTaxLine`, `TaxCategory`, `Godown`, `CostCentre`,
`Employee`, `Currency`, `StatementLine`, `AuditEvent`.

`src/domain/accounting.ts` — `buildVoucher`, `validateVoucher`, `computeTax`,
`computeLineTax`, `ledgerClosingBalance`, `trialBalance`, `profitAndLoss`,
`balanceSheet`, `cashPosition`, `allocateOutstanding`, `totalDebit`,
`totalCredit`, `isBalanced`.

`src/domain/allocations.ts` — **the authority for bill-wise allocation.**
`buildAllocationLedger` applies the oldest-first rule and produces the
`AllocationRecord` rows that are persisted, so the effect of a payment can be
reconstructed and audited rather than re-derived on every read. A credit note
reduces what a customer owes; a payment with no invoice is an advance; a sale
settled directly against a cash or bank account is not a receivable and takes
no part in the allocation.

`src/domain/posting.ts` — `preparePosting` and `prepareCancellation` turn a
voucher into the complete set of records it implies, so Rust can commit them
all in one transaction or none of them.

`src/domain/dashboard.ts` — `buildDashboardSnapshot`, the one implementation of
the dashboard, shared by every repository.

`src/domain/quantity.ts` — **the authority for quantity arithmetic.** A
quantity is an integer number of milli-units, never a float. `divideRounded`
does exact `BigInt` division with half away from zero, `issueCost` values an
issue against a pool and gives the whole remaining carrying value to a full
depletion so no residue is stranded, and `averageCost` reports the minor-unit
cost of one unit. `Unit.decimalPlaces` is for display only and never for
arithmetic.

`src/domain/inventory.ts` — **the only authority for inventory cost.** One
costing method is offered: perpetual moving weighted average over a shared
company-and-item pool. `planInventoryPosting` turns a voucher into the
movements, the pool and location balances, and the general-ledger entries it
implies; `replayMovements` and `reconcileBalances` rebuild and check the
balance projection from the movement ledger. Rust stores what this produces
and never re-derives a weighted average.

Three invariants hold for every posting and are enforced by the domain and
checked by `tests/inventoryInvariants.spec.ts` and `tests/demoInventory.spec.ts`,
not assumed:

1. Every planned voucher balances.
2. The inventory asset in the general ledger and the carrying value of the
   stock pools move together. The opening cutover is the one thing that can
   leave a difference, and that difference is reported rather than absorbed.
3. A sale and the sales return that reverses it unwind revenue and cost of
   goods sold exactly.

The costing policy is written down in `docs/inventory-accounting-policy.md`.
That document is the specification; when the code and the document disagree,
the document is corrected or the code is — never the other way round.

`src/domain/orders.ts` — **the authority for orders and what fulfils them.**
An order is a promise, not a transaction, so it is not a voucher. Only the
header state is stored; the fulfilment state is **derived** from the
fulfilment rows, so a stored copy can never drift from the invoices that
caused it. `prepareOrderFulfilments` produces the delivery records a posted
invoice creates, and they are written in the same transaction as the invoice.

`src/domain/production.ts` — **the authority for bills of materials and
manufacturing.** A released structure is immutable and a production order
snapshots it, so a later revision cannot change work already under way.
`planProductionIssue` and `planProductionCompletion` cost the materials and
the finished goods through the inventory engine — there is no second valuation
formula for manufacturing — and the cost sits in the work in progress account
until the finished goods are received.

The order and manufacturing rules are written down in
`docs/order-and-manufacturing-policy.md`, and they are the specification.

`src/repositories/contracts.ts` — `LedgerFyRepository` with `listVouchers`,
`saveVoucher`, `postVoucher`, `listAllocations`, `listAdvances`,
`listStatementLines`, `reconcileStatementLine`, `getDashboard`, the master
listings, the inventory methods: `listStockMovements`, `listStockPools`,
`listStockBalances`, `getInventoryAccounts`, `saveInventoryAccounts` and
`rebuildStockBalances`, and the order and manufacturing methods:
`listOrders`, `getOrder`, `saveOrder`, `confirmOrder`, `cancelOrder`,
`amendOrder`, `nextOrderNumber`, `listBoms`, `getBom`, `saveBom`,
`releaseBom`, `listProductionOrders`, `getProductionOrder`,
`saveProductionOrder`, `releaseProductionOrder`, `postProductionIssue` and
`postProductionCompletion`.

`src/repositories/sqlite/sqliteRepository.ts` — the local database
implementation. `src/repositories/demo/demoRepository.ts` — the in-memory sample
workspace. `src/repositories/demo/fixtures.ts` — deterministic demo books. All
names and numbers are fictional. The demo workspace is generated **through the
inventory engine**, so its movements are the ones the engine produced and not
hand-written ones.
