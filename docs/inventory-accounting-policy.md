# LedgerFy — Inventory accounting policy

**Version:** 1.0
**Status:** Implemented and tested
**Applies to:** Stock-tracked items in companies where inventory has been activated.
**Owner:** The LedgerFy accounting domain (`src/domain/inventory.ts`)

This document defines how LedgerFy values inventory, what it posts to the general
ledger, and what it deliberately does not do. It is the reference the tests are
written against.

---

## 1. Sources

- **Ind AS 2 — Inventories** (Ministry of Corporate Affairs, 2020 revision) —
  <https://www.mca.gov.in/Ministry/pdf/IndAS2_2020_10112020.pdf>
- **Accounting Standard AS 2 — Valuation of Inventories** (ICAI) —
  <https://kb.icai.org/pdfs/69232asb55316-as2.pdf>
- **TallyPrime stock valuation methods** (published product documentation, used
  here as a *market-practice* reference, not as an accounting authority) —
  <https://help.tallysolutions.com/inventory/stock-valuation-methods-tallyprime/>

AS 2 and Ind AS 2 require cost (not selling price) to be the basis of
inventory valuation, and both FIFO and weighted-average cost are permitted for
interchangeable items. **LIFO is not permitted** under either standard for
interchangeable items, and LedgerFy therefore does not offer it. AS 2 and Ind
AS 2 also require inventories to be stated at the lower of cost and net
realisable value.

**Applicability caveat.** Indian entities report under Ind AS, while many
non-listed entities and small businesses apply AS 2. The two standards agree on
the matters this policy relies on, but LedgerFy does not claim that applying
this policy satisfies every disclosure obligation of either standard, and it
does not implement a net realisable value review (see §8).

---

## 2. Supported valuation method

**Perpetual moving weighted-average cost**, computed on a company-and-item pool.

For an item holding quantity `Q` (in exact milli-units) and carrying value `V`
(in minor currency units), a receipt of quantity `q` at cost `C`:

```
Q_new = Q + q
V_new = V + C
A_new = V_new / Q_new          (exact rational, never a float)
```

An issue of quantity `x` is costed at the average carrying cost **immediately
before the issue**:

```
cost(x) = round_half_away_from_zero( V * x / Q )
```

Two rules make the arithmetic exact rather than approximate:

1. **Exact integer arithmetic.** `V * x` is computed in `BigInt` and divided
   with integer arithmetic, so no binary floating-point value ever reaches the
   carrying value. The quantity and the value are divided only once, at the
   point of costing, and the result is rounded once, to the nearest minor unit.
2. **Full depletion consumes the remainder.** When an issue takes the whole
   remaining stock, the issue cost is the entire remaining carrying value, not
   the rounded average applied to the quantity. This prevents a residue of a few
   minor units from accumulating invisibly across issues.

If stock remains after an issue, `V_new = V - cost(x)` exactly.

### 2.1 Scope of the pool

Quantity balances are held per **company, item and stock location**. The
weighted-average cost is computed within a **shared company-and-item pool**:
stock held in one location and stock held in another are interchangeable for
costing purposes, so a transfer between locations changes the location
quantities but not the company's total quantity or total carrying value for
that item.

This pooling is appropriate for the inventory types LedgerFy currently
supports — construction materials, hardware, consumables and packaged goods
that are not individually identified. The costing boundary is a strategy
interface, so a separately identified, high-value or project-specific item can
later be given its own pool without changing the engine's callers.

### 2.2 Interchangeability

An item is treated as interchangeable stock only when it is a stock-tracked
good. Service lines, and any item the business identifies individually, must be
classified as such before it is stocked; the item master records
`isInventory` and `isService`, and only items with `isInventory` create
movements.

---

## 3. Numerical representation

| Value | Representation | Scale | Bound |
| --- | --- | --- | --- |
| Currency | integer minor units (paise) | 1/100 rupee | ±(2^53 − 1) |
| Quantity | integer milli-units (1/1000 unit) | 1/1000 unit | ±(2^53 − 1) milli-units |
| Cost per unit | derived rational, never stored as a float | — | — |
| Costing intermediate | `BigInt` | — | unbounded during the calculation |

Quantities are **integers of milli-units** everywhere they are authoritative:
the item master, the voucher item line, the stock movement and the balance
projection. A quantity that is not a whole number of milli-units is rejected
rather than silently rounded. `Unit.decimalPlaces` records how a unit is
displayed; it does not change the stored scale.

---

## 4. Purchase cost

The cost of a stock receipt is the **net purchase value of the line**, after
discount and before recoverable tax:

```
line value      = round_half_away( quantity * rate )
net cost        = line value - discount
```

- **Trade and line discounts** reduce the cost of the stock. The discount is
  applied to the line, and the accounting follows the same figure, so the
  inventory asset and the purchase posting cannot disagree.
- **Recoverable input GST is excluded** from inventory cost. It is posted to
  the input tax ledger, as a recoverable asset, and never capitalised into
  stock.
- **Non-recoverable tax** is included in the cost of stock, because the
  business cannot recover it. Whether a tax is recoverable is a configured
  property of the company (`inventory_accounts.input_tax_recoverable`), not
  something inferred from the GST rate.
- **Directly attributable acquisition costs** (freight, duty and similar
  charges that the purchase workflow captures on the line) are added to the
  cost of the stock. A charge that the workflow does not capture, or that
  cannot be allocated to a line, is **not** spread across lines.
- **Rounding.** The line value is rounded once, to the nearest minor unit, and
  the rounded figure is what enters the cost. The cost of the receipt is
  therefore exactly the figure posted to the purchase ledger.

---

## 5. Perpetual accounting treatment

A company that has activated inventory uses the following accounts, configured
per company in `inventory_accounts`:

| Account | Group | Debited when | Credited when |
| --- | --- | --- | --- |
| Inventory asset | Assets | Stock received, returns in, gain on adjustment | Stock issued, returns out, loss on adjustment |
| Cost of goods sold | Expenses | Stock issued, returns out | Returns in |
| Stock adjustment / variance | Expenses | Loss on count variance | Gain on count variance |
| Purchases (expense) | Expenses | Non-stock and service purchases only | — |

Consequences:

- **Stock purchases are not double-booked.** A stock-tracked purchase debits
  the inventory asset; it does not also debit the purchase expense. A purchase
  voucher with a mixture of stock and service lines splits the two: the stock
  lines debit inventory, the service lines debit purchases, and the supplier is
  credited once for the whole line total plus tax.
- **Sales** continue to debit the customer and credit revenue and output tax,
  exactly as before. The additional entries are **debit cost of goods sold,
  credit inventory asset**, at the cost determined by the valuation.
- **A sale does not change the revenue.** The selling price and the carrying
  cost of the stock are separate concepts and are posted separately.
- **A sales return** is the mirror of a sale: **debit inventory asset, credit
  cost of goods sold**, at the cost recorded on the original issue.
- **A purchase return** credits the inventory asset at the current average and
  posts the difference to stock variance. It never posts to cost of goods
  sold.

### 5.1 The invariants

Three properties must hold for every posting, and they are enforced by the
domain and checked by the test suite rather than assumed:

1. **Every planned voucher balances.** Debits equal credits. A costing engine
   that produces a balanced but wrong voucher is worse than one that refuses.
2. **The inventory asset in the general ledger and the carrying value of the
   stock pools move together.** Every posting that moves stock moves both by
   the same amount, so no posting can make them differ. The only thing that
   can change the difference is the opening cutover, and that difference is
   reported to the person activating rather than absorbed: the activation
   writes no financial entry, and the correction is an explicit, auditable
   adjustment.
3. **A sale and the sales return that reverses it unwind exactly.** Revenue and
   cost of goods sold both return to where they were, and the goods are back
   in stock at the amount they left with.

---

## 6. Returns, transfers and adjustments

### 6.1 Sales returns

A linked sales return reverses the original sale. The **original recorded issue
cost** is reversed, not today's average cost, so the profit effect of the
original sale is unwound exactly. A return may not exceed the eligible sold
quantity after earlier returns.

The original issue cost is found in the movement ledger. A return is matched
against the issue movements of that item, oldest first, and each returned
quantity takes the cost recorded on the issue it reverses; the return movement
records that issue in `reverses_movement_id`. When the return names the sale it
reverses, only that sale's issues are eligible.

Three cases are refused rather than approximated:

- A return larger than the still-eligible sold quantity.
- A return of an item that has no issue movement in the ledger, because the
  ledger knows the item was never sold.
- A return whose original issue cannot be identified, when the ledger holds
  movements for that item.

When the ledger holds no movements at all — a company whose stock history was
never recorded — the return is valued at the current moving average and the
movement records that no original was reversed. This is a degraded mode, not a
silent one: the movement and the audit trail both show that the return was
costed at today's average rather than at the original issue.

Re-valuing a returned item at its original cost moves the pool's average, and
that is the intended consequence: the goods revert to the carrying amount they
left with, and the profit of the original sale is unwound to the paise.

### 6.2 Purchase returns

A purchase return reduces stock at the current weighted-average cost, which can
differ from the original supplier credit amount. The difference is posted
explicitly to the **stock variance** account and is recorded in the audit
trail. The two amounts are never forced to match.

The entries are:

| Account | Debit | Credit |
| --- | --- | --- |
| Supplier | the supplier credit, including tax | — |
| Inventory | — | the carrying value of the stock returned |
| Stock variance | the difference, when the average exceeds the invoice amount | the difference, when it does not |
| Purchases | — | relieved by the invoice amount of the stock lines |

### 6.3 Transfers

A transfer reduces the source location and increases the destination location
at the pool's average cost. The company's total quantity and total carrying
value are unchanged, and no revenue or expense is posted. Both sides commit
together or not at all.

### 6.4 Physical stock adjustments

A physical count proposes a variance against the expected quantity. The
adjustment is posted to inventory and to the stock variance account at the
average cost, is confirmed for material differences, and is recorded as a
movement. **A stock count never overwrites the movement ledger.**

A shortage is `Debit stock variance, Credit inventory asset`. A surplus is
`Debit inventory asset, Credit stock variance`. Neither touches cost of goods
sold: a count variance is not a sale and not a consumption, and posting it to
cost of goods sold would misstate the cost of what was actually sold.

---

## 7. Timing, cancellation and backdating

Moving-average costing is sensitive to sequence, so LedgerFy is deliberately
strict:

- **Backdating is refused.** A stock-affecting posting dated earlier than the
  latest posted inventory movement for the affected item is rejected with a
  clear message. Recosting historical cost is not implemented, and past cost of
  goods sold is never silently changed.
- **Movement order** is the effective date, then a monotonic posting sequence
  assigned by the database, so the order is deterministic and auditable.
- **Cancellation and reversal** never delete a movement. A compensating
  movement and a compensating financial reversal are written, linked to the
  original, in the same transaction. The compensating movement carries the same
  quantity and value as the movement it reverses, in the opposite direction,
  so the stock and its carrying value return to where they were.
- **A reversal that would recost is refused.** Undoing a stock movement that
  is not the latest one for its item would change the cost of goods sold that
  has already been reported, and the books are not recosted. The application
  refuses the cancellation and names the corrective workflow — a debit note or
  a credit note against the later movement — rather than miscosting the stock
  that remains.
- Financial period locks continue to apply to stock-affecting postings.

---

## 8. What this policy does not implement

These are tracked honestly rather than presented as working:

- **Net realisable value review and write-down.** AS 2 and Ind AS 2 require
  inventory at the lower of cost and NRV. LedgerFy does not compute NRV, does
  not compare cost with NRV, and therefore does not claim NRV compliance. A
  write-down is currently made only through a physical stock adjustment, which
  is a quantity variance, not an NRV write-down.
- **FIFO, serial-specific, standard and any other costing method.** The
  strategy boundary exists, but only moving weighted-average is implemented and
  offered.
- **LIFO**, deliberately, because neither AS 2 nor Ind AS 2 permits it for
  interchangeable items.
- **A separate goods-receipt document.** A posted stock-tracked purchase
  voucher creates the receipt; a purchase order alone does not change stock.
- **Historical reconstruction.** A company that activated inventory after
  posting item vouchers has a documented cutover, not a backfill of history.
- **Landed-cost allocation** of unallocated charges across lines.
- **Batch, serial and expiry tracking.** The item line keeps a free-text batch
  field; no batch stock exists.

---

## 9. Activation for an existing company

A company that posted financial vouchers before inventory existed has no
historical stock movements. LedgerFy does **not** invent them. The activation
flow (§ Activation in the interface) records a cutover date, captures opening
quantities and carrying values per item and location, reconciles them against
the inventory asset account, and records the decision in the audit trail.

A cutover date is only valid if no posted stock-affecting voucher is dated on
or after it. Where that cannot be satisfied, a later cutover date or a
reviewed historical reconciliation is required, and the activation is refused
rather than proceeding with a gap.

Before activation the company keeps its existing periodic treatment: purchases
debit the purchase expense and sales carry no cost of goods sold. Activation
does not change any posted record.

---

## 10. Reconciliation

Two reconciliations are provided and both report discrepancies rather than
hiding them:

1. **Movement to balance.** Replaying the movement ledger must reproduce the
   stored balance projection, item by item and location by location.
2. **Valuation to ledger.** The inventory carrying value must agree with the
   inventory asset ledger balance, to the extent the policy requires for the
   period.

A mismatch is shown with the records that cause it. The balances are
projections, and a projection can be rebuilt from the ledger — but a rebuild
never issues a financial adjustment without approval.
