import { describe, expect, it } from 'vitest'

import {
  allocateOutstanding,
  balanceSheet,
  buildVoucher,
  computeTax,
  isBalanced,
  ledgerClosingBalance,
  profitAndLoss,
  roundHalfAwayFromZero,
  totalCredit,
  totalDebit,
  trialBalance,
  validateVoucher,
} from '@/domain/accounting'
import type { Ledger, TaxCategory, Voucher } from '@/domain/types'

function ledger(overrides: Partial<Ledger> & { id: string; name: string }): Ledger {
  return {
    companyId: 'cmp-test',
    group: 'assets',
    type: 'current-assets',
    parentId: null,
    openingBalance: 0,
    openingDate: '2026-04-01',
    partyKind: null,
    currency: 'INR',
    isSystem: false,
    isActive: true,
    createdAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  }
}

const customer = ledger({
  id: 'led-customer',
  name: 'Test Customer',
  group: 'assets',
  type: 'receivable',
  partyKind: 'customer',
})

const salesLedger = ledger({
  id: 'led-sales',
  name: 'Sales',
  group: 'income',
  type: 'sales',
})

const taxLedger = ledger({
  id: 'led-tax',
  name: 'Output CGST 9%',
  group: 'liabilities',
  type: 'tax',
})

const ledgers = [customer, salesLedger, taxLedger]

const taxCategories: TaxCategory[] = [
  {
    id: 'tax-cgst',
    companyId: 'cmp-test',
    name: 'Output CGST 9%',
    rate: 9,
    type: 'cgst',
    ledgerId: taxLedger.id,
    inputLedgerId: null,
    isActive: true,
  },
]

const context = {
  ledgers,
  taxCategories,
  nextId: (() => {
    let counter = 0
    return () => `id-${++counter}`
  })(),
  companyId: 'cmp-test',
}

describe('voucher construction', () => {
  it('produces a balanced sales voucher', () => {
    const voucher = buildVoucher(
      {
        type: 'sales',
        date: '2026-05-04',
        partyId: customer.id,
        narration: 'Test sale',
        reference: '',
        status: 'posted',
        items: [
          {
            itemId: 'item-1',
            quantityMilli: 2_000,
            rate: 100000,
            taxCategoryId: 'tax-cgst',
          },
        ],
      },
      context,
    )

    expect(isBalanced(voucher)).toBe(true)
    expect(totalDebit(voucher)).toBe(totalCredit(voucher))
    // 2 x 1000.00 = 2000.00 taxable, plus 9% tax = 2180.00
    expect(totalDebit(voucher)).toBe(218000)
  })

  it('posts tax to the tax category ledger, never a generic tax row', () => {
    const voucher = buildVoucher(
      {
        type: 'sales',
        date: '2026-05-04',
        partyId: customer.id,
        narration: 'Test sale',
        reference: '',
        status: 'posted',
        items: [{ itemId: 'item-1', quantityMilli: 1_000, rate: 100000, taxCategoryId: 'tax-cgst' }],
      },
      context,
    )

    const taxEntry = voucher.entries.find((entry) => entry.ledgerId === taxLedger.id)
    expect(taxEntry).toBeDefined()
    expect(taxEntry?.credit).toBe(9000)
    expect(taxEntry?.debit).toBe(0)
  })

  it('builds a balanced purchase voucher', () => {
    const purchaseLedger = ledger({
      id: 'led-purchase',
      name: 'Purchases',
      group: 'expenses',
      type: 'purchase',
    })
    const supplier = ledger({
      id: 'led-supplier',
      name: 'Test Supplier',
      group: 'liabilities',
      type: 'payable',
      partyKind: 'supplier',
    })

    const voucher = buildVoucher(
      {
        type: 'purchase',
        date: '2026-05-04',
        partyId: supplier.id,
        narration: 'Test purchase',
        reference: '',
        status: 'posted',
        items: [{ itemId: 'item-1', quantityMilli: 3_000, rate: 50000 }],
      },
      { ...context, ledgers: [...ledgers, purchaseLedger, supplier] },
    )

    expect(isBalanced(voucher)).toBe(true)
    expect(totalDebit(voucher)).toBe(150000)
  })
})

describe('voucher validation', () => {
  const base: Voucher = {
    id: 'v-1',
    companyId: 'cmp-test',
    type: 'sales',
    number: 'INV-0001',
    date: '2026-05-04',
    partyId: customer.id,
    narration: '',
    reference: '',
    status: 'draft',
    entries: [
      { id: 'e-1', ledgerId: customer.id, debit: 100000, credit: 0 },
      { id: 'e-2', ledgerId: salesLedger.id, debit: 0, credit: 90000 },
    ],
    items: [],
    taxes: [],
    linkedVoucherId: null,
    reversedByVoucherId: null,
    isLocked: false,
    createdAt: '2026-05-04T00:00:00.000Z',
    updatedAt: '2026-05-04T00:00:00.000Z',
  }

  it('blocks an unbalanced voucher', () => {
    const issues = validateVoucher(base, { ledgers, taxCategories, closedPeriods: [] })
    const blocking = issues.filter((issue) => issue.severity === 'error')
    expect(blocking.length).toBeGreaterThan(0)
    expect(blocking.some((issue) => issue.field === 'entries')).toBe(true)
  })

  it('blocks a voucher with no lines', () => {
    const issues = validateVoucher(
      { ...base, entries: [] },
      { ledgers, taxCategories, closedPeriods: [] },
    )
    expect(issues.some((issue) => issue.field === 'entries')).toBe(true)
  })

  it('requires a party for a sales voucher', () => {
    const issues = validateVoucher(
      { ...base, partyId: null, entries: [] },
      { ledgers, taxCategories, closedPeriods: [] },
    )
    expect(issues.some((issue) => issue.field === 'party')).toBe(true)
  })

  it('blocks posting into a closed period', () => {
    const issues = validateVoucher(
      { ...base, date: '2026-01-15', entries: [] },
      {
        ledgers,
        taxCategories,
        closedPeriods: [{ from: '2025-04-01', to: '2026-03-31', label: 'FY 2025-26' }],
      },
    )
    expect(issues.some((issue) => issue.field === 'date')).toBe(true)
  })

  it('accepts a balanced voucher', () => {
    const issues = validateVoucher(
      {
        ...base,
        type: 'journal',
        entries: [
          { id: 'e-1', ledgerId: customer.id, debit: 100000, credit: 0 },
          { id: 'e-2', ledgerId: salesLedger.id, debit: 0, credit: 100000 },
        ],
      },
      { ledgers, taxCategories, closedPeriods: [] },
    )
    expect(issues.filter((issue) => issue.severity === 'error')).toHaveLength(0)
  })
})

describe('ledger balances and reports', () => {
  const capital = ledger({
    id: 'led-capital',
    name: 'Capital',
    group: 'equity',
    type: 'capital',
    openingBalance: -500000,
  })
  const cash = ledger({ id: 'led-cash', name: 'Cash', group: 'assets', type: 'cash', openingBalance: 500000 })
  const allLedgers = [...ledgers, capital, cash]

  const voucher = buildVoucher(
    {
      type: 'sales',
      date: '2026-05-04',
      partyId: customer.id,
      narration: 'Test sale',
      reference: '',
      status: 'posted',
      items: [{ itemId: 'item-1', quantityMilli: 1_000, rate: 100000 }],
    },
    context,
  )

  it('reconciles a ledger balance to its entries', () => {
    const entries = voucher.entries.filter((entry) => entry.ledgerId === customer.id)
    const computed = ledgerClosingBalance(customer, entries)
    expect(computed.debitTotal).toBe(100000)
    expect(computed.creditTotal).toBe(0)
    expect(computed.closing).toBe(100000)
  })

  it('produces a trial balance whose debits equal credits', () => {
    const result = trialBalance(allLedgers, [voucher])
    expect(result.totalDebit).toBe(result.totalCredit)
    expect(result.closingNet).toBe(0)
  })

  it('keeps the balance sheet consistent with the profit and loss', () => {
    const sheet = balanceSheet(allLedgers, [voucher], { asOf: '2026-12-31' })
    const pnl = profitAndLoss(allLedgers, [voucher], { from: '2026-04-01', to: '2026-12-31' })

    expect(sheet.profit).toBe(pnl.net)
    // Assets minus liabilities, equity and profit must be nil for a consistent book.
    expect(sheet.difference).toBe(0)
  })

  it('respects the reporting period', () => {
    const pnl = profitAndLoss(allLedgers, [voucher], { from: '2026-06-01', to: '2026-12-31' })
    expect(pnl.income).toBe(0)
    expect(pnl.expense).toBe(0)
  })
})

describe('tax computation', () => {
  it('rounds half away from zero', () => {
    expect(roundHalfAwayFromZero(0.5)).toBe(1)
    expect(roundHalfAwayFromZero(-0.5)).toBe(-1)
    expect(roundHalfAwayFromZero(2.5)).toBe(3)
  })

  it('groups tax by category and totals each group', () => {
    let counter = 0
    const result = computeTax(
      [
        {
          id: 'l1',
          itemId: 'i1',
          quantityMilli: 1_000,
          rate: 100000,
          discount: 0,
          taxCategoryId: 'tax-cgst',
          amount: 100000,
          godownId: null,
        },
        {
          id: 'l2',
          itemId: 'i2',
          quantityMilli: 1_000,
          rate: 50000,
          discount: 0,
          taxCategoryId: 'tax-cgst',
          amount: 50000,
          godownId: null,
        },
      ],
      taxCategories,
      () => `tax-${++counter}`,
    )

    expect(result.taxable).toBe(150000)
    expect(result.tax).toBe(13500)
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0]?.taxable).toBe(150000)
  })

  it('ignores lines without a tax category', () => {
    const result = computeTax(
      [
        {
          id: 'l1',
          itemId: 'i1',
          quantityMilli: 1_000,
          rate: 100000,
          discount: 0,
          taxCategoryId: null,
          amount: 100000,
          godownId: null,
        },
      ],
      taxCategories,
      () => 'tax-1',
    )

    expect(result.tax).toBe(0)
    expect(result.lines).toHaveLength(0)
  })
})

describe('outstanding allocation', () => {
  it('allocates a receipt to the oldest invoice first', () => {
    const invoices: Voucher[] = [
      {
        ...buildVoucher(
          {
            type: 'sales',
            date: '2026-05-01',
            partyId: customer.id,
            narration: 'First',
            reference: '',
            status: 'posted',
            items: [{ itemId: 'i', quantityMilli: 1_000, rate: 100000 }],
          },
          context,
        ),
        id: 'inv-1',
        number: 'INV-0001',
      },
      {
        ...buildVoucher(
          {
            type: 'sales',
            date: '2026-05-10',
            partyId: customer.id,
            narration: 'Second',
            reference: '',
            status: 'posted',
            items: [{ itemId: 'i', quantityMilli: 1_000, rate: 100000 }],
          },
          context,
        ),
        id: 'inv-2',
        number: 'INV-0002',
      },
    ]

    const receipt = buildVoucher(
      {
        type: 'receipt',
        date: '2026-05-20',
        partyId: customer.id,
        narration: 'Part payment',
        reference: '',
        status: 'posted',
        items: [],
        entries: [
          { ledgerId: customer.id, debit: 0, credit: 150000 },
          { ledgerId: 'led-cash', debit: 150000, credit: 0 },
        ],
      },
      { ...context, ledgers: [...ledgers, ledger({ id: 'led-cash', name: 'Cash' })] },
    )

    const allocations = allocateOutstanding([...invoices, receipt], ledgers, {
      asOf: '2026-12-31',
      dueDays: 30,
    })

    const first = allocations.find((allocation) => allocation.voucherId === 'inv-1')
    const second = allocations.find((allocation) => allocation.voucherId === 'inv-2')

    expect(first?.outstanding).toBe(0)
    expect(first?.status).toBe('settled')
    expect(second?.outstanding).toBe(50000)
    expect(second?.status).toBe('overdue')
  })

  it('marks an invoice overdue once the due date has passed', () => {
    const invoice = buildVoucher(
      {
        type: 'sales',
        date: '2026-01-10',
        partyId: customer.id,
        narration: 'Old sale',
        reference: '',
        status: 'posted',
        items: [{ itemId: 'i', quantityMilli: 1_000, rate: 100000 }],
      },
      context,
    )

    const allocations = allocateOutstanding([invoice], ledgers, {
      asOf: '2026-06-30',
      dueDays: 30,
    })

    expect(allocations[0]?.status).toBe('overdue')
    expect(allocations[0]?.outstanding).toBe(100000)
  })
})
