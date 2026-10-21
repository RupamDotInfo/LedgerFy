import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Voucher } from '@/domain/types'

const invoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
  isTauri: () => true,
}))

const { SqliteRepository } = await import('@/repositories/sqlite/sqliteRepository')

const voucher: Voucher = {
  id: 'v1',
  companyId: 'c1',
  type: 'sales',
  number: 'INV-0001',
  date: '2026-05-04',
  partyId: 'l1',
  narration: 'Test sale',
  reference: '',
  status: 'posted',
  entries: [
    { id: 'e1', ledgerId: 'l1', debit: 118000, credit: 0 },
    { id: 'e2', ledgerId: 'l2', debit: 0, credit: 100000 },
    { id: 'e3', ledgerId: 'l3', debit: 0, credit: 18000 },
  ],
  items: [],
  taxes: [],
  linkedVoucherId: null,
  reversedByVoucherId: null,
  isLocked: false,
  createdAt: '2026-05-04T00:00:00.000Z',
  updatedAt: '2026-05-04T00:00:00.000Z',
}

describe('the SQLite repository adapter', () => {
  beforeEach(() => {
    invoke.mockReset()
  })

  it('reports itself as a local, non-sample workspace', () => {
    const repository = new SqliteRepository()
    expect(repository.info.kind).toBe('local')
    expect(repository.info.isSampleData).toBe(false)
  })

  it('reads vouchers through the command layer with the company and filters', async () => {
    invoke.mockResolvedValue([voucher])
    const repository = new SqliteRepository()

    const result = await repository.listVouchers('c1', { type: 'sales', from: '2026-04-01' })

    expect(invoke).toHaveBeenCalledWith('list_vouchers_cmd', {
      companyId: 'c1',
      filters: { type: 'sales', from: '2026-04-01' },
    })
    expect(result).toHaveLength(1)
    expect(result[0]?.entries).toHaveLength(3)
  })

  it('sends a voucher with its lines in one call', async () => {
    invoke.mockResolvedValue(voucher)
    const repository = new SqliteRepository()

    await repository.saveVoucher(voucher)

    expect(invoke).toHaveBeenCalledWith('save_voucher_cmd', {
      voucher,
      actor: 'local.operator',
    })
  })

  it('passes the voucher type as the kind the command expects', async () => {
    invoke.mockResolvedValue('INV-0007')
    const repository = new SqliteRepository()

    const number = await repository.nextVoucherNumber('c1', 'sales')

    expect(invoke).toHaveBeenCalledWith('next_voucher_number_cmd', {
      companyId: 'c1',
      kind: 'sales',
    })
    expect(number).toBe('INV-0007')
  })

  it('reads masters for the company that is open', async () => {
    invoke.mockResolvedValue([])
    const repository = new SqliteRepository()

    await repository.listLedgers('c1')
    await repository.listItems('c1')
    await repository.listTaxCategories('c1')

    expect(invoke).toHaveBeenNthCalledWith(1, 'list_ledgers_cmd', { companyId: 'c1' })
    expect(invoke).toHaveBeenNthCalledWith(2, 'list_items_cmd', { companyId: 'c1' })
    expect(invoke).toHaveBeenNthCalledWith(3, 'list_tax_categories_cmd', { companyId: 'c1' })
  })

  it('reconciles a statement line through the command layer', async () => {
    invoke.mockResolvedValue({
      id: 's1',
      companyId: 'c1',
      ledgerId: 'l1',
      date: '2026-05-04',
      description: 'Transfer',
      reference: 'UTR1',
      amount: -5000,
      matchedVoucherId: 'v1',
      confidence: 1,
      matchReason: 'Confirmed by the user against the selected voucher.',
      isReconciled: true,
    })
    const repository = new SqliteRepository()

    const line = await repository.reconcileStatementLine('c1', 's1', 'v1')

    expect(invoke).toHaveBeenCalledWith('reconcile_statement_line_cmd', {
      companyId: 'c1',
      lineId: 's1',
      voucherId: 'v1',
    })
    expect(line.isReconciled).toBe(true)
  })

  it('creates a company and its first financial year', async () => {
    invoke.mockImplementation((command: string) => {
      if (command === 'insert_company_cmd') return Promise.resolve({})
      return Promise.resolve({})
    })
    const repository = new SqliteRepository()

    const company = await repository.createCompany({
      name: 'Test Traders',
      country: 'India',
      baseCurrency: 'INR',
      fiscalYearStart: '2026-04-01',
      fiscalYearEnd: '2027-03-31',
    })

    expect(company.name).toBe('Test Traders')
    expect(company.isDemo).toBe(false)
    expect(company.id).toBeTruthy()

    const calls = invoke.mock.calls.map((call) => call[0])
    expect(calls).toContain('insert_company_cmd')
    expect(calls).toContain('insert_financial_year_cmd')
  })

  it('builds the dashboard from the books it reads back', async () => {
    const ledgers = [
      {
        id: 'l1',
        companyId: 'c1',
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
      },
      {
        id: 'l2',
        companyId: 'c1',
        name: 'Sales',
        group: 'income',
        type: 'sales',
        parentId: null,
        openingBalance: 0,
        openingDate: '2026-04-01',
        partyKind: null,
        currency: 'INR',
        isSystem: false,
        isActive: true,
        createdAt: '2026-04-01T00:00:00.000Z',
      },
      {
        id: 'l3',
        companyId: 'c1',
        name: 'Output CGST 18%',
        group: 'liabilities',
        type: 'tax',
        parentId: null,
        openingBalance: 0,
        openingDate: '2026-04-01',
        partyKind: null,
        currency: 'INR',
        isSystem: false,
        isActive: true,
        createdAt: '2026-04-01T00:00:00.000Z',
      },
    ]

    invoke.mockImplementation((command: string) => {
      switch (command) {
        case 'list_ledgers_cmd':
          return Promise.resolve(ledgers)
        case 'list_vouchers_cmd':
          return Promise.resolve([voucher])
        case 'list_items_cmd':
        case 'list_units_cmd':
        case 'list_stock_movements_cmd':
        case 'list_statement_lines_cmd':
          return Promise.resolve([])
        default:
          return Promise.resolve([])
      }
    })

    const repository = new SqliteRepository()
    const snapshot = await repository.getDashboard('c1', {
      from: '2026-04-01',
      to: '2026-12-31',
    })

    // The receivable balance comes from the voucher's own entries, so the
    // dashboard agrees with the books it was given.
    expect(snapshot.receivables).toBe(118000)
    expect(snapshot.sales).toBe(100000)
  })
})
