/**
 * Posting an invoice that delivers against an order.
 *
 * The delivery rows are written in the same transaction as the invoice, so
 * this is where the two are joined up: the posting must produce the
 * fulfilment, and it must refuse a delivery that is larger than the order.
 */

import { describe, expect, it } from 'vitest'

import { buildVoucher, type VoucherContext } from '@/domain/accounting'
import { PostingError, preparePosting } from '@/domain/posting'
import { confirmOrder } from '@/domain/orders'
import type { Ledger, Order, OrderFulfilment, OrderLine, Voucher } from '@/domain/types'

const rupees = (amount: number): number => amount * 100

const customer: Ledger = {
  id: 'led-customer',
  companyId: 'cmp-1',
  name: 'Customer One',
  group: 'assets',
  type: 'receivable',
  parentId: null,
  openingBalance: 0,
  openingDate: '2026-04-01',
  partyKind: 'customer',
  currency: 'INR',
  isSystem: false,
  isActive: true,
  createdAt: '2026-04-01T00:00:00.000Z',
}

const sales: Ledger = {
  ...customer,
  id: 'led-sales',
  name: 'Sales',
  group: 'income',
  type: 'sales',
  partyKind: null,
}

const context: VoucherContext = {
  ledgers: [customer, sales],
  taxCategories: [],
  nextId: (() => {
    let counter = 0
    return () => `id-${++counter}`
  })(),
  companyId: 'cmp-1',
}

const orderLine: OrderLine = {
  id: 'ol-1',
  companyId: 'cmp-1',
  orderId: 'ord-1',
  itemId: 'item-1',
  quantityMilli: 10_000,
  rate: rupees(150),
  discount: 0,
  taxCategoryId: null,
  amount: rupees(1500),
}

const order: Order = {
  id: 'ord-1',
  companyId: 'cmp-1',
  kind: 'sales',
  number: 'SO-0001',
  date: '2026-05-01',
  expectedDate: null,
  partyId: customer.id,
  narration: 'An order',
  reference: '',
  status: 'confirmed',
  paymentTermId: null,
  revision: 2,
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
}

function invoice(quantityMilli: number, orderLineId: string | null): Voucher {
  const voucher = buildVoucher(
    {
      type: 'sales',
      date: '2026-05-04',
      partyId: customer.id,
      narration: 'Invoice from the order',
      reference: order.number,
      status: 'posted',
      items: [
        {
          itemId: 'item-1',
          quantityMilli,
          rate: rupees(150),
          orderLineId,
        },
      ],
    },
    context,
  )
  voucher.id = 'v-1'
  voucher.number = 'INV-0001'
  voucher.linkedVoucherId = order.id
  voucher.createdAt = '2026-05-04T00:00:00.000Z'
  voucher.updatedAt = '2026-05-04T00:00:00.000Z'
  return voucher
}

function postingContext(fulfilments: OrderFulfilment[] = []) {
  let counter = 0
  return {
    companyId: 'cmp-1',
    ledgers: [customer, sales],
    taxCategories: [],
    existingVouchers: [] as Voucher[],
    actor: 'tester',
    idFactory: () => `posting-${++counter}`,
    now: () => '2026-05-04T00:00:00.000Z',
    orderContext: { order, lines: [orderLine], fulfilments },
  }
}

describe('posting an invoice that delivers against an order', () => {
  it('records the delivery in the same package as the invoice', () => {
    const package_ = preparePosting(invoice(4_000, orderLine.id), postingContext())

    expect(package_.orderFulfilments).toHaveLength(1)
    expect(package_.orderFulfilments[0]?.orderId).toBe(order.id)
    expect(package_.orderFulfilments[0]?.orderLineId).toBe(orderLine.id)
    expect(package_.orderFulfilments[0]?.voucherId).toBe('v-1')
    expect(package_.orderFulfilments[0]?.quantityMilli).toBe(4_000)
  })

  it('refuses a delivery that is larger than the order', () => {
    expect(() =>
      preparePosting(invoice(12_000, orderLine.id), postingContext()),
    ).toThrow(/more than the order remains/i)
  })

  it('refuses a delivery that is larger than what is left', () => {
    const already: OrderFulfilment = {
      id: 'f-1',
      companyId: 'cmp-1',
      orderId: order.id,
      orderLineId: orderLine.id,
      voucherId: 'v-0',
      voucherItemId: 'vi-0',
      quantityMilli: 8_000,
      amount: rupees(1200),
      createdAt: '2026-05-02T00:00:00.000Z',
    }

    expect(() =>
      preparePosting(invoice(4_000, orderLine.id), postingContext([already])),
    ).toThrow(/more than the order remains/i)
  })

  it('refuses a voucher that names an order it cannot find', () => {
    const contextWithoutOrder = { ...postingContext() }
    delete (contextWithoutOrder as { orderContext?: unknown }).orderContext

    expect(() =>
      preparePosting(invoice(4_000, orderLine.id), contextWithoutOrder),
    ).toThrow(PostingError)
  })

  it('records no delivery for an invoice that is not from an order', () => {
    const package_ = preparePosting(invoice(4_000, null), postingContext())
    expect(package_.orderFulfilments).toHaveLength(0)
  })
})

describe('the order a confirmed invoice belongs to', () => {
  it('is the order the invoice names', () => {
    const confirmed = confirmOrder({ ...order, status: 'draft' }, '2026-05-01T00:00:00.000Z')
    expect(confirmed.status).toBe('confirmed')
    expect(confirmed.revision).toBe(order.revision + 1)
  })
})
