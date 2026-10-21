# Order and manufacturing policy

**Status:** implemented and tested
**Applies to:** Milestone 5C — sales orders, purchase orders, bills of
materials and discrete manufacturing
**Companion document:** `docs/inventory-accounting-policy.md`, which governs
the costing of every stock movement. This document does not restate it; it
adds the order and manufacturing rules on top of it.

---

## 1. Why an order is not a voucher

An order is a promise, not a transaction. It has no financial effect until it
is fulfilled, and it has a life of its own: it is confirmed, amended,
partially fulfilled and closed. A voucher cannot carry that, so an order is
its own record.

The consequence is that **an order never appears in the general ledger**. It
is not an invoice, it is not a receivable, and it is not an outstanding
commitment until it has been confirmed. This is deliberate: the accounting
rules of this application recognise only `sales` and `purchase` as invoices,
and an order is neither.

The tables are:

| Table | Holds |
| --- | --- |
| `orders` | the order header: the party, the dates, the state |
| `order_lines` | the ordered items, quantities, rates and discounts |
| `order_revisions` | the history: what the order said at each revision |
| `order_fulfilments` | what has been delivered against each line, and by which voucher |

The fulfilment rows are the link. They are written **in the same transaction**
as the invoice or purchase voucher that fulfils them, so a voucher can never
exist without its fulfilment record, and a fulfilment record can never exist
without its voucher.

---

## 2. The order lifecycle

### 2.1 The states

| State | What it means | What is persisted |
| --- | --- | --- |
| `draft` | being written; nothing is promised | the header and its lines |
| `open` | confirmed with the party; the quantities are committed | the header, its lines, the confirmation |
| `partially-fulfilled` | some of the quantity has been delivered | the above, plus fulfilment rows |
| `fulfilled` | every line has been delivered in full | the above |
| `cancelled` | withdrawn | the above, plus the cancellation |

### 2.2 Which states are stored and which are derived

Only the **header** state is stored: `draft`, `confirmed` or `cancelled`.
The fulfilment state is **derived** from the fulfilment rows, every time it is
asked for:

```
cancelled                        → cancelled
no fulfilment rows                → open        (confirmed)
some fulfilment, not all of it    → partially-fulfilled
every line fulfilled in full      → fulfilled
```

A stored status that could drift from the fulfilment rows is a defect waiting
to happen, so there is no stored "partially fulfilled" flag. The screen shows
the derived state, and the derived state is the only state the application
will ever show.

### 2.3 The transitions

| From | To | How |
| --- | --- | --- |
| `draft` | `open` | confirm |
| `draft` | `cancelled` | cancel |
| `open` | `cancelled` | cancel, when nothing has been fulfilled |
| `open` | `partially-fulfilled` | a linked invoice or purchase voucher is posted |
| `partially-fulfilled` | `fulfilled` | a linked invoice or purchase voucher is posted |
| `open` | `open` | amend, with a reason |

A cancellation is refused when any line has already been fulfilled. The
invoice is not silently deleted; the invoice is cancelled or credited first,
and then the order may be cancelled. The refusal says so.

### 2.4 Amendments

An amendment changes the ordered quantity, rate or discount of a line. It may
only be made to a confirmed order, it requires a reason, and it may not reduce
a line below the quantity already fulfilled.

Every amendment is recorded in `order_revisions`: the revision number, the
reason, who made it, when, and a snapshot of the lines as they stood before
the change. The previous quantities are therefore not deleted, and the order
history can be read back.

### 2.5 Partial fulfilment

A fulfilment row records the quantity and the amount delivered against one
order line, and the voucher line that delivered it. The remaining quantity of
a line is `ordered − fulfilled`, derived from the rows.

A voucher line may not fulfil more than the remaining quantity of its order
line. The check happens in the domain, before anything is written, and the
posting is refused with the excess named.

A voucher line may fulfil **at most one** order line, and a fulfilment row
may not be written twice for the same voucher line. Both are enforced by a
unique index in the database, so a repeated submission cannot duplicate a
delivery even if the domain were asked twice.

---

## 3. From an order to an invoice

The conversion is prepared by the domain, not by the screen:

- The order's party, the ordered items, the quantities that remain, the
  rates, the discounts and the tax category are carried into a **voucher
  draft** of the matching kind — a sales invoice for a sales order, a purchase
  voucher for a purchase order.
- The draft is editable. The user may change the quantities or the dates, and
  may add lines. What the user may not do is deliver more than the order
  remains: the check is applied again when the voucher is posted.
- When the voucher is posted, each of its lines carries the order line it
  fulfils, and the fulfilment rows are written **in the same transaction** as
  the voucher's entries, its tax lines, its stock movements, its audit event
  and its allocations.

The invoice therefore references the order, and the order references the
invoice. Both directions are persisted; neither is inferred by matching text.

---

## 4. Bills of materials

### 4.1 The structure

A bill of materials says what a finished item is made of.

| Field | Meaning |
| --- | --- |
| the finished item | the item the BOM produces |
| the version | the revision of the structure |
| the output quantity | how many units of the finished item the structure makes |
| the components | the items consumed, with the quantity of each |

A component line carries the quantity required **per the output quantity**,
and a conversion factor that expresses the component's quantity in units of
its own stock unit. The default factor is one, which is the common case: a
bracket needs two bolts.

The application has no unit conversion table. A requirement is therefore
always a whole number of milli-units of the component's own stock unit, and a
BOM that mixes units states the ratio explicitly. Nothing is converted
implicitly.

### 4.2 Versioning

A released BOM is **immutable**. Changing it means releasing a new version,
which supersedes the previous one. A BOM in draft can be edited freely; once
released, its structure is frozen.

A production order does not read the BOM when it is completed. It takes a
**snapshot** of the BOM lines when it is released, and the snapshot is what
the requirements are computed from. A later revision of the BOM therefore
cannot change a production order that is already under way.

### 4.3 Validation

A BOM is refused when:

- it has no components;
- a component is the finished item itself;
- the components form a **cycle** — item A needs B and B needs A, directly or
  through other items. The cycle is named in the message.

The cycle check walks the component graph of the company's released BOMs. It
is a domain rule, not a database constraint, and it is checked whenever a BOM
is saved or released.

---

## 5. Production

### 5.1 The production order

A production order says: make this many of this item, from this BOM.

| Field | Meaning |
| --- | --- |
| the finished item | what is being made |
| the BOM and its version | the structure that was snapshotted |
| the planned quantity | how many units are to be made |
| the requirements | the components, snapshotted, with what has been issued |

The states follow the same pattern as the orders. The header stores `draft`,
`released` or `cancelled`; the rest is derived from the issue and completion
records:

```
cancelled                     → cancelled
released, nothing issued      → released
released, some issued         → in-production
released, completed           → completed
```

A production order is refused when the company has no inventory activated,
because its whole purpose is to move stock.

### 5.2 The material issue

Issuing materials consumes the components from their godown at their
**current moving weighted-average cost**, exactly as any other issue does.
The costing is the one in `docs/inventory-accounting-policy.md`; there is no
second valuation formula for manufacturing.

The issue is one operation, and it commits in one transaction:

- a stock journal voucher carrying the component lines;
- the accounting entries;
- the stock movements, and the pool and location balances that follow them;
- the production issue rows, which link each component line to the
  requirement it satisfies;
- the audit event.

Partial issue is supported. The components may be issued in batches, and each
batch is costed at the average of the day it is issued.

### 5.3 The completion

Completing a production order brings the finished goods into stock. The
finished goods are valued at the **production cost**, and the production cost
is the cost of the components actually issued against the order.

The accounting entries are:

| On the issue | | On the completion | |
| --- | --- | --- | --- |
| Work in progress | Debit | Inventory asset | Debit |
| Inventory asset | Credit | Work in progress | Credit |

A material issue is therefore **not** a debit to cost of goods sold. The cost
of the goods sits in work in progress until they are finished, and only then
does it reach the inventory asset. The finished goods carry the cost of the
materials that made them.

The work in progress account is configured per company, alongside the
inventory, cost of goods sold, variance and purchases accounts. A company
that has not chosen one cannot post production, and the refusal says which
setting is missing. No ledger identifier is ever invented.

### 5.4 The cost transfer rule

**A production order completes in one operation, for its whole planned
output.** The cost transferred is the entire accumulated issue cost of the
order.

Partial completion is **not** supported in this milestone, and the reason is
stated rather than hidden. Transferring part of an order needs an assumption
about how the materials were consumed, and any such assumption would put a
figure in the finished-goods balance that the books cannot support. The
alternative — refusing a partial completion and saying so — keeps the work in
progress balance equal to the cost of the materials that have actually been
issued and consumed.

Partial **issue** is supported, because it needs no assumption: the materials
that have been issued are the materials that have been issued.

### 5.5 The completion checks

A completion is refused when:

- the issued quantity of a component is **less** than the requirement. The
  cost basis is incomplete, and the finished goods would be under-valued.
- the issued quantity of a component is **more** than the requirement. The
  excess is a discrepancy that needs an explicit adjustment; the application
  will not quietly absorb it into the finished-goods cost, and it will not
  quietly raise the BOM to match.

Both refusals name the component and the quantities.

### 5.6 The reconciliation

Two balances must hold, and both are checked:

1. **The inventory asset equals the value of the stock on hand.** This is the
   invariant the inventory policy already states, and manufacturing does not
   change it.
2. **The work in progress balance equals the cost of the materials that have
   been issued and not yet transferred.** Every issue adds to it and every
   completion takes from it, and the balance is the sum of the open production
   orders' untransferred issue costs.

---

## 6. What is not implemented

These are stated here so that the application never claims them:

- **By-products and scrap.** A production order produces one finished item.
- **Job work and subcontracting.** A component is bought and consumed; it is
  not sent to a job worker and costed there.
- **Labour and overhead allocation.** The production cost is the material
  cost. No labour rate, no overhead absorption, no work centres. The
  "work centre" is not a concept this build has.
- **Multi-level BOM explosion.** A BOM names components. A component may have
  its own BOM, and the cycle check understands that, but a production order
  consumes one level: the components of the BOM it was released against.
- **Partial completion**, as set out in §5.4.
- **Batches, serial numbers and expiry.** The stock model has none of them.

---

## 7. The invariants

| # | Invariant | Checked by |
| --- | --- | --- |
| 1 | Every order line's fulfilled quantity never exceeds its ordered quantity | `tests/orders.spec.ts` |
| 2 | A fulfilment row exists only for a voucher line that exists | the database, and `tests/orders.spec.ts` |
| 3 | The same voucher line never fulfils the same order line twice | a unique index, and the Rust tests |
| 4 | An order's displayed state is always the derived state | `tests/orders.spec.ts` |
| 5 | A cancellation is refused when a line has been fulfilled | `tests/orders.spec.ts` |
| 6 | A released BOM is immutable | `tests/production.spec.ts` |
| 7 | A BOM with a cycle in its components is refused | `tests/production.spec.ts` |
| 8 | Every planned voucher balances | the existing invariant suite |
| 9 | The inventory asset equals the value of the stock on hand | the existing invariant suite, and the packaged end-to-end run |
| 10 | The work in progress balance equals the untransferred issue costs | `tests/production.spec.ts` |
| 11 | A completion transfers exactly the accumulated issue cost | `tests/production.spec.ts` |
