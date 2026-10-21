/**
 * Inventory costing and accounting consequences.
 *
 * The policy this implements is written down in
 * `docs/inventory-accounting-policy.md`. In summary: perpetual moving
 * weighted-average cost over a shared company-and-item pool, exact integer
 * arithmetic throughout, and the general ledger consequences prepared here so
 * the persistence layer can commit them in one transaction.
 *
 * This module is the **only** authority for inventory cost. Rust stores what
 * this produces; it never re-derives a weighted average.
 */

import { issueCost, lineValue, type Quantity } from '@/domain/quantity'
import type { Money } from '@/lib/money'
import type {
  Item,
  Ledger,
  StockMovement,
  Voucher,
  VoucherEntry,
  VoucherItemLine,
} from '@/domain/types'

export const VALUATION_METHOD = 'moving-weighted-average'

export type MovementType =
  | 'opening'
  | 'receipt'
  | 'issue'
  | 'return-in'
  | 'return-out'
  | 'transfer-in'
  | 'transfer-out'
  | 'adjustment-in'
  | 'adjustment-out'
  | 'reversal-in'
  | 'reversal-out'

export type MovementDirection = 'in' | 'out'

/** The costing pool for one item within one company. */
export interface StockPool {
  itemId: string
  quantityMilli: Quantity
  carryingValue: Money
  /** Incremented on every change, so a stale plan can be detected. */
  revision: number
}

/** The quantity held at one location. */
export interface LocationBalance {
  itemId: string
  godownId: string
  quantityMilli: Quantity
  revision: number
}

/** A movement that is ready to be written. */
export interface PlannedMovement {
  id: string
  companyId: string
  itemId: string
  godownId: string | null
  voucherId: string
  /** The voucher line that caused the movement. */
  voucherItemId: string | null
  movementType: MovementType
  date: string
  direction: MovementDirection
  /** The quantity moved, always positive. */
  quantityMilli: Quantity
  /** The unit rate: the purchase cost for a receipt, the average cost for an issue. */
  rate: Money
  /** The value of the movement. */
  value: Money
  /** The calculated cost of an issue. Zero for a receipt. */
  cost: Money
  valuationMethod: string
  /** The pool quantity after the movement. */
  resultingQuantityMilli: Quantity
  /** The pool carrying value after the movement. */
  resultingCarryingValue: Money
  /** The movement this one reverses, for a cancellation. */
  reversesMovementId: string | null
  createdAt: string
}

/** The accounts a company uses for inventory. */
export interface InventoryAccounts {
  /** The inventory asset account. */
  inventory: Ledger
  /** The cost of goods sold account. */
  cogs: Ledger
  /** The stock adjustment and variance account. */
  variance: Ledger
  /** The purchase expense account, used for non-stock and service purchases. */
  purchases: Ledger
  /** Whether input tax is recoverable and therefore excluded from stock cost. */
  inputTaxRecoverable: boolean
}

export interface InventoryContext {
  companyId: string
  accounts: InventoryAccounts
  items: Map<string, Item>
  /** The costing pool per item. */
  pools: Map<string, StockPool>
  /** The quantity held per item and location, keyed by `itemId::godownId`. */
  locations: Map<string, LocationBalance>
  /**
   * The recorded movement history for the company.
   *
   * A sales return reverses the cost of the **original issue**, so the planner
   * has to know what the goods were issued at. The history is the only record
   * of that. When it is absent the return is valued at the current moving
   * average and the movement records that no original was reversed.
   */
  movements?: StockMovement[]
  idFactory: () => string
  now: () => string
}

export interface InventoryPlan {
  /** The voucher with its inventory entries applied. */
  voucher: Voucher
  movements: PlannedMovement[]
  /** The pool state after the plan. */
  pools: Map<string, StockPool>
  /** The location state after the plan. */
  locations: Map<string, LocationBalance>
  /** A human-readable reason the plan could not be produced, when it failed. */
  blocked: string | null
}

export class InventoryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InventoryError'
  }
}

export function poolKey(itemId: string): string {
  return itemId
}

export function locationKey(itemId: string, godownId: string): string {
  return `${itemId}::${godownId}`
}

function poolFor(context: InventoryContext, itemId: string): StockPool {
  const existing = context.pools.get(itemId)
  if (existing) return { ...existing }
  return { itemId, quantityMilli: 0, carryingValue: 0, revision: 0 }
}

function locationFor(
  context: InventoryContext,
  itemId: string,
  godownId: string,
): LocationBalance {
  const key = locationKey(itemId, godownId)
  const existing = context.locations.get(key)
  if (existing) return { ...existing }
  return { itemId, godownId, quantityMilli: 0, revision: 0 }
}

/**
 * The stock cost of a purchase line, under the policy.
 *
 * The net purchase value of the line, after discount and before recoverable
 * tax. Directly attributable acquisition costs are capitalised into the stock,
 * because the asset and the books must not disagree.
 */
export function receiptCost(
  quantity: Quantity,
  rate: Money,
  discount: Money,
  directCosts: Money = 0,
): Money {
  const gross = lineValue(quantity, rate)
  return gross - discount + directCosts
}

function isStockTracked(context: InventoryContext, itemId: string): boolean {
  const item = context.items.get(itemId)
  return Boolean(item?.isInventory)
}

/**
 * The unit cost of a receipt, for display and for the movement record.
 * The receipt value is the authoritative figure, not this.
 */
function unitRate(value: Money, quantity: Quantity): Money {
  if (quantity === 0) return 0
  const numerator = BigInt(value) * BigInt(1000)
  const denominator = BigInt(quantity)
  let result = numerator / denominator
  const remainder = numerator % denominator
  if (remainder * 2n >= (denominator < 0n ? -denominator : denominator)) result += 1n
  return Number(result)
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

interface LinePlan {
  movements: PlannedMovement[]
  pool: StockPool
  location: LocationBalance
  /** The accounting consequence of the line, when it needs one. */
  entries?: VoucherEntry[]
}

/**
 * Plan the issue of stock from a godown.
 *
 * The cost is the moving weighted average of the pool, and a full depletion
 * gives the whole remaining carrying value to the issue so that no residue
 * is stranded. This is the one place a movement's cost is decided, and every
 * issue in the application — a sale, a purchase return, a count variance or
 * materials issued to production — comes through it.
 */
export function planStockIssue(
  context: InventoryContext,
  voucher: Voucher,
  line: VoucherItemLine,
): LinePlan {
  return planIssueLine(context, voucher, line)
}

function planReceiptLine(
  context: InventoryContext,
  voucher: Voucher,
  line: VoucherItemLine,
): LinePlan {
  const item = context.items.get(line.itemId)
  if (!item) {
    throw new InventoryError(`The item on this line no longer exists.`)
  }
  if (!item.isInventory) {
    throw new InventoryError('A service line cannot be received into stock.')
  }
  if (line.quantityMilli <= 0) {
    throw new InventoryError('A receipt must have a positive quantity.')
  }

  const cost = receiptCost(line.quantityMilli, line.rate, line.discount, line.directCost ?? 0)
  if (cost < 0) {
    throw new InventoryError('The cost of a receipt cannot be negative.')
  }

  const pool = poolFor(context, line.itemId)
  const godownId = line.godownId ?? context.accounts.inventory.companyId
  const location = locationFor(context, line.itemId, godownId)

  const nextPool: StockPool = {
    ...pool,
    quantityMilli: pool.quantityMilli + line.quantityMilli,
    carryingValue: pool.carryingValue + cost,
  }
  const nextLocation: LocationBalance = {
    ...location,
    quantityMilli: location.quantityMilli + line.quantityMilli,
  }

  const movement: PlannedMovement = {
    id: context.idFactory(),
    companyId: context.companyId,
    itemId: line.itemId,
    godownId,
    voucherId: voucher.id,
    voucherItemId: line.id,
    movementType: 'receipt',
    date: voucher.date,
    direction: 'in',
    quantityMilli: line.quantityMilli,
    rate: unitRate(cost, line.quantityMilli),
    value: cost,
    cost: 0,
    valuationMethod: VALUATION_METHOD,
    resultingQuantityMilli: nextPool.quantityMilli,
    resultingCarryingValue: nextPool.carryingValue,
    reversesMovementId: null,
    createdAt: context.now(),
  }

  return {
    movements: [movement],
    pool: nextPool,
    location: nextLocation,
  }
}

function planIssueLine(
  context: InventoryContext,
  voucher: Voucher,
  line: VoucherItemLine,
): LinePlan {
  const item = context.items.get(line.itemId)
  if (!item) {
    throw new InventoryError(`The item on this line no longer exists.`)
  }
  if (!item.isInventory) {
    throw new InventoryError('A service line cannot be issued from stock.')
  }
  if (line.quantityMilli <= 0) {
    throw new InventoryError('An issue must have a positive quantity.')
  }

  const pool = poolFor(context, line.itemId)
  if (pool.quantityMilli < line.quantityMilli) {
    throw new InventoryError(
      `There is not enough stock of ${item.name}. ` +
        `Available ${pool.quantityMilli} milli-units, requested ${line.quantityMilli}.`,
    )
  }

  const cost = issueCost(pool.carryingValue, pool.quantityMilli, line.quantityMilli)
  const godownId = line.godownId ?? context.accounts.inventory.companyId
  const location = locationFor(context, line.itemId, godownId)
  if (location.quantityMilli < line.quantityMilli) {
    throw new InventoryError(
      `There is not enough stock of ${item.name} at this location. ` +
        `Available ${location.quantityMilli} milli-units, requested ${line.quantityMilli}.`,
    )
  }

  const nextPool: StockPool = {
    ...pool,
    quantityMilli: pool.quantityMilli - line.quantityMilli,
    carryingValue: pool.carryingValue - cost,
  }
  const nextLocation: LocationBalance = {
    ...location,
    quantityMilli: location.quantityMilli - line.quantityMilli,
  }

  const movement: PlannedMovement = {
    id: context.idFactory(),
    companyId: context.companyId,
    itemId: line.itemId,
    godownId,
    voucherId: voucher.id,
    voucherItemId: line.id,
    movementType: 'issue',
    date: voucher.date,
    direction: 'out',
    quantityMilli: line.quantityMilli,
    rate: unitRate(cost, line.quantityMilli),
    value: cost,
    cost,
    valuationMethod: VALUATION_METHOD,
    resultingQuantityMilli: nextPool.quantityMilli,
    resultingCarryingValue: nextPool.carryingValue,
    reversesMovementId: null,
    createdAt: context.now(),
  }

  return {
    movements: [movement],
    pool: nextPool,
    location: nextLocation,
  }
}

// ---------------------------------------------------------------------------
// Sales returns
// ---------------------------------------------------------------------------

interface ReturnableIssue {
  movement: StockMovement
  /** The quantity already returned against this issue. */
  returnedMilli: Quantity
}

/**
 * The issue movements that a sales return may reverse.
 *
 * Only an issue of stock leaves the shelf. A transfer out or a count variance
 * is not a sale and cannot be returned against a customer. When the return is
 * linked to the sale it reverses, only that sale's issues are eligible.
 */
function returnableIssues(
  context: InventoryContext,
  voucher: Voucher,
  itemId: string,
): ReturnableIssue[] {
  const history = context.movements ?? []
  const reversed = new Set<string>()
  for (const movement of history) {
    if (movement.reversesMovementId) reversed.add(movement.reversesMovementId)
  }

  return history
    .filter((movement) => {
      if (movement.itemId !== itemId) return false
      if (movement.movementType !== 'issue') return false
      if (movement.direction !== 'out') return false
      if (reversed.has(movement.id)) return false
      if (voucher.linkedVoucherId && movement.voucherId !== voucher.linkedVoucherId) return false
      return true
    })
    .map((movement) => ({
      movement,
      returnedMilli: history
        .filter((candidate) => candidate.reversesMovementId === movement.id)
        .reduce((sum, candidate) => sum + candidate.quantityMilli, 0),
    }))
    .filter((entry) => entry.movement.quantityMilli - entry.returnedMilli > 0)
    .sort((left, right) => byLedgerOrder(left.movement, right.movement))
}

interface ReturnedSlice {
  movement: StockMovement
  quantityMilli: Quantity
  value: Money
}

/**
 * Take the returned quantity out of the eligible issues, oldest first.
 *
 * Each slice is valued at the cost recorded on the issue it reverses, so the
 * profit effect of the original sale is unwound exactly.
 */
function consumeIssues(issues: ReturnableIssue[], quantityMilli: Quantity): ReturnedSlice[] {
  const slices: ReturnedSlice[] = []
  let remaining = quantityMilli
  for (const issue of issues) {
    if (remaining <= 0) break
    const available = issue.movement.quantityMilli - issue.returnedMilli
    const taken = available < remaining ? available : remaining
    if (taken <= 0) continue
    slices.push({
      movement: issue.movement,
      quantityMilli: taken,
      value: issueCost(issue.movement.cost, issue.movement.quantityMilli, taken),
    })
    remaining -= taken
  }
  return slices
}

/**
 * A sales return brings the stock back in.
 *
 * The value is the cost recorded on the original issue when it is known, so
 * the profit effect of the original sale is unwound exactly rather than
 * re-costed at today's average. Without a known original the return is valued
 * at the current moving average, and the movement records that no original
 * was reversed.
 */
function planSalesReturn(
  context: InventoryContext,
  voucher: Voucher,
  line: VoucherItemLine,
): { plans: LinePlan[]; value: Money } {
  const item = context.items.get(line.itemId)
  if (!item) {
    throw new InventoryError('The item on this line no longer exists.')
  }
  if (!item.isInventory) {
    throw new InventoryError('A service line cannot be returned into stock.')
  }
  if (line.quantityMilli <= 0) {
    throw new InventoryError('A return must have a positive quantity.')
  }

  const history = context.movements ?? []
  const issues = returnableIssues(context, voucher, line.itemId)

  if (history.length > 0 && issues.length === 0) {
    throw new InventoryError(
      `There is no sale of ${item.name} to return against. ` +
        'A sales return must be linked to the sale it reverses.',
    )
  }

  const slices = consumeIssues(issues, line.quantityMilli)
  const consumed = slices.reduce((sum, slice) => sum + slice.quantityMilli, 0)
  if (slices.length > 0 && consumed < line.quantityMilli) {
    throw new InventoryError(
      `Only ${consumed} milli-units of ${item.name} are still eligible for return. ` +
        `Requested ${line.quantityMilli}.`,
    )
  }

  if (slices.length === 0) {
    // No original issue is known, so the return is valued at the current
    // moving average of the pool.
    const pool = poolFor(context, line.itemId)
    const value = issueCost(pool.carryingValue, pool.quantityMilli, line.quantityMilli)
    return {
      plans: [planReturnIn(context, voucher, line, line.quantityMilli, value, null)],
      value,
    }
  }

  const plans: LinePlan[] = []
  let value = 0
  let working = context
  for (const slice of slices) {
    const plan = planReturnIn(
      working,
      voucher,
      line,
      slice.quantityMilli,
      slice.value,
      slice.movement.id,
    )
    plans.push(plan)
    value += slice.value
    working = {
      ...working,
      pools: new Map([[plan.pool.itemId, plan.pool]]),
      locations: new Map([
        [locationKey(plan.location.itemId, plan.location.godownId), plan.location],
      ]),
    }
  }
  return { plans, value }
}

/**
 * The movement for stock coming back in, at the value already determined.
 */
function planReturnIn(
  context: InventoryContext,
  voucher: Voucher,
  line: VoucherItemLine,
  quantityMilli: Quantity,
  value: Money,
  reversesMovementId: string | null,
): LinePlan {
  const pool = poolFor(context, line.itemId)
  const godownId = line.godownId ?? context.accounts.inventory.companyId
  const location = locationFor(context, line.itemId, godownId)

  const nextPool: StockPool = {
    ...pool,
    quantityMilli: pool.quantityMilli + quantityMilli,
    carryingValue: pool.carryingValue + value,
  }
  const nextLocation: LocationBalance = {
    ...location,
    quantityMilli: location.quantityMilli + quantityMilli,
  }

  return {
    movements: [
      {
        id: context.idFactory(),
        companyId: context.companyId,
        itemId: line.itemId,
        godownId,
        voucherId: voucher.id,
        voucherItemId: line.id,
        movementType: 'return-in',
        date: voucher.date,
        direction: 'in',
        quantityMilli,
        rate: unitRate(value, quantityMilli),
        value,
        cost: value,
        valuationMethod: VALUATION_METHOD,
        resultingQuantityMilli: nextPool.quantityMilli,
        resultingCarryingValue: nextPool.carryingValue,
        reversesMovementId,
        createdAt: context.now(),
      },
    ],
    pool: nextPool,
    location: nextLocation,
  }
}

/**
 * Plan the inventory effect of a voucher.
 *
 * Purchase vouchers receive stock, sales vouchers issue it, and the notes
 * reverse them. A stock journal carries an adjustment or a transfer.
 */
export function planInventoryPosting(
  voucher: Voucher,
  context: InventoryContext,
): InventoryPlan {
  const movements: PlannedMovement[] = []
  const pools = new Map(context.pools)
  const locations = new Map(context.locations)
  const extraEntries: VoucherEntry[] = []
  // The entries are copied, because relieving the purchase debit must not
  // change the voucher that was handed in.
  const baseEntries = voucher.entries.map((entry) => ({ ...entry }))

  /** The cost of goods sold, debited when stock is issued. */
  let cogsDebit = 0
  /** The inventory asset, credited when stock is issued. */
  let inventoryCredit = 0
  /** The cost of goods sold, credited when stock comes back. */
  let cogsCredit = 0
  /** The inventory asset, debited when stock comes back. */
  let inventoryDebit = 0

  /**
   * The invoice amount of the stock lines of a purchase, and the carrying
   * value those lines carry. For a receipt the two are the same. For a
   * purchase return the stock leaves at the current average, so the two
   * differ, and the difference is the variance.
   */
  let stockInvoice = 0
  let stockCost = 0

  const working: InventoryContext = { ...context, pools, locations }

  const record = (plan: LinePlan) => {
    movements.push(...plan.movements)
    pools.set(plan.pool.itemId, plan.pool)
    locations.set(locationKey(plan.location.itemId, plan.location.godownId), plan.location)
  }

  const isPurchase = voucher.type === 'purchase' || voucher.type === 'debit-note'
  const isSale = voucher.type === 'sales' || voucher.type === 'credit-note'

  for (const line of voucher.items) {
    if (!isStockTracked(context, line.itemId)) {
      // A service or non-stock line keeps the existing expense treatment.
      continue
    }

    if (isPurchase) {
      if (voucher.type === 'debit-note') {
        // A purchase return: the stock goes back to the supplier at the
        // current carrying value. The difference between the supplier credit
        // and that carrying value is a variance, and is posted as such.
        const plan = planIssueLine(working, voucher, line)
        record(plan)
        stockInvoice += line.amount
        stockCost += plan.movements[0]!.cost
      } else {
        const plan = planReceiptLine(working, voucher, line)
        record(plan)
        stockInvoice += line.amount
        stockCost += plan.movements[0]!.value
      }
      continue
    }

    if (isSale) {
      if (voucher.type === 'credit-note') {
        const returned = planSalesReturn(working, voucher, line)
        for (const plan of returned.plans) {
          record(plan)
        }
        cogsCredit += returned.value
        inventoryDebit += returned.value
      } else {
        const plan = planIssueLine(working, voucher, line)
        record(plan)
        cogsDebit += plan.movements[0]!.cost
        inventoryCredit += plan.movements[0]!.cost
      }
      continue
    }

    if (voucher.type === 'stock-journal') {
      const plan = planStockJournalLine(working, voucher, line)
      record(plan)
      if (plan.entries) {
        extraEntries.push(...plan.entries)
      }
      continue
    }
  }

  // -- Purchases ------------------------------------------------------------
  //
  // The purchase expense debit covers the whole voucher. The stock part of it
  // moves to the inventory asset, so a stock purchase is never booked twice.
  if (isPurchase && stockInvoice !== 0) {
    const purchaseEntry = baseEntries.find(
      (entry) => entry.ledgerId === context.accounts.purchases.id,
    )
    if (purchaseEntry) {
      if (voucher.type === 'debit-note') {
        purchaseEntry.credit = Math.max(0, purchaseEntry.credit - stockInvoice)
      } else {
        purchaseEntry.debit = Math.max(0, purchaseEntry.debit - stockInvoice)
      }
    }
  }

  if (isPurchase && stockCost !== 0) {
    if (voucher.type === 'debit-note') {
      // The stock leaves at the current average cost, and the difference
      // between that and the supplier credit is the variance. The two amounts
      // are never forced to match.
      extraEntries.push({
        id: context.idFactory(),
        ledgerId: context.accounts.inventory.id,
        debit: 0,
        credit: stockCost,
        narration: 'Stock returned to the supplier at cost',
      })
      const difference = stockCost - stockInvoice
      if (difference > 0) {
        extraEntries.push({
          id: context.idFactory(),
          ledgerId: context.accounts.variance.id,
          debit: difference,
          credit: 0,
          narration: 'Purchase return valued below the supplier credit',
        })
      } else if (difference < 0) {
        extraEntries.push({
          id: context.idFactory(),
          ledgerId: context.accounts.variance.id,
          debit: 0,
          credit: -difference,
          narration: 'Purchase return valued at the current average cost',
        })
      }
    } else {
      extraEntries.push({
        id: context.idFactory(),
        ledgerId: context.accounts.inventory.id,
        debit: stockCost,
        credit: 0,
        narration: 'Stock received, valued at cost',
      })
      const difference = stockCost - stockInvoice
      if (difference > 0) {
        extraEntries.push({
          id: context.idFactory(),
          ledgerId: context.accounts.variance.id,
          debit: 0,
          credit: difference,
          narration: 'Stock received above the invoice amount',
        })
      } else if (difference < 0) {
        extraEntries.push({
          id: context.idFactory(),
          ledgerId: context.accounts.variance.id,
          debit: -difference,
          credit: 0,
          narration: 'Stock received below the invoice amount',
        })
      }
    }
  }

  // -- Issues and returns ---------------------------------------------------

  if (cogsDebit > 0) {
    extraEntries.push({
      id: context.idFactory(),
      ledgerId: context.accounts.cogs.id,
      debit: cogsDebit,
      credit: 0,
      narration: 'Cost of goods sold',
    })
    extraEntries.push({
      id: context.idFactory(),
      ledgerId: context.accounts.inventory.id,
      debit: 0,
      credit: inventoryCredit,
      narration: 'Inventory relieved at cost',
    })
  }

  if (cogsCredit > 0) {
    extraEntries.push({
      id: context.idFactory(),
      ledgerId: context.accounts.inventory.id,
      debit: inventoryDebit,
      credit: 0,
      narration: 'Stock returned in',
    })
    extraEntries.push({
      id: context.idFactory(),
      ledgerId: context.accounts.cogs.id,
      debit: 0,
      credit: cogsCredit,
      narration: 'Cost of goods sold reversed on return',
    })
  }

  const entries = [...baseEntries, ...extraEntries]

  return {
    voucher: { ...voucher, entries },
    movements,
    pools,
    locations,
    blocked: null,
  }
}

/**
 * A stock journal line is an adjustment or a transfer.
 *
 * A negative quantity is an issue out of the location; a positive quantity
 * with a destination location is a transfer; a positive quantity without one
 * is an adjustment in.
 */
function planStockJournalLine(
  context: InventoryContext,
  voucher: Voucher,
  line: VoucherItemLine,
): LinePlan {
  const item = context.items.get(line.itemId)
  if (!item) {
    throw new InventoryError('The item on this line no longer exists.')
  }
  if (!item.isInventory) {
    throw new InventoryError('A service line cannot be adjusted in stock.')
  }

  const source = line.godownId ?? context.accounts.inventory.companyId
  const pool = poolFor(context, line.itemId)

  if (line.quantityMilli < 0) {
    const out = planIssueLine(
      { ...context, items: context.items },
      voucher,
      { ...line, quantityMilli: -line.quantityMilli },
    )
    const cost = out.movements[0]!.cost
    return {
      ...out,
      movements: out.movements.map((movement) => ({
        ...movement,
        movementType: 'adjustment-out' as const,
      })),
      entries: [
        {
          id: context.idFactory(),
          ledgerId: context.accounts.variance.id,
          debit: cost,
          credit: 0,
          narration: `Stock shortage: ${item.name}`,
        },
        {
          id: context.idFactory(),
          ledgerId: context.accounts.inventory.id,
          debit: 0,
          credit: cost,
          narration: 'Inventory relieved on the count variance',
        },
      ],
    }
  }

  if (line.toGodownId) {
    // A transfer: the value moves with the quantity, the company total does not.
    const location = locationFor(context, line.itemId, source)
    if (location.quantityMilli < line.quantityMilli) {
      throw new InventoryError(
        `There is not enough stock of ${item.name} at the source location to transfer.`,
      )
    }
    const cost = issueCost(pool.carryingValue, pool.quantityMilli, line.quantityMilli)
    const nextPool: StockPool = { ...pool }
    const nextSource: LocationBalance = {
      ...location,
      quantityMilli: location.quantityMilli - line.quantityMilli,
    }
    return {
      movements: [
        {
          id: context.idFactory(),
          companyId: context.companyId,
          itemId: line.itemId,
          godownId: source,
          voucherId: voucher.id,
          voucherItemId: line.id,
          movementType: 'transfer-out',
          date: voucher.date,
          direction: 'out',
          quantityMilli: line.quantityMilli,
          rate: unitRate(cost, line.quantityMilli),
          value: cost,
          cost,
          valuationMethod: VALUATION_METHOD,
          resultingQuantityMilli: pool.quantityMilli,
          resultingCarryingValue: pool.carryingValue,
          reversesMovementId: null,
          createdAt: context.now(),
        },
        {
          id: context.idFactory(),
          companyId: context.companyId,
          itemId: line.itemId,
          godownId: line.toGodownId,
          voucherId: voucher.id,
          voucherItemId: line.id,
          movementType: 'transfer-in',
          date: voucher.date,
          direction: 'in',
          quantityMilli: line.quantityMilli,
          rate: unitRate(cost, line.quantityMilli),
          value: cost,
          cost,
          valuationMethod: VALUATION_METHOD,
          resultingQuantityMilli: pool.quantityMilli,
          resultingCarryingValue: pool.carryingValue,
          reversesMovementId: null,
          createdAt: context.now(),
        },
      ],
      pool: nextPool,
      location: nextSource,
    }
  }

  // An adjustment in: stock was counted above the book quantity.
  const value = lineValue(line.quantityMilli, line.rate)
  const nextPool: StockPool = {
    ...pool,
    quantityMilli: pool.quantityMilli + line.quantityMilli,
    carryingValue: pool.carryingValue + value,
  }
  const current = locationFor(context, line.itemId, source)
  const nextLocation: LocationBalance = {
    ...current,
    quantityMilli: current.quantityMilli + line.quantityMilli,
  }
  return {
    movements: [
      {
        id: context.idFactory(),
        companyId: context.companyId,
        itemId: line.itemId,
        godownId: source,
        voucherId: voucher.id,
        voucherItemId: line.id,
        movementType: 'adjustment-in',
        date: voucher.date,
        direction: 'in',
        quantityMilli: line.quantityMilli,
        rate: unitRate(value, line.quantityMilli),
        value,
        cost: 0,
        valuationMethod: VALUATION_METHOD,
        resultingQuantityMilli: nextPool.quantityMilli,
        resultingCarryingValue: nextPool.carryingValue,
        reversesMovementId: null,
        createdAt: context.now(),
      },
    ],
    pool: nextPool,
    location: nextLocation,
    entries: [
      {
        id: context.idFactory(),
        ledgerId: context.accounts.inventory.id,
        debit: value,
        credit: 0,
        narration: `Stock surplus: ${item.name}`,
      },
      {
        id: context.idFactory(),
        ledgerId: context.accounts.variance.id,
        debit: 0,
        credit: value,
        narration: 'Gain on the count variance',
      },
    ],
  }
}

/**
 * The order the movement ledger is kept in: the effective date, then the
 * posting sequence, then the identifier.
 *
 * The ledger is replayed in this order, so the order is not a convention — it
 * is what makes the stock reproducible.
 */
function byLedgerOrder(left: StockMovement, right: StockMovement): number {
  if (left.date !== right.date) return left.date < right.date ? -1 : 1
  const leftSequence = left.sequenceNo ?? 0
  const rightSequence = right.sequenceNo ?? 0
  if (leftSequence !== rightSequence) return leftSequence - rightSequence
  if (left.id === right.id) return 0
  return left.id < right.id ? -1 : 1
}

/**
 * Plan the reversal of the stock a voucher moved.
 *
 * A cancellation must give the stock back exactly as it took it. Each movement
 * is answered by a compensating movement with the same quantity and value in
 * the opposite direction, linked to the movement it reverses. No movement is
 * ever deleted, so the history stays complete and the reversal is auditable.
 *
 * A reversal is refused when the voucher is not the latest stock-affecting
 * movement for an item it touched. Undoing it then would change the cost of
 * goods sold that has already been reported, and the books are not recosted.
 * The message names the corrective workflow instead of quietly miscosting
 * stock.
 */
export function planStockReversal(
  voucher: Voucher,
  context: InventoryContext,
): {
  movements: PlannedMovement[]
  pools: Map<string, StockPool>
  locations: Map<string, LocationBalance>
} {
  const history = context.movements ?? []
  const pools = new Map(context.pools)
  const locations = new Map(context.locations)

  const originals = history
    .filter((movement) => movement.voucherId === voucher.id)
    .sort(byLedgerOrder)

  if (originals.length === 0) {
    return { movements: [], pools, locations }
  }

  // The reversal is only safe when the voucher holds the latest movement for
  // every item it touched.
  const latest = new Map<string, StockMovement>()
  for (const movement of history) {
    const current = latest.get(movement.itemId)
    if (!current || byLedgerOrder(current, movement) < 0) {
      latest.set(movement.itemId, movement)
    }
  }
  for (const movement of originals) {
    const last = latest.get(movement.itemId)
    if (last && last.voucherId !== voucher.id) {
      const item = context.items.get(movement.itemId)
      throw new InventoryError(
        `${item?.name ?? 'That item'} has been moved on since this voucher was posted, ` +
          'so cancelling it would change a cost that has already been reported. ' +
          'Post a debit note or a credit note against the later movement instead.',
      )
    }
  }

  const working: InventoryContext = { ...context, pools, locations }
  const movements: PlannedMovement[] = []

  for (const original of originals) {
    const item = context.items.get(original.itemId)
    if (!item) {
      throw new InventoryError('The item on this movement no longer exists.')
    }

    const direction: MovementDirection = original.direction === 'in' ? 'out' : 'in'
    const movementType: MovementType = direction === 'out' ? 'reversal-out' : 'reversal-in'

    const pool = poolFor(working, original.itemId)
    const godownId = original.godownId ?? context.accounts.inventory.companyId
    const location = locationFor(working, original.itemId, godownId)

    const sign = direction === 'in' ? 1 : -1
    const nextPool: StockPool = {
      ...pool,
      quantityMilli: pool.quantityMilli + sign * original.quantityMilli,
      carryingValue: pool.carryingValue + sign * original.value,
    }
    const nextLocation: LocationBalance = {
      ...location,
      quantityMilli: location.quantityMilli + sign * original.quantityMilli,
    }

    if (nextPool.quantityMilli < 0 || nextLocation.quantityMilli < 0) {
      throw new InventoryError(
        'Cancelling this voucher would leave a negative stock balance.',
      )
    }

    pools.set(nextPool.itemId, nextPool)
    locations.set(locationKey(nextLocation.itemId, nextLocation.godownId), nextLocation)

    movements.push({
      id: context.idFactory(),
      companyId: context.companyId,
      itemId: original.itemId,
      godownId,
      voucherId: voucher.id,
      voucherItemId: original.voucherItemId,
      movementType,
      date: original.date,
      direction,
      quantityMilli: original.quantityMilli,
      rate: original.rate,
      value: original.value,
      cost: original.cost,
      valuationMethod: original.valuationMethod,
      resultingQuantityMilli: nextPool.quantityMilli,
      resultingCarryingValue: nextPool.carryingValue,
      reversesMovementId: original.id,
      createdAt: context.now(),
    })
  }

  return { movements, pools, locations }
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export interface ReplayedBalance {
  itemId: string
  godownId: string | null
  quantityMilli: Quantity
  value: Money
}

/**
 * Replay a movement ledger and produce the balances it implies.
 *
 * This is the check behind the balance projection: the stored balances must
 * agree with what the movements say.
 */
export function replayMovements(
  movements: Array<{
    itemId: string
    godownId: string | null
    direction: MovementDirection
    quantityMilli: Quantity
    value: Money
  }>,
): Map<string, ReplayedBalance> {
  const balances = new Map<string, ReplayedBalance>()

  for (const movement of movements) {
    const key = locationKey(movement.itemId, movement.godownId ?? '')
    const existing = balances.get(key) ?? {
      itemId: movement.itemId,
      godownId: movement.godownId,
      quantityMilli: 0,
      value: 0,
    }
    const sign = movement.direction === 'in' ? 1 : -1
    balances.set(key, {
      ...existing,
      quantityMilli: existing.quantityMilli + sign * movement.quantityMilli,
      value: existing.value + sign * movement.value,
    })
  }

  return balances
}

export interface InventoryDiscrepancy {
  itemId: string
  godownId: string | null
  expectedQuantityMilli: Quantity
  actualQuantityMilli: Quantity
  expectedValue: Money
  actualValue: Money
}

/**
 * Compare the stored balance projection with the balances the movement ledger
 * implies. A difference is reported, never silently corrected.
 */
export function reconcileBalances(
  movements: Array<{
    itemId: string
    godownId: string | null
    direction: MovementDirection
    quantityMilli: Quantity
    value: Money
  }>,
  stored: Map<string, LocationBalance>,
  storedValues: Map<string, Money>,
): InventoryDiscrepancy[] {
  const replayed = replayMovements(movements)
  const discrepancies: InventoryDiscrepancy[] = []

  const keys = new Set([...replayed.keys(), ...stored.keys()])
  for (const key of keys) {
    const [itemId, godownId] = key.split('::')
    const expected = replayed.get(key)
    const actual = stored.get(key)
    const expectedValue = expected?.value ?? 0
    const actualValue = storedValues.get(key) ?? 0
    const expectedQuantity = expected?.quantityMilli ?? 0
    const actualQuantity = actual?.quantityMilli ?? 0

    if (expectedQuantity !== actualQuantity || expectedValue !== actualValue) {
      discrepancies.push({
        itemId,
        godownId: godownId || null,
        expectedQuantityMilli: expectedQuantity,
        actualQuantityMilli: actualQuantity,
        expectedValue,
        actualValue,
      })
    }
  }

  return discrepancies
}
