import { describe, expect, it } from 'vitest'

import { buildAllocationLedger } from '@/domain/allocations'
import { allocateOutstanding } from '@/domain/accounting'
import type { Ledger, Voucher } from '@/domain/types'

const customer = ledger('led-customer', 'Customer One', 'assets', 'receivable', 'customer')
const supplier = ledger('led-supplier', 'Supplier One', 'liabilities', 'payable', 'supplier')
const sales = ledger('led-sales', 'Sales', 'income', 'sales')
const purchases = ledger('led-purchases', 'Purchases', 'expenses', 'purchase')
const cash = ledger('led-cash', 'Cash', 'assets', 'cash')

const ledgers = [customer, supplier, sales, purchases, cash]

function ledger(
  id: string,
  name: string,
  group: Ledger['group'],
  kind: Ledger['type'],
  partyKind: Ledger['partyKind'] = null,
): Ledger {
  return {
    id,
    companyId: 'cmp-1',
    name,
    group,
    type: kind,
    parentId: null,
    openingBalance: 0,
    openingDate: '2026-04-01',
    partyKind,
    currency: 'INR',
    isSystem: false,
    isActive: true,
    createdAt: '2026-04-01T00:00:00.000Z',
  }
}

let sequence = 0
function nextId(prefix: string) {
  sequence += 1
  return `${prefix}-${sequence}`
}

interface Side {
  party: string
  /** Debit the party. */
  debitParty?: number
  /** Credit the party. */
  creditParty?: number
  other: string
  debitOther?: number
  creditOther?: number
}

function voucher(
  id: string,
  type: Voucher['type'],
  date: string,
  side: Side,
  status: Voucher['status'] = 'posted',
): Voucher {
  const entries = []
  if (side.debitParty) {
    entries.push({
      id: `${id}-e1`,
      ledgerId: side.party,
      debit: side.debitParty,
      credit: 0,
    })
  }
  if (side.creditParty) {
    entries.push({
      id: `${id}-e2`,
      ledgerId: side.party,
      debit: 0,
      credit: side.creditParty,
    })
  }
  if (side.debitOther) {
    entries.push({
      id: `${id}-e3`,
      ledgerId: side.other,
      debit: side.debitOther,
      credit: 0,
    })
  }
  if (side.creditOther) {
    entries.push({
      id: `${id}-e4`,
      ledgerId: side.other,
      debit: 0,
      credit: side.creditOther,
    })
  }

  return {
    id,
    companyId: 'cmp-1',
    type,
    number: id.toUpperCase(),
    date,
    dueDate: null,
    paymentTermId: null,
    partyId: side.party,
    narration: '',
    reference: '',
    status,
    entries,
    items: [],
    taxes: [],
    linkedVoucherId: null,
    reversedByVoucherId: null,
    isLocked: false,
    createdAt: `${date}T00:00:00.000Z`,
    updatedAt: `${date}T00:00:00.000Z`,
  }
}

function invoice(id: string, date: string, amount: number) {
  return voucher(id, 'sales', date, {
    party: customer.id,
    debitParty: amount,
    other: sales.id,
    creditOther: amount,
  })
}

function receipt(id: string, date: string, amount: number, status: Voucher['status'] = 'posted') {
  return voucher(
    id,
    'receipt',
    date,
    {
      party: customer.id,
      creditParty: amount,
      other: cash.id,
      debitOther: amount,
    },
    status,
  )
}

/** The "as of" date the tests reason about, unless a case says otherwise. */
const AS_OF = '2026-05-25'

function build(vouchers: Voucher[], options: { asOf?: string } = {}) {
  return buildAllocationLedger(vouchers, {
    asOf: options.asOf ?? AS_OF,
    idFactory: () => nextId('alloc'),
    now: () => '2026-05-01T00:00:00.000Z',
  })
}

describe('bill-wise allocation', () => {
  it('settles one bill with one payment', () => {
    const vouchers = [invoice('inv-1', '2026-05-01', 100_000), receipt('rcp-1', '2026-05-10', 100_000)]

    const ledger = build(vouchers)

    expect(ledger.invoices).toHaveLength(1)
    expect(ledger.invoices[0]?.allocated).toBe(100_000)
    expect(ledger.invoices[0]?.outstanding).toBe(0)
    expect(ledger.invoices[0]?.status).toBe('settled')
    expect(ledger.allocations).toHaveLength(1)
    expect(ledger.allocations[0]?.invoiceVoucherId).toBe('inv-1')
    expect(ledger.allocations[0]?.paymentVoucherId).toBe('rcp-1')
    expect(ledger.advances).toHaveLength(0)
  })

  it('settles one bill with several partial payments', () => {
    const vouchers = [
      invoice('inv-1', '2026-05-01', 100_000),
      receipt('rcp-1', '2026-05-10', 40_000),
      receipt('rcp-2', '2026-05-20', 30_000),
    ]

    const ledger = build(vouchers)

    expect(ledger.invoices[0]?.allocated).toBe(70_000)
    expect(ledger.invoices[0]?.outstanding).toBe(30_000)
    expect(ledger.invoices[0]?.status).toBe('partial')
    expect(ledger.allocations).toHaveLength(2)
  })

  it('applies one payment across several bills, oldest first', () => {
    const vouchers = [
      invoice('inv-1', '2026-05-01', 40_000),
      invoice('inv-2', '2026-05-05', 40_000),
      invoice('inv-3', '2026-05-09', 40_000),
      receipt('rcp-1', '2026-05-15', 100_000),
    ]

    const ledger = build(vouchers)

    expect(ledger.invoices.map((invoice) => invoice.outstanding)).toEqual([0, 0, 20_000])
    expect(ledger.allocations).toHaveLength(3)
    // The oldest invoice is settled first.
    expect(ledger.allocations[0]?.invoiceVoucherId).toBe('inv-1')
    expect(ledger.allocations[1]?.invoiceVoucherId).toBe('inv-2')
    expect(ledger.allocations[2]?.invoiceVoucherId).toBe('inv-3')
  })

  it('holds an advance when nothing has been invoiced yet', () => {
    const vouchers = [receipt('rcp-1', '2026-05-01', 50_000)]

    const ledger = build(vouchers)

    expect(ledger.invoices).toHaveLength(0)
    expect(ledger.advances).toHaveLength(1)
    expect(ledger.advances[0]?.amount).toBe(50_000)
    expect(ledger.advances[0]?.partyId).toBe(customer.id)
  })

  it('lets an advance settle an invoice raised later', () => {
    const vouchers = [
      receipt('rcp-1', '2026-05-01', 50_000),
      invoice('inv-1', '2026-05-20', 30_000),
    ]

    const ledger = build(vouchers)

    expect(ledger.invoices[0]?.outstanding).toBe(0)
    expect(ledger.advances[0]?.amount).toBe(20_000)
  })

  it('keeps the excess of an overpayment as an advance', () => {
    const vouchers = [
      invoice('inv-1', '2026-05-01', 40_000),
      receipt('rcp-1', '2026-05-10', 60_000),
    ]

    const ledger = build(vouchers)

    expect(ledger.invoices[0]?.outstanding).toBe(0)
    expect(ledger.advances[0]?.amount).toBe(20_000)
  })

  it('reduces the outstanding when a credit note is issued', () => {
    const vouchers = [
      invoice('inv-1', '2026-05-01', 100_000),
      voucher('cn-1', 'credit-note', '2026-05-10', {
        party: customer.id,
        creditParty: 30_000,
        other: sales.id,
        debitOther: 30_000,
      }),
    ]

    const ledger = build(vouchers)

    expect(ledger.invoices[0]?.outstanding).toBe(70_000)
    expect(ledger.invoices[0]?.status).toBe('partial')
  })

  it('ignores a draft', () => {
    const vouchers = [
      invoice('inv-1', '2026-05-01', 100_000),
      receipt('rcp-1', '2026-05-10', 100_000, 'draft'),
    ]

    const ledger = build(vouchers)

    expect(ledger.invoices[0]?.outstanding).toBe(100_000)
    expect(ledger.allocations).toHaveLength(0)
  })

  it('ignores a cancelled invoice', () => {
    const vouchers = [
      invoice('inv-1', '2026-05-01', 100_000),
      receipt('rcp-1', '2026-05-10', 100_000),
      { ...invoice('inv-2', '2026-05-02', 50_000), status: 'cancelled' as const },
    ]

    const ledger = build(vouchers)

    expect(ledger.invoices.map((entry) => entry.voucherId)).toEqual(['inv-1'])
  })

  it('uses the due date on the voucher when it has one', () => {
    const due = { ...invoice('inv-1', '2026-05-01', 100_000), dueDate: '2026-05-15' }

    const ledger = build([due])

    expect(ledger.invoices[0]?.dueDate).toBe('2026-05-15')
  })

  it('marks an invoice overdue once the due date has passed', () => {
    const due = { ...invoice('inv-1', '2026-05-01', 100_000), dueDate: '2026-05-15' }

    const ledger = build([due], { asOf: '2026-06-01' })

    expect(ledger.invoices[0]?.status).toBe('overdue')
  })

  it('keeps a receipt from settling another party’s invoice', () => {
    const otherCustomer = ledger('led-other', 'Customer Two', 'assets', 'receivable', 'customer')
    const vouchers = [
      invoice('inv-1', '2026-05-01', 100_000),
      {
        ...receipt('rcp-1', '2026-05-10', 100_000),
        entries: [
          { id: 'rcp-1-e1', ledgerId: cash.id, debit: 100_000, credit: 0 },
          { id: 'rcp-1-e2', ledgerId: otherCustomer.id, debit: 0, credit: 100_000 },
        ],
        partyId: otherCustomer.id,
      },
    ]

    const result = build(vouchers)

    expect(result.invoices).toHaveLength(1)
    expect(result.invoices[0]?.outstanding).toBe(100_000)
  })

  it('keeps the purchase side separate from the sales side', () => {    const bill = voucher('pur-1', 'purchase', '2026-05-01', {
      party: supplier.id,
      creditParty: 80_000,
      other: purchases.id,
      debitOther: 80_000,
    })
    const payment = voucher('pay-1', 'payment', '2026-05-10', {
      party: supplier.id,
      debitParty: 50_000,
      other: cash.id,
      creditOther: 50_000,
    })

    const ledger = build([bill, payment])

    const payable = ledger.invoices.find((entry) => entry.side === 'payable')
    expect(payable?.outstanding).toBe(30_000)
    expect(ledger.invoices.filter((entry) => entry.side === 'receivable')).toHaveLength(0)
  })
})

describe('a direct cash sale', () => {
  it('creates no receivable, so it takes no part in the allocation', () => {
    // A cash sale is settled against the cash account, not a customer.
    const cashSale = voucher('inv-cash', 'sales', '2026-05-04', {
      party: cash.id,
      debitParty: 100_000,
      other: sales.id,
      creditOther: 100_000,
    })

    const allocations = allocateOutstanding([cashSale], ledgers, {
      idFactory: () => nextId('alloc'),
      asOf: AS_OF,
    })

    expect(allocations).toHaveLength(0)
  })
})

describe('allocateOutstanding', () => {
  it('reports the outstanding with the party name', () => {
    const vouchers = [invoice('inv-1', '2026-05-01', 100_000)]

    const allocations = allocateOutstanding(vouchers, ledgers, {
      idFactory: () => nextId('alloc'),
    })

    expect(allocations).toHaveLength(1)
    expect(allocations[0]?.partyName).toBe('Customer One')
    expect(allocations[0]?.outstanding).toBe(100_000)
    expect(allocations[0]?.side).toBe('receivable')
  })

  it('agrees with the party ledger balance', () => {
    const vouchers = [
      invoice('inv-1', '2026-05-01', 100_000),
      receipt('rcp-1', '2026-05-10', 60_000),
    ]

    const allocations = allocateOutstanding(vouchers, ledgers, {
      idFactory: () => nextId('alloc'),
    })
    const outstanding = allocations
      .filter((allocation) => allocation.side === 'receivable')
      .reduce((sum, allocation) => sum + allocation.outstanding, 0)

    // The customer ledger is debited 100000 and credited 60000.
    expect(outstanding).toBe(40_000)
  })
})
