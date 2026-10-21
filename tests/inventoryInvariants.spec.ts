/**
 * Accounting invariants for the inventory engine.
 *
 * These are properties that must hold for every voucher the inventory layer
 * touches, not worked examples. A costing engine that produces a balanced but
 * wrong voucher is worse than one that fails loudly, so each rule below is
 * checked as an assertion over the posting itself.
 *
 * The rules are:
 *
 *  1. Every planned voucher balances: debits equal credits.
 *  2. The inventory asset in the general ledger equals the carrying value of
 *     the stock pools, always.
 *  3. A stock purchase is never booked twice: the purchase expense is relieved
 *     and the inventory asset is debited once.
 *  4. A sales return unwinds the profit effect of the sale it reverses, at the
 *     cost recorded on the original issue.
 *  5. A purchase return relieves stock at the current average and posts the
 *     difference to the variance account; the two are never forced to match.
 *  6. A count variance goes to the variance account, never to cost of goods
 *     sold.
 *  7. A transfer moves stock without touching revenue or expense.
 */

import { describe, expect, it } from 'vitest'

import { buildVoucher, type VoucherContext } from '@/domain/accounting'
import {
  InventoryError,
  planInventoryPosting,
  planStockReversal,
  type InventoryContext,
  type LocationBalance,
  type PlannedMovement,
  type StockPool,
} from '@/domain/inventory'
import { prepareCancellation } from '@/domain/posting'
import { toQuantity } from '@/domain/quantity'
import type { Item, Ledger, StockMovement, Voucher, VoucherEntry } from '@/domain/types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const rupees = (amount: number): number => amount * 100
const companyId = 'cmp-1'
const godownId = 'g-1'

let counter = 0
const nextId = (): string => `id-${++counter}`

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
    isSystem: true,
    isActive: true,
    createdAt: '2026-04-01T00:00:00.000Z',
  }
}

const inventoryLedger = ledger('l-inv', 'Inventory', 'assets', 'inventory')
const cogsLedger = ledger('l-cogs', 'Cost of goods sold', 'expenses', 'expenses')
const varianceLedger = ledger('l-var', 'Stock variance', 'expenses', 'expenses')
const purchasesLedger = ledger('l-pur', 'Purchases', 'expenses', 'purchase')
const salesLedger = ledger('l-sal', 'Sales', 'income', 'sales')
const supplierLedger = ledger('l-sup', 'Sundar Suppliers', 'liabilities', 'payable')
const customerLedger = ledger('l-cus', 'Asha Traders', 'assets', 'receivable')

const ledgers = [
  inventoryLedger,
  cogsLedger,
  varianceLedger,
  purchasesLedger,
  salesLedger,
  supplierLedger,
  customerLedger,
]

function item(id: string, name: string): Item {
  return {
    id,
    companyId,
    name,
    stockGroupId: 'sg-1',
    unitId: 'u-1',
    isInventory: true,
    isService: false,
    purchasePrice: rupees(100),
    salesPrice: rupees(150),
    taxCategoryId: null,
    hsn: '732690',
    openingQuantityMilli: 0,
    openingValue: 0,
    reorderLevelMilli: 0,
    isActive: true,
    createdAt: '2026-04-01T00:00:00.000Z',
  }
}

const bolt = item('i-1', 'SS 304 Hex Bolt')

function voucherContext(): VoucherContext {
  return {
    companyId,
    ledgers,
    taxCategories: [],
    nextId,
    supply: 'intra',
  }
}

// ---------------------------------------------------------------------------
// A tiny posting harness
// ---------------------------------------------------------------------------

interface State {
  pools: Map<string, StockPool>
  locations: Map<string, LocationBalance>
  movements: StockMovement[]
  entries: VoucherEntry[]
}

function freshState(): State {
  return {
    pools: new Map<string, StockPool>(),
    locations: new Map<string, LocationBalance>(),
    movements: [],
    entries: [],
  }
}

function toStockMovement(movement: PlannedMovement): StockMovement {
  return { ...movement, voucherNumber: '' }
}

function inventoryContext(state: State): InventoryContext {
  return {
    companyId,
    accounts: {
      inventory: inventoryLedger,
      cogs: cogsLedger,
      variance: varianceLedger,
      purchases: purchasesLedger,
      inputTaxRecoverable: true,
    },
    items: new Map([[bolt.id, bolt]]),
    pools: state.pools,
    locations: state.locations,
    movements: state.movements,
    idFactory: nextId,
    now: () => '2026-05-01T00:00:00.000Z',
  }
}

function post(voucher: Voucher, state: State): Voucher {
  const plan = planInventoryPosting(voucher, inventoryContext(state))
  state.pools = plan.pools
  state.locations = plan.locations
  state.movements.push(...plan.movements.map(toStockMovement))
  state.entries.push(...plan.voucher.entries)
  return plan.voucher
}

/** The balance of one ledger, debits positive and credits negative. */
function balance(state: State, ledgerId: string): number {
  return state.entries
    .filter((entry) => entry.ledgerId === ledgerId)
    .reduce((sum, entry) => sum + entry.debit - entry.credit, 0)
}

/** The carrying value of every pool. */
function poolValue(state: State): number {
  return [...state.pools.values()].reduce((sum, pool) => sum + pool.carryingValue, 0)
}

function assertBalanced(voucher: Voucher): void {
  const debit = voucher.entries.reduce((sum, entry) => sum + entry.debit, 0)
  const credit = voucher.entries.reduce((sum, entry) => sum + entry.credit, 0)
  expect(credit).toBe(debit)
}

/** The inventory asset must always equal the value of the stock on hand. */
function assertInventoryAgreesWithStock(state: State): void {
  expect(balance(state, inventoryLedger.id)).toBe(poolValue(state))
}

// ---------------------------------------------------------------------------
// Voucher builders
// ---------------------------------------------------------------------------

function purchase(quantity: number, rate: number, date = '2026-05-01'): Voucher {
  return buildVoucher(
    {
      type: 'purchase',
      date,
      partyId: supplierLedger.id,
      narration: 'Stock received',
      reference: '',
      status: 'posted',
      items: [
        { itemId: bolt.id, quantityMilli: toQuantity(quantity), rate, godownId },
      ],
    },
    voucherContext(),
  )
}

function sale(quantity: number, rate: number, date = '2026-05-02'): Voucher {
  return buildVoucher(
    {
      type: 'sales',
      date,
      partyId: customerLedger.id,
      narration: 'Stock sold',
      reference: '',
      status: 'posted',
      items: [
        { itemId: bolt.id, quantityMilli: toQuantity(quantity), rate, godownId },
      ],
    },
    voucherContext(),
  )
}

function creditNote(quantity: number, rate: number, linkedTo: string | null): Voucher {
  const voucher = buildVoucher(
    {
      type: 'credit-note',
      date: '2026-05-05',
      partyId: customerLedger.id,
      narration: 'Goods returned by the customer',
      reference: '',
      status: 'posted',
      items: [
        { itemId: bolt.id, quantityMilli: toQuantity(quantity), rate, godownId },
      ],
    },
    voucherContext(),
  )
  voucher.linkedVoucherId = linkedTo
  return voucher
}

function debitNote(quantity: number, rate: number): Voucher {
  return buildVoucher(
    {
      type: 'debit-note',
      date: '2026-05-06',
      partyId: supplierLedger.id,
      narration: 'Goods returned to the supplier',
      reference: '',
      status: 'posted',
      items: [
        { itemId: bolt.id, quantityMilli: toQuantity(quantity), rate, godownId },
      ],
    },
    voucherContext(),
  )
}

function stockJournal(quantity: number, rate: number, to?: string): Voucher {
  return buildVoucher(
    {
      type: 'stock-journal',
      date: '2026-05-07',
      partyId: null,
      narration: 'Stock counted',
      reference: '',
      status: 'posted',
      items: [
        {
          itemId: bolt.id,
          quantityMilli: toQuantity(quantity),
          rate,
          godownId,
          toGodownId: to ?? null,
        },
      ],
    },
    voucherContext(),
  )
}

// ---------------------------------------------------------------------------
// Rule 1 and 2 — every posting balances, and the ledger agrees with the stock
// ---------------------------------------------------------------------------

describe('every inventory posting balances', () => {
  it('balances a purchase, a sale, a sales return and a purchase return', () => {
    const state = freshState()

    assertBalanced(post(purchase(10, rupees(100)), state))
    assertBalanced(post(sale(4, rupees(150)), state))
    assertBalanced(post(creditNote(4, rupees(150), null), state))
    assertBalanced(post(debitNote(2, rupees(100)), state))

    assertInventoryAgreesWithStock(state)
  })

  it('balances a count adjustment in both directions', () => {
    const state = freshState()

    post(purchase(10, rupees(100)), state)
    assertBalanced(post(stockJournal(-1, rupees(100)), state))
    assertBalanced(post(stockJournal(2, rupees(100)), state))

    assertInventoryAgreesWithStock(state)
  })

  it('balances a transfer between two locations', () => {
    const state = freshState()

    post(purchase(10, rupees(100)), state)
    assertBalanced(post(stockJournal(4, rupees(100), 'g-2'), state))

    assertInventoryAgreesWithStock(state)
  })

  it('leaves the ledger agreeing with the stock after every posting', () => {
    const state = freshState()

    const postings: Array<[string, Voucher]> = [
      ['purchase', purchase(10, rupees(100))],
      ['purchase', purchase(10, rupees(120), '2026-05-03')],
      ['sale', sale(5, rupees(150), '2026-05-04')],
      ['sale', sale(3, rupees(150), '2026-05-05')],
      ['credit note', creditNote(3, rupees(150), null)],
      ['purchase return', debitNote(2, rupees(100))],
      ['adjustment', stockJournal(1, rupees(100))],
      ['adjustment out', stockJournal(-1, rupees(100))],
    ]

    for (const [label, voucher] of postings) {
      post(voucher, state)
      expect(label).toBe(label)
      expect(balance(state, inventoryLedger.id)).toBe(poolValue(state))
    }
  })
})

// ---------------------------------------------------------------------------
// Rule 3 — a stock purchase is never booked twice
// ---------------------------------------------------------------------------

describe('a stock purchase', () => {
  it('relieves the purchase expense and debits the inventory asset once', () => {
    const state = freshState()

    const posted = post(purchase(10, rupees(100)), state)

    expect(balance(state, purchasesLedger.id)).toBe(0)
    expect(balance(state, inventoryLedger.id)).toBe(rupees(1000))
    assertBalanced(posted)
  })

  it('keeps a service line on the purchase expense', () => {
    const state = freshState()
    const service = buildVoucher(
      {
        type: 'purchase',
        date: '2026-05-01',
        partyId: supplierLedger.id,
        narration: 'Installation',
        reference: '',
        status: 'posted',
        items: [
          { itemId: 'i-service', quantityMilli: toQuantity(1), rate: rupees(500) },
        ],
      },
      voucherContext(),
    )

    const context: InventoryContext = {
      companyId,
      accounts: {
        inventory: inventoryLedger,
        cogs: cogsLedger,
        variance: varianceLedger,
        purchases: purchasesLedger,
        inputTaxRecoverable: true,
      },
      items: new Map([['i-service', { ...bolt, id: 'i-service', isInventory: false }]]),
      pools: state.pools,
      locations: state.locations,
      idFactory: nextId,
      now: () => '2026-05-01T00:00:00.000Z',
    }
    const plan = planInventoryPosting(service, context)

    const purchases = plan.voucher.entries.find(
      (entry) => entry.ledgerId === purchasesLedger.id,
    )
    expect(purchases?.debit).toBe(rupees(500))
    expect(plan.movements).toHaveLength(0)
  })

  it('capitalises a directly attributable acquisition cost into the stock', () => {
    const state = freshState()
    const withFreight = buildVoucher(
      {
        type: 'purchase',
        date: '2026-05-01',
        partyId: supplierLedger.id,
        narration: 'Stock with freight',
        reference: '',
        status: 'posted',
        items: [
          {
            itemId: bolt.id,
            quantityMilli: toQuantity(10),
            rate: rupees(100),
            directCost: rupees(50),
            godownId,
          },
        ],
      },
      voucherContext(),
    )

    const posted = post(withFreight, state)

    expect(state.movements[0]?.value).toBe(rupees(1050))
    expect(balance(state, inventoryLedger.id)).toBe(rupees(1050))
    assertBalanced(posted)
  })
})

// ---------------------------------------------------------------------------
// Rule 4 — a sales return unwinds the profit effect of the sale
// ---------------------------------------------------------------------------

describe('a sales return', () => {
  it('unwinds the sale exactly when the average has not moved', () => {
    const state = freshState()

    post(purchase(5, rupees(100)), state)
    const sold = post(sale(5, rupees(150)), state)
    const returned = post(creditNote(5, rupees(150), sold.id), state)

    // The revenue is reversed and the cost of goods sold with it.
    expect(balance(state, salesLedger.id)).toBe(0)
    expect(balance(state, cogsLedger.id)).toBe(0)
    // The stock is back and the inventory asset is whole.
    expect(balance(state, inventoryLedger.id)).toBe(rupees(500))
    expect(state.pools.get(bolt.id)?.quantityMilli).toBe(5_000)
    assertBalanced(returned)
    assertInventoryAgreesWithStock(state)
  })

  it('reverses the cost recorded on the original issue, not today\'s average', () => {
    const state = freshState()

    // Buy 10 at 100 and sell them all: the issue cost is 1,000.
    post(purchase(10, rupees(100)), state)
    const sold = post(sale(10, rupees(150)), state)
    expect(state.movements[1]?.cost).toBe(rupees(1000))

    // The price has moved since: the stock now costs 200 a unit.
    post(purchase(10, rupees(200), '2026-05-04'), state)

    // The return is valued at the original issue cost, so the profit of the
    // original sale is unwound exactly rather than at today's average.
    const returned = post(creditNote(10, rupees(150), sold.id), state)

    const returnIn = state.movements[state.movements.length - 1]
    expect(returnIn?.movementType).toBe('return-in')
    expect(returnIn?.value).toBe(rupees(1000))
    expect(returnIn?.reversesMovementId).toBe(state.movements[1]?.id)

    expect(balance(state, salesLedger.id)).toBe(0)
    expect(balance(state, cogsLedger.id)).toBe(0)
    assertBalanced(returned)
    assertInventoryAgreesWithStock(state)
  })

  it('refuses a return larger than the quantity that was sold', () => {
    const state = freshState()

    post(purchase(10, rupees(100)), state)
    const sold = post(sale(5, rupees(150)), state)

    expect(() => post(creditNote(6, rupees(150), sold.id), state)).toThrow(InventoryError)
  })

  it('refuses a return of an item that was never sold', () => {
    const state = freshState()

    post(purchase(10, rupees(100)), state)

    expect(() => post(creditNote(1, rupees(150), null), state)).toThrow(/no sale/i)
  })
})

// ---------------------------------------------------------------------------
// Rule 5 — a purchase return
// ---------------------------------------------------------------------------

describe('a purchase return', () => {
  it('relieves the stock at the current average and posts the difference', () => {
    const state = freshState()

    // Buy 10 at 100, then 10 at 120: the average is 110.
    post(purchase(10, rupees(100)), state)
    post(purchase(10, rupees(120), '2026-05-03'), state)

    // Return 10 units to the supplier. The invoice value is 1,000 but the
    // stock leaves at the current average of 1,100, so the company gives up
    // 100 more than the supplier credited.
    const returned = post(debitNote(10, rupees(100)), state)

    expect(balance(state, inventoryLedger.id)).toBe(rupees(1100))
    expect(balance(state, varianceLedger.id)).toBe(rupees(100))
    expect(balance(state, purchasesLedger.id)).toBe(0)
    assertBalanced(returned)
    assertInventoryAgreesWithStock(state)
  })

  it('never forces the invoice amount and the carrying value to match', () => {
    const state = freshState()

    post(purchase(10, rupees(100)), state)
    post(purchase(10, rupees(120), '2026-05-03'), state)

    const returned = post(debitNote(5, rupees(100)), state)

    // Half the stock leaves at 1,100 and the invoice says 500. The two are
    // kept apart, and the difference is on the variance account.
    expect(balance(state, inventoryLedger.id)).toBe(rupees(1650))
    expect(balance(state, varianceLedger.id)).toBe(rupees(50))
    assertBalanced(returned)
  })
})

// ---------------------------------------------------------------------------
// Rule 6 — a count variance is a variance, not cost of goods sold
// ---------------------------------------------------------------------------

describe('a count variance', () => {
  it('posts a shortage to the variance account, not to cost of goods sold', () => {
    const state = freshState()

    post(purchase(10, rupees(100)), state)
    const counted = post(stockJournal(-2, rupees(100)), state)

    expect(balance(state, varianceLedger.id)).toBe(rupees(200))
    expect(balance(state, cogsLedger.id)).toBe(0)
    expect(balance(state, inventoryLedger.id)).toBe(rupees(800))
    assertBalanced(counted)
    assertInventoryAgreesWithStock(state)
  })

  it('posts a surplus to the variance account, not to cost of goods sold', () => {
    const state = freshState()

    post(purchase(10, rupees(100)), state)
    const counted = post(stockJournal(2, rupees(100)), state)

    expect(balance(state, varianceLedger.id)).toBe(-rupees(200))
    expect(balance(state, cogsLedger.id)).toBe(0)
    expect(balance(state, inventoryLedger.id)).toBe(rupees(1200))
    assertBalanced(counted)
    assertInventoryAgreesWithStock(state)
  })
})

// ---------------------------------------------------------------------------
// Rule 7 — a transfer moves stock and nothing else
// ---------------------------------------------------------------------------

describe('a transfer', () => {
  it('moves the stock without touching revenue, expense or the company total', () => {
    const state = freshState()

    post(purchase(10, rupees(100)), state)
    const moved = post(stockJournal(4, rupees(100), 'g-2'), state)

    expect(state.pools.get(bolt.id)?.quantityMilli).toBe(10_000)
    expect(state.pools.get(bolt.id)?.carryingValue).toBe(rupees(1000))
    expect(balance(state, inventoryLedger.id)).toBe(rupees(1000))
    expect(balance(state, cogsLedger.id)).toBe(0)
    expect(balance(state, varianceLedger.id)).toBe(0)
    expect(moved.entries).toHaveLength(0)
    assertInventoryAgreesWithStock(state)
  })
})

// ---------------------------------------------------------------------------
// Cancelling a posted voucher gives the stock back
// ---------------------------------------------------------------------------

describe('cancelling a posted voucher', () => {
  it('gives the stock back with a compensating movement', () => {
    const state = freshState()

    const bought = post(purchase(10, rupees(100)), state)
    expect(state.pools.get(bolt.id)?.quantityMilli).toBe(10_000)

    const reversal = planStockReversal(bought, inventoryContext(state))

    expect(reversal.movements).toHaveLength(1)
    expect(reversal.movements[0]?.movementType).toBe('reversal-out')
    expect(reversal.movements[0]?.direction).toBe('out')
    expect(reversal.movements[0]?.value).toBe(rupees(1000))
    expect(reversal.movements[0]?.reversesMovementId).toBe(state.movements[0]?.id)

    // The stock and its value are back where they were.
    expect(reversal.pools.get(bolt.id)?.quantityMilli).toBe(0)
    expect(reversal.pools.get(bolt.id)?.carryingValue).toBe(0)
  })

  it('gives the stock back through the cancellation path', () => {
    const state = freshState()

    const bought = post(purchase(10, rupees(100)), state)
    const cancelled = prepareCancellation(bought, {
      companyId,
      ledgers,
      taxCategories: [],
      existingVouchers: [bought],
      idFactory: nextId,
      now: () => '2026-05-08T00:00:00.000Z',
      actor: 'local.operator',
      inventory: inventoryContext(state),
    })

    expect(cancelled.voucher.status).toBe('cancelled')
    expect(cancelled.movements).toHaveLength(1)
    expect(cancelled.movements[0]?.movementType).toBe('reversal-out')
    expect(
      cancelled.stockPools.find((pool) => pool.itemId === bolt.id)?.quantityMilli,
    ).toBe(0)
    expect(
      cancelled.stockPools.find((pool) => pool.itemId === bolt.id)?.carryingValue,
    ).toBe(0)
  })

  it('refuses a cancellation that would change a cost already reported', () => {
    const state = freshState()

    const bought = post(purchase(10, rupees(100)), state)
    // The item moves on, so the cost of what is left is no longer what it was.
    post(purchase(10, rupees(200), '2026-05-03'), state)

    expect(() => planStockReversal(bought, inventoryContext(state))).toThrow(InventoryError)
    expect(() => planStockReversal(bought, inventoryContext(state))).toThrow(
      /has been moved on since/i,
    )
  })

  it('leaves a voucher that moved no stock alone', () => {
    const state = freshState()

    const bought = post(purchase(10, rupees(100)), state)
    const reversal = planStockReversal(
      { ...bought, id: 'v-other' },
      inventoryContext(state),
    )

    expect(reversal.movements).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// The planner must not change the voucher it was given
// ---------------------------------------------------------------------------

describe('planning is free of side effects', () => {
  it('does not change the entries of the voucher it was handed', () => {
    const state = freshState()
    const original = purchase(10, rupees(100))
    const before = original.entries.map((entry) => ({ ...entry }))

    post(original, state)

    expect(original.entries).toEqual(before)
  })

  it('produces the same plan when it is run twice', () => {
    const state = freshState()
    const original = purchase(10, rupees(100))

    const first = post(original, state)
    const second = planInventoryPosting(original, {
      companyId,
      accounts: {
        inventory: inventoryLedger,
        cogs: cogsLedger,
        variance: varianceLedger,
        purchases: purchasesLedger,
        inputTaxRecoverable: true,
      },
      items: new Map([[bolt.id, bolt]]),
      pools: state.pools,
      locations: state.locations,
      idFactory: nextId,
      now: () => '2026-05-01T00:00:00.000Z',
    })

    const firstInventory = first.entries.find((entry) => entry.ledgerId === inventoryLedger.id)
    const secondInventory = second.voucher.entries.find(
      (entry) => entry.ledgerId === inventoryLedger.id,
    )
    expect(secondInventory?.debit).toBe(firstInventory?.debit)
    expect(
      first.entries.find((entry) => entry.ledgerId === purchasesLedger.id)?.debit,
    ).toBe(second.voucher.entries.find((entry) => entry.ledgerId === purchasesLedger.id)?.debit)
  })
})
