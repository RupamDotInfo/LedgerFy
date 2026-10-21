import { describe, expect, it } from 'vitest'

import {
  averageCost,
  divideRounded,
  formatQuantity,
  fromQuantity,
  issueCost,
  lineValue,
  quantityFromString,
  toQuantity,
} from '@/domain/quantity'
import {
  planInventoryPosting,
  reconcileBalances,
  replayMovements,
  InventoryError,
  type InventoryContext,
  type LocationBalance,
  type StockPool,
} from '@/domain/inventory'
import type { Item, Ledger, Voucher, VoucherItemLine } from '@/domain/types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const rupees = (amount: number): number => amount * 100

const companyId = 'cmp-1'

function ledger(id: string, name: string, group: Ledger['group'], type: Ledger['type']): Ledger {
  return {
    id,
    companyId,
    name,
    group,
    type,
    parentId: null,
    openingBalance: 0,
    openingDate: '2026-04-01',
    partyKind: null,
    currency: 'INR',
    isSystem: false,
    isActive: true,
    createdAt: '2026-04-01T00:00:00.000Z',
  }
}

const inventoryLedger = ledger('l-inv', 'Inventory', 'assets', 'current-assets')
const cogsLedger = ledger('l-cogs', 'Cost of Goods Sold', 'expenses', 'expenses')
const varianceLedger = ledger('l-var', 'Stock Variance', 'expenses', 'expenses')
const purchasesLedger = ledger('l-pur', 'Purchases', 'expenses', 'purchase')
const customerLedger = {
  ...ledger('l-cust', 'Customer One', 'assets', 'receivable'),
  partyKind: 'customer' as const,
}
const salesLedger = ledger('l-sales', 'Sales', 'income', 'sales')

const accounts = {
  inventory: inventoryLedger,
  cogs: cogsLedger,
  variance: varianceLedger,
  purchases: purchasesLedger,
  inputTaxRecoverable: true,
}

function item(id: string, name: string, isInventory = true): Item {
  return {
    id,
    companyId,
    name,
    stockGroupId: 'sg-1',
    unitId: 'u-1',
    isInventory,
    isService: !isInventory,
    purchasePrice: rupees(100),
    salesPrice: rupees(150),
    hsn: '732690',
    taxCategoryId: null,
    openingQuantityMilli: 0,
    openingValue: 0,
    reorderLevelMilli: 0,
    isActive: true,
    createdAt: '2026-04-01T00:00:00.000Z',
  }
}

function context(overrides: Partial<InventoryContext> = {}): InventoryContext {
  let counter = 0
  return {
    companyId,
    accounts,
    items: new Map([['i-1', item('i-1', 'Bolt')]]),
    pools: new Map<string, StockPool>(),
    locations: new Map<string, LocationBalance>(),
    idFactory: () => `m-${++counter}`,
    now: () => '2026-05-01T00:00:00.000Z',
    ...overrides,
  }
}

function voucher(
  id: string,
  type: Voucher['type'],
  lines: VoucherItemLine[],
  entries: Voucher['entries'] = [],
): Voucher {
  return {
    id,
    companyId,
    type,
    number: id.toUpperCase(),
    date: '2026-05-04',
    dueDate: null,
    paymentTermId: null,
    partyId: null,
    narration: 'Test',
    reference: '',
    status: 'posted',
    entries,
    items: lines,
    taxes: [],
    linkedVoucherId: null,
    reversedByVoucherId: null,
    isLocked: false,
    createdAt: '2026-05-04T00:00:00.000Z',
    updatedAt: '2026-05-04T00:00:00.000Z',
  }
}

function line(
  id: string,
  quantityUnits: number,
  rate: number,
  discount = 0,
  godownId: string | null = 'l-god',
): VoucherItemLine {
  const quantityMilli = toQuantity(quantityUnits)
  return {
    id,
    itemId: 'i-1',
    quantityMilli,
    rate,
    discount,
    taxCategoryId: null,
    amount: lineValue(quantityMilli, rate) - discount,
    godownId,
  }
}

// ---------------------------------------------------------------------------
// Exact arithmetic
// ---------------------------------------------------------------------------

describe('exact quantity arithmetic', () => {
  it('holds a quantity in milli-units', () => {
    expect(toQuantity(10)).toBe(10_000)
    expect(toQuantity(0.125)).toBe(125)
    expect(fromQuantity(10_000)).toBe(10)
  })

  it('rejects a quantity with more precision than a milli-unit', () => {
    expect(() => toQuantity(0.0001)).toThrow(/cannot be held more precisely/)
  })

  it('parses what the user typed', () => {
    expect(quantityFromString('12.5')).toBe(12_500)
    expect(quantityFromString('')).toBe(0)
    expect(quantityFromString('1,250')).toBe(1_250_000)
  })

  it('formats a quantity without trailing zeros', () => {
    expect(formatQuantity(12_500)).toBe('12.5')
    expect(formatQuantity(10_000)).toBe('10')
  })

  it('rounds a rational half away from zero', () => {
    expect(divideRounded(5n, 2n)).toBe(3)
    expect(divideRounded(-5n, 2n)).toBe(-3)
    expect(divideRounded(4n, 2n)).toBe(2)
  })

  it('computes a line value exactly', () => {
    // 10 units at ₹100 each is ₹1,000.
    expect(lineValue(toQuantity(10), rupees(100))).toBe(rupees(1000))
    // A third of a unit at ₹100.99 is ₹33.6633, which rounds to ₹33.66.
    expect(lineValue(333, 10099)).toBe(3363)
  })
})

// ---------------------------------------------------------------------------
// Moving weighted average — the worked example from the policy
// ---------------------------------------------------------------------------

describe('moving weighted-average costing', () => {
  it('follows the documented worked example exactly', () => {
    // Receive 10 units at ₹100 each.
    let poolValue = 0
    let poolQuantity = 0

    const firstCost = lineValue(toQuantity(10), rupees(100))
    expect(firstCost).toBe(rupees(1000))
    poolValue += firstCost
    poolQuantity += toQuantity(10)
    expect(poolQuantity).toBe(10_000)
    expect(poolValue).toBe(rupees(1000))

    // Receive another 10 units at ₹120 each.
    const secondCost = lineValue(toQuantity(10), rupees(120))
    expect(secondCost).toBe(rupees(1200))
    poolValue += secondCost
    poolQuantity += toQuantity(10)
    expect(poolQuantity).toBe(20_000)
    expect(poolValue).toBe(rupees(2200))

    // The moving average is ₹110 per unit.
    expect(averageCost(poolValue, poolQuantity)).toBe(11_000) // Rs 110.00 per unit

    // Issue 5 units: the cost is ₹550, leaving 15 units valued at ₹1,650.
    const issue = issueCost(poolValue, poolQuantity, toQuantity(5))
    expect(issue).toBe(rupees(550))
    poolValue -= issue
    poolQuantity -= toQuantity(5)
    expect(poolQuantity).toBe(15_000)
    expect(poolValue).toBe(rupees(1650))

    // Issue the rest: the cost is the whole remaining value, with no residue.
    const final = issueCost(poolValue, poolQuantity, toQuantity(15))
    expect(final).toBe(rupees(1650))
    poolValue -= final
    poolQuantity -= toQuantity(15)
    expect(poolQuantity).toBe(0)
    expect(poolValue).toBe(0)
  })

  it('rounds a fractional issue to the nearest minor unit', () => {
    // ₹333.33 over 3 units is ₹111.11 each; 2 units cost ₹222.22.
    const cost = issueCost(rupees(33333), toQuantity(3), toQuantity(2))
    expect(cost).toBe(rupees(22222))
  })

  it('issues the entire remaining value when the last stock goes', () => {
    // A pool whose value does not divide evenly must still empty exactly.
    const cost = issueCost(rupees(1000), toQuantity(3), toQuantity(3))
    expect(cost).toBe(rupees(1000))
  })

  it('refuses to issue from an empty pool', () => {
    expect(() => issueCost(0, 0, toQuantity(1))).toThrow(/no stock/i)
  })
})

// ---------------------------------------------------------------------------
// The planner
// ---------------------------------------------------------------------------

describe('planning a receipt', () => {
  it('increases the quantity and the carrying value', () => {
    const purchase = voucher('v1', 'purchase', [line('l1', 10, rupees(100))], [
      { id: 'e1', ledgerId: purchasesLedger.id, debit: rupees(1000), credit: 0 },
      { id: 'e2', ledgerId: 'l-supplier', debit: 0, credit: rupees(1000) },
    ])

    const plan = planInventoryPosting(purchase, context())

    expect(plan.movements).toHaveLength(1)
    expect(plan.movements[0]?.movementType).toBe('receipt')
    expect(plan.movements[0]?.quantityMilli).toBe(10_000)
    expect(plan.movements[0]?.value).toBe(rupees(1000))
    expect(plan.movements[0]?.valuationMethod).toBe('moving-weighted-average')

    const pool = plan.pools.get('i-1')
    expect(pool?.quantityMilli).toBe(10_000)
    expect(pool?.carryingValue).toBe(rupees(1000))
  })

  it('moves the purchase debit to the inventory account', () => {
    const purchase = voucher('v1', 'purchase', [line('l1', 10, rupees(100))], [
      { id: 'e1', ledgerId: purchasesLedger.id, debit: rupees(1000), credit: 0 },
      { id: 'e2', ledgerId: 'l-supplier', debit: 0, credit: rupees(1000) },
    ])

    const plan = planInventoryPosting(purchase, context())

    // The purchase expense is relieved and the inventory asset is debited.
    const purchases = plan.voucher.entries.find(
      (entry) => entry.ledgerId === purchasesLedger.id,
    )
    const inventory = plan.voucher.entries.find((entry) => entry.ledgerId === inventoryLedger.id)
    expect(purchases?.debit).toBe(0)
    expect(inventory?.debit).toBe(rupees(1000))
  })

  it('leaves a service line on the purchase expense', () => {
    const contextWithService = context({
      items: new Map([['i-s', item('i-s', 'Installation', false)]]),
    })
    const service = voucher('v1', 'purchase', [
      { ...line('l1', 2, rupees(500)), itemId: 'i-s' },
    ], [
      { id: 'e1', ledgerId: purchasesLedger.id, debit: rupees(1000), credit: 0 },
      { id: 'e2', ledgerId: 'l-supplier', debit: 0, credit: rupees(1000) },
    ])

    const plan = planInventoryPosting(service, contextWithService)

    expect(plan.movements).toHaveLength(0)
    const purchases = plan.voucher.entries.find(
      (entry) => entry.ledgerId === purchasesLedger.id,
    )
    expect(purchases?.debit).toBe(rupees(1000))
  })

  it('applies a discount to the cost of the stock', () => {
    const purchase = voucher('v1', 'purchase', [line('l1', 10, rupees(100), rupees(100))], [
      { id: 'e1', ledgerId: purchasesLedger.id, debit: rupees(900), credit: 0 },
      { id: 'e2', ledgerId: 'l-supplier', debit: 0, credit: rupees(900) },
    ])

    const plan = planInventoryPosting(purchase, context())

    expect(plan.movements[0]?.value).toBe(rupees(900))
  })
})

describe('planning an issue', () => {
  const pool: StockPool = {
    itemId: 'i-1',
    quantityMilli: 20_000,
    carryingValue: rupees(2200),
    revision: 3,
  }

  it('costs the issue at the moving average and posts cost of goods sold', () => {
    const sale = voucher('v2', 'sales', [line('l1', 5, rupees(150))], [
      { id: 'e1', ledgerId: customerLedger.id, debit: rupees(750), credit: 0 },
      { id: 'e2', ledgerId: salesLedger.id, debit: 0, credit: rupees(750) },
    ])

    const location: LocationBalance = {
      itemId: 'i-1',
      godownId: 'l-god',
      quantityMilli: 20_000,
      revision: 3,
    }

    const plan = planInventoryPosting(
      sale,
      context({
        pools: new Map([['i-1', pool]]),
        locations: new Map([['i-1::l-god', location]]),
      }),
    )

    expect(plan.movements).toHaveLength(1)
    expect(plan.movements[0]?.movementType).toBe('issue')
    expect(plan.movements[0]?.cost).toBe(rupees(550))

    const cogs = plan.voucher.entries.find((entry) => entry.ledgerId === cogsLedger.id)
    const inventory = plan.voucher.entries.find((entry) => entry.ledgerId === inventoryLedger.id)
    expect(cogs?.debit).toBe(rupees(550))
    expect(inventory?.credit).toBe(rupees(550))
  })

  it('refuses an issue larger than the stock on hand', () => {
    const sale = voucher('v2', 'sales', [line('l1', 50, rupees(150))], [
      { id: 'e1', ledgerId: customerLedger.id, debit: rupees(7500), credit: 0 },
      { id: 'e2', ledgerId: salesLedger.id, debit: 0, credit: rupees(7500) },
    ])

    expect(() =>
      planInventoryPosting(sale, context({ pools: new Map([['i-1', pool]]) })),
    ).toThrow(InventoryError)
  })

  it('refuses an issue larger than the stock at that location', () => {
    const sale = voucher('v2', 'sales', [line('l1', 5, rupees(150))], [
      { id: 'e1', ledgerId: customerLedger.id, debit: rupees(750), credit: 0 },
      { id: 'e2', ledgerId: salesLedger.id, debit: 0, credit: rupees(750) },
    ])

    const location: LocationBalance = {
      itemId: 'i-1',
      godownId: 'l-god',
      quantityMilli: 2_000,
      revision: 1,
    }

    expect(() =>
      planInventoryPosting(
        sale,
        context({
          pools: new Map([['i-1', pool]]),
          locations: new Map([['i-1::l-god', location]]),
        }),
      ),
    ).toThrow(InventoryError)
  })
})

describe('planning a transfer', () => {
  it('moves the quantity between locations and leaves the company total alone', () => {
    const pool: StockPool = {
      itemId: 'i-1',
      quantityMilli: 10_000,
      carryingValue: rupees(1000),
      revision: 0,
    }
    const location: LocationBalance = {
      itemId: 'i-1',
      godownId: 'l-god',
      quantityMilli: 10_000,
      revision: 0,
    }

    const journal = voucher('v3', 'stock-journal', [
      { ...line('l1', 4, rupees(100)), toGodownId: 'l-god-2' },
    ])

    const plan = planInventoryPosting(
      journal,
      context({
        pools: new Map([['i-1', pool]]),
        locations: new Map([['i-1::l-god', location]]),
      }),
    )

    expect(plan.movements).toHaveLength(2)
    expect(plan.movements[0]?.movementType).toBe('transfer-out')
    expect(plan.movements[1]?.movementType).toBe('transfer-in')

    // The pool is unchanged: the company still holds the same stock.
    expect(plan.pools.get('i-1')?.quantityMilli).toBe(10_000)
    expect(plan.pools.get('i-1')?.carryingValue).toBe(rupees(1000))
  })
})

describe('replaying the movement ledger', () => {
  it('reproduces the balances from the movements', () => {
    const balances = replayMovements([
      { itemId: 'i-1', godownId: 'l-god', direction: 'in', quantityMilli: 10_000, value: rupees(1000) },
      { itemId: 'i-1', godownId: 'l-god', direction: 'out', quantityMilli: 4_000, value: rupees(400) },
    ])

    const balance = balances.get('i-1::l-god')
    expect(balance?.quantityMilli).toBe(6_000)
    expect(balance?.value).toBe(rupees(600))
  })

  it('reports a difference between the ledger and the stored balance', () => {
    const stored = new Map<string, LocationBalance>([
      ['i-1::l-god', { itemId: 'i-1', godownId: 'l-god', quantityMilli: 6_000, revision: 1 }],
    ])
    const values = new Map([['i-1::l-god', rupees(500)]])

    const discrepancies = reconcileBalances(
      [{ itemId: 'i-1', godownId: 'l-god', direction: 'in', quantityMilli: 10_000, value: rupees(1000) }],
      stored,
      values,
    )

    expect(discrepancies).toHaveLength(1)
    expect(discrepancies[0]?.expectedQuantityMilli).toBe(10_000)
    expect(discrepancies[0]?.actualQuantityMilli).toBe(6_000)
  })

  it('reports nothing when the balances agree', () => {
    const stored = new Map<string, LocationBalance>([
      ['i-1::l-god', { itemId: 'i-1', godownId: 'l-god', quantityMilli: 10_000, revision: 1 }],
    ])
    const values = new Map([['i-1::l-god', rupees(1000)]])

    const discrepancies = reconcileBalances(
      [{ itemId: 'i-1', godownId: 'l-god', direction: 'in', quantityMilli: 10_000, value: rupees(1000) }],
      stored,
      values,
    )

    expect(discrepancies).toHaveLength(0)
  })
})
