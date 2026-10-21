/**
 * The order rules.
 *
 * These are the properties an order must hold whatever the screen does with
 * it: the state is derived, the deliveries never exceed the order, a
 * cancellation cannot erase a delivery, and an amendment keeps the history.
 */

import { describe, expect, it } from 'vitest'

import {
  buildOrder,
  cancelOrder,
  confirmOrder,
  deriveOrderState,
  orderLineTotals,
  prepareOrderAmendment,
  prepareOrderConversion,
  prepareOrderFulfilments,
  OrderError,
  type OrderContext,
} from '@/domain/orders'
import { toQuantity } from '@/domain/quantity'
import type { Item, Order, OrderFulfilment, OrderLine } from '@/domain/types'

const rupees = (amount: number): number => amount * 100

function item(id: string, name: string): Item {
  return {
    id,
    companyId: 'cmp-1',
    name,
    stockGroupId: 'sg-1',
    unitId: 'u-1',
    isInventory: true,
    isService: false,
    purchasePrice: rupees(100),
    salesPrice: rupees(150),
    taxCategoryId: 'tax-cgst',
    hsn: '732690',
    openingQuantityMilli: 0,
    openingValue: 0,
    reorderLevelMilli: 0,
    isActive: true,
    createdAt: '2026-04-01T00:00:00.000Z',
  }
}

const bolt = item('i-1', 'SS 304 Hex Bolt')
const nut = item('i-2', 'Hex Nut M8')

let counter = 0
const nextId = (): string => `id-${++counter}`

function context(): OrderContext {
  return {
    companyId: 'cmp-1',
    items: new Map([
      [bolt.id, bolt],
      [nut.id, nut],
    ]),
    idFactory: nextId,
    now: () => '2026-05-01T00:00:00.000Z',
  }
}

function anOrder(quantity = 10) {
  return buildOrder(
    {
      kind: 'sales',
      partyId: 'l-cus',
      date: '2026-05-01',
      expectedDate: '2026-05-20',
      narration: 'Bolt order',
      lines: [{ itemId: bolt.id, quantityMilli: toQuantity(quantity), rate: rupees(150) }],
    },
    context(),
  )
}

function aFulfilment(
  order: Order,
  line: OrderLine,
  quantityMilli: number,
  voucherId = 'v-1',
  voucherItemId = 'vi-1',
): OrderFulfilment {
  return {
    id: `f-${voucherItemId}`,
    companyId: 'cmp-1',
    orderId: order.id,
    orderLineId: line.id,
    voucherId,
    voucherItemId,
    quantityMilli,
    amount: rupees(150) * (quantityMilli / 1000),
    createdAt: '2026-05-05T00:00:00.000Z',
  }
}

// ---------------------------------------------------------------------------

describe('an order', () => {
  it('is a draft when it is built, and moves no money', () => {
    const { order, lines } = anOrder()
    expect(order.status).toBe('draft')
    expect(order.kind).toBe('sales')
    expect(lines).toHaveLength(1)
    expect(lines[0]?.amount).toBe(rupees(1500))
    expect(lines[0]?.taxCategoryId).toBe('tax-cgst')
  })

  it('refuses a line with no quantity', () => {
    expect(() =>
      buildOrder(
        {
          kind: 'sales',
          partyId: 'l-cus',
          date: '2026-05-01',
          lines: [{ itemId: bolt.id, quantityMilli: 0, rate: rupees(150) }],
        },
        context(),
      ),
    ).toThrow(OrderError)
  })

  it('refuses an order with no party and no lines', () => {
    expect(() =>
      buildOrder(
        { kind: 'sales', partyId: '', date: '2026-05-01', lines: [] },
        context(),
      ),
    ).toThrow(/customer or a supplier/i)
  })
})

describe('the state of an order', () => {
  it('is derived from what has been delivered, never stored', () => {
    const { order, lines } = anOrder()
    expect(deriveOrderState(order, lines, [])).toBe('draft')

    const confirmed = confirmOrder(order, '2026-05-02T00:00:00.000Z')
    expect(confirmed.status).toBe('confirmed')
    expect(deriveOrderState(confirmed, lines, [])).toBe('open')

    const part = aFulfilment(confirmed, lines[0]!, toQuantity(4))
    expect(deriveOrderState(confirmed, lines, [part])).toBe('partially-fulfilled')

    const all = aFulfilment(confirmed, lines[0]!, toQuantity(10), 'v-2', 'vi-2')
    expect(deriveOrderState(confirmed, lines, [part, all])).toBe('fulfilled')
  })

  it('reports the delivered and the remaining quantity of each line', () => {
    const { order, lines } = anOrder()
    const confirmed = confirmOrder(order, '2026-05-02T00:00:00.000Z')
    const totals = orderLineTotals(lines, [aFulfilment(confirmed, lines[0]!, toQuantity(4))])
    const total = totals.get(lines[0]!.id)
    expect(total?.fulfilledMilli).toBe(toQuantity(4))
    expect(total?.remainingMilli).toBe(toQuantity(6))
  })
})

describe('cancelling an order', () => {
  it('is refused when something has already been delivered', () => {
    const { order, lines } = anOrder()
    const confirmed = confirmOrder(order, '2026-05-02T00:00:00.000Z')
    const fulfilments = [aFulfilment(confirmed, lines[0]!, toQuantity(4))]

    expect(() => cancelOrder(confirmed, fulfilments, '2026-05-06T00:00:00.000Z')).toThrow(
      /cannot be cancelled/i,
    )
  })

  it('is allowed when nothing has been delivered', () => {
    const { order } = anOrder()
    const confirmed = confirmOrder(order, '2026-05-02T00:00:00.000Z')
    const cancelled = cancelOrder(confirmed, [], '2026-05-06T00:00:00.000Z')
    expect(cancelled.status).toBe('cancelled')
    expect(deriveOrderState(cancelled, [], [])).toBe('cancelled')
  })
})

describe('amending an order', () => {
  it('needs a reason', () => {
    const { order, lines } = anOrder()
    const confirmed = confirmOrder(order, '2026-05-02T00:00:00.000Z')
    expect(() =>
      prepareOrderAmendment(
        confirmed,
        lines,
        [],
        {
          lines: [{ id: lines[0]!.id, itemId: bolt.id, quantityMilli: toQuantity(12), rate: rupees(150) }],
          reason: '   ',
        },
        context(),
      ),
    ).toThrow(/reason/i)
  })

  it('may not reduce a line below what has been delivered', () => {
    const { order, lines } = anOrder()
    const confirmed = confirmOrder(order, '2026-05-02T00:00:00.000Z')
    const fulfilments = [aFulfilment(confirmed, lines[0]!, toQuantity(6))]

    expect(() =>
      prepareOrderAmendment(
        confirmed,
        lines,
        fulfilments,
        {
          lines: [{ id: lines[0]!.id, itemId: bolt.id, quantityMilli: toQuantity(4), rate: rupees(150) }],
          reason: 'The customer reduced the order',
        },
        context(),
      ),
    ).toThrow(/below the quantity already delivered/i)
  })

  it('may not remove a line that has been delivered', () => {
    const { order, lines } = anOrder()
    const confirmed = confirmOrder(order, '2026-05-02T00:00:00.000Z')
    const fulfilments = [aFulfilment(confirmed, lines[0]!, toQuantity(2))]

    expect(() =>
      prepareOrderAmendment(
        confirmed,
        lines,
        fulfilments,
        { lines: [], reason: 'Changed our mind' },
        context(),
      ),
    ).toThrow(OrderError)
  })

  it('keeps the previous lines so that the history is not a deletion', () => {
    const { order, lines } = anOrder()
    const confirmed = confirmOrder(order, '2026-05-02T00:00:00.000Z')

    const amendment = prepareOrderAmendment(
      confirmed,
      lines,
      [],
      {
        lines: [{ id: lines[0]!.id, itemId: bolt.id, quantityMilli: toQuantity(12), rate: rupees(160) }],
        reason: 'The customer added ten more',
      },
      context(),
    )

    expect(amendment.order.revision).toBe(confirmed.revision + 1)
    expect(amendment.lines[0]?.quantityMilli).toBe(toQuantity(12))
    expect(amendment.lines[0]?.amount).toBe(rupees(1920))
    // The previous lines are what the history keeps.
    expect(amendment.previousLines[0]?.quantityMilli).toBe(toQuantity(10))
    expect(amendment.previousLines[0]?.rate).toBe(rupees(150))
  })
})

describe('turning an order into an invoice', () => {
  it('carries the party, the items, the remaining quantity and the tax across', () => {
    const { order, lines } = anOrder()
    const confirmed = confirmOrder(order, '2026-05-02T00:00:00.000Z')

    const draft = prepareOrderConversion(confirmed, lines, [], {
      ...context(),
      today: '2026-05-04',
    })

    expect(draft.type).toBe('sales')
    expect(draft.partyId).toBe('l-cus')
    expect(draft.date).toBe('2026-05-04')
    expect(draft.items).toHaveLength(1)
    expect(draft.items[0]?.quantityMilli).toBe(toQuantity(10))
    expect(draft.items[0]?.rate).toBe(rupees(150))
    expect(draft.items[0]?.taxCategoryId).toBe('tax-cgst')
    // The line says which order line it fulfils.
    expect(draft.items[0]?.orderLineId).toBe(lines[0]!.id)
  })

  it('carries only what is left to deliver', () => {
    const { order, lines } = anOrder()
    const confirmed = confirmOrder(order, '2026-05-02T00:00:00.000Z')
    const fulfilments = [aFulfilment(confirmed, lines[0]!, toQuantity(4))]

    const draft = prepareOrderConversion(confirmed, lines, fulfilments, {
      ...context(),
      today: '2026-05-04',
    })
    expect(draft.items[0]?.quantityMilli).toBe(toQuantity(6))
  })

  it('refuses an order that has nothing left', () => {
    const { order, lines } = anOrder()
    const confirmed = confirmOrder(order, '2026-05-02T00:00:00.000Z')
    const fulfilments = [aFulfilment(confirmed, lines[0]!, toQuantity(10))]

    expect(() =>
      prepareOrderConversion(confirmed, lines, fulfilments, {
        ...context(),
        today: '2026-05-04',
      }),
    ).toThrow(/already been delivered/i)
  })

  it('refuses a draft order', () => {
    const { order, lines } = anOrder()
    expect(() =>
      prepareOrderConversion(order, lines, [], { ...context(), today: '2026-05-04' }),
    ).toThrow(/Confirm the order/i)
  })
})

describe('recording a delivery', () => {
  it('refuses to deliver more than the order remains', () => {
    const { order, lines } = anOrder()
    const confirmed = confirmOrder(order, '2026-05-02T00:00:00.000Z')

    expect(() =>
      prepareOrderFulfilments(
        [{ id: 'vi-1', itemId: bolt.id, quantityMilli: toQuantity(12), amount: rupees(1800), orderLineId: lines[0]!.id }],
        confirmed,
        lines,
        [],
        context(),
      ),
    ).toThrow(/more than the order remains/i)
  })

  it('refuses a line that names a line of another order', () => {
    const { order, lines } = anOrder()
    const confirmed = confirmOrder(order, '2026-05-02T00:00:00.000Z')
    const other = { ...lines[0]!, orderId: 'another-order' }

    expect(() =>
      prepareOrderFulfilments(
        [{ id: 'vi-1', itemId: bolt.id, quantityMilli: toQuantity(2), amount: rupees(300), orderLineId: lines[0]!.id }],
        confirmed,
        [other],
        [],
        context(),
      ),
    ).toThrow(/another order/i)
  })

  it('records the delivery against the order line', () => {
    const { order, lines } = anOrder()
    const confirmed = confirmOrder(order, '2026-05-02T00:00:00.000Z')

    const fulfilments = prepareOrderFulfilments(
      [{ id: 'vi-1', itemId: bolt.id, quantityMilli: toQuantity(4), amount: rupees(600), orderLineId: lines[0]!.id }],
      confirmed,
      lines,
      [],
      context(),
    )

    expect(fulfilments).toHaveLength(1)
    expect(fulfilments[0]?.orderLineId).toBe(lines[0]!.id)
    expect(fulfilments[0]?.quantityMilli).toBe(toQuantity(4))
    expect(fulfilments[0]?.amount).toBe(rupees(600))
  })

  it('counts the deliveries already made when the remaining is checked', () => {
    const { order, lines } = anOrder()
    const confirmed = confirmOrder(order, '2026-05-02T00:00:00.000Z')
    const existing = [aFulfilment(confirmed, lines[0]!, toQuantity(8))]

    expect(() =>
      prepareOrderFulfilments(
        [{ id: 'vi-2', itemId: bolt.id, quantityMilli: toQuantity(4), amount: rupees(600), orderLineId: lines[0]!.id }],
        confirmed,
        lines,
        existing,
        context(),
      ),
    ).toThrow(/more than the order remains/i)
  })
})
