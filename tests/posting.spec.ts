import { describe, expect, it } from 'vitest'

import { buildVoucher, type VoucherContext } from '@/domain/accounting'
import { PostingError, preparePosting } from '@/domain/posting'
import type { Ledger, TaxCategory, Voucher } from '@/domain/types'

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

const taxCategories: TaxCategory[] = []

const context: VoucherContext = {
  ledgers: [customer, sales],
  taxCategories,
  nextId: (() => {
    let counter = 0
    return () => `id-${++counter}`
  })(),
  companyId: 'cmp-1',
}

function sale(date: string): Voucher {
  const voucher = buildVoucher(
    {
      type: 'sales',
      date,
      partyId: customer.id,
      narration: 'Test sale',
      reference: '',
      status: 'posted',
      items: [{ itemId: 'item-1', quantityMilli: 1_000, rate: 100_000 }],
    },
    context,
  )
  voucher.id = 'v1'
  voucher.number = 'INV-0001'
  voucher.createdAt = `${date}T00:00:00.000Z`
  voucher.updatedAt = `${date}T00:00:00.000Z`
  return voucher
}

function postingContext(closedPeriods: Array<{ from: string; to: string; label: string }>) {
  let counter = 0
  return {
    companyId: 'cmp-1',
    ledgers: [customer, sales],
    taxCategories,
    existingVouchers: [] as Voucher[],
    closedPeriods,
    actor: 'tester',
    idFactory: () => `posting-${++counter}`,
    now: () => '2026-05-01T00:00:00.000Z',
  }
}

describe('preparing a posting', () => {
  it('refuses a voucher dated inside a closed period', () => {
    const closed = [{ from: '2025-04-01', to: '2026-03-31', label: 'Financial year 2025-26' }]

    expect(() => preparePosting(sale('2026-01-15'), postingContext(closed))).toThrow(PostingError)
  })

  it('names the closed period in the problem it reports', () => {
    const closed = [{ from: '2025-04-01', to: '2026-03-31', label: 'Financial year 2025-26' }]

    try {
      preparePosting(sale('2026-01-15'), postingContext(closed))
      expect.unreachable('the posting should have been refused')
    } catch (error) {
      expect(error).toBeInstanceOf(PostingError)
      expect((error as PostingError).issues[0]?.message).toContain('2025-26')
    }
  })

  it('allows a voucher in an open period', () => {
    const closed = [{ from: '2025-04-01', to: '2026-03-31', label: 'Financial year 2025-26' }]

    const package_ = preparePosting(sale('2026-05-04'), postingContext(closed))

    expect(package_.voucher.status).toBe('posted')
    expect(package_.entries.length).toBeGreaterThan(0)
    expect(package_.auditEvents).toHaveLength(1)
  })

  it('refuses a voucher that does not balance', () => {
    const broken = sale('2026-05-04')
    broken.entries = [
      { id: 'e1', ledgerId: customer.id, debit: 100_000, credit: 0 },
      { id: 'e2', ledgerId: sales.id, debit: 0, credit: 90_000 },
    ]

    expect(() => preparePosting(broken, postingContext([]))).toThrow(PostingError)
  })

  it('keeps the invoice terms on the posted voucher', () => {
    const withTerms = sale('2026-05-04')
    withTerms.dueDate = '2026-06-03'
    withTerms.paymentTermId = 'term-1'

    const package_ = preparePosting(withTerms, postingContext([]))

    expect(package_.voucher.dueDate).toBe('2026-06-03')
    expect(package_.voucher.paymentTermId).toBe('term-1')
  })

  it('keeps the identity of the voucher it was given', () => {
    const package_ = preparePosting(sale('2026-05-04'), postingContext([]))

    expect(package_.voucher.id).toBe('v1')
    expect(package_.voucher.number).toBe('INV-0001')
  })
})
