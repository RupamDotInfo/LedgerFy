import { beforeAll, describe, expect, it } from 'vitest'

import { DemoRepository } from '@/repositories/demo/demoRepository'
import {
  allocateOutstanding,
  balanceSheet,
  buildVoucher,
  computeLedgerBalances,
  isBalanced,
  totalDebit,
  trialBalance,
  validateVoucher,
} from '@/domain/accounting'
import type { LedgerFyRepository } from '@/repositories/contracts'

let repository: LedgerFyRepository
let companyId = ''
let otherCompanyId = ''

beforeAll(async () => {
  repository = new DemoRepository()
  const companies = await repository.listCompanies()
  companyId = companies[0]!.id
  otherCompanyId = companies[1]!.id
})

describe('demo repository', () => {
  it('lists more than one company and reports that the data is sample data', () => {
    expect(repository.info.kind).toBe('demo')
    expect(repository.info.isSampleData).toBe(true)
  })

  it('keeps outstanding invoices within the party ledger balances', async () => {
    for (const company of await repository.listCompanies()) {
      const ledgers = await repository.listLedgers(company.id)
      const vouchers = await repository.listVouchers(company.id)
      const allocations = allocateOutstanding(vouchers, ledgers, { asOf: '2026-10-20' })
      const balances = computeLedgerBalances(ledgers, vouchers, { to: '2026-10-20' })

      const receivableBalance = balances
        .filter((balance) => balance.ledger.type === 'receivable')
        .reduce((sum, balance) => sum + balance.closing, 0)
      const payableBalance = balances
        .filter((balance) => balance.ledger.type === 'payable')
        .reduce((sum, balance) => sum + Math.abs(balance.closing), 0)

      const outstandingReceivables = allocations
        .filter((allocation) => allocation.side === 'receivable')
        .reduce((sum, allocation) => sum + allocation.outstanding, 0)
      const outstandingPayables = allocations
        .filter((allocation) => allocation.side === 'payable')
        .reduce((sum, allocation) => sum + allocation.outstanding, 0)

      // A credit note reduces what a customer owes, so the open invoices can
      // never exceed the balance the party ledger actually carries.
      expect(outstandingReceivables).toBeLessThanOrEqual(receivableBalance)
      expect(outstandingPayables).toBeLessThanOrEqual(payableBalance)

      // Both sides must actually carry open business, otherwise the
      // allocation has silently dropped one of them.
      expect(outstandingReceivables).toBeGreaterThan(0)
      expect(outstandingPayables).toBeGreaterThan(0)
    }
  })

  it('keeps every demo voucher balanced', async () => {
    for (const company of await repository.listCompanies()) {
      const vouchers = await repository.listVouchers(company.id)
      const unbalanced = vouchers.filter((voucher) => !isBalanced(voucher))
      expect(
        unbalanced.map((voucher) => `${voucher.number}:${voucher.type}`),
      ).toEqual([])
    }
  })

  it('produces a trial balance that nets to zero for every company', async () => {
    for (const company of await repository.listCompanies()) {
      const ledgers = await repository.listLedgers(company.id)
      const vouchers = await repository.listVouchers(company.id)
      const result = trialBalance(ledgers, vouchers)
      expect(result.closingNet).toBe(0)
    }
  })

  it('keeps the balance sheet consistent with the profit and loss', async () => {
    for (const company of await repository.listCompanies()) {
      const ledgers = await repository.listLedgers(company.id)
      const vouchers = await repository.listVouchers(company.id)
      const sheet = balanceSheet(ledgers, vouchers)
      expect(sheet.difference).toBe(0)
    }
  })

  it('keeps each company isolated', async () => {
    const first = await repository.listVouchers(companyId)
    const second = await repository.listVouchers(otherCompanyId)

    expect(first.length).toBeGreaterThan(0)
    expect(second.length).toBeGreaterThan(0)
    expect(first.every((voucher) => voucher.companyId === companyId)).toBe(true)
    expect(second.every((voucher) => voucher.companyId === otherCompanyId)).toBe(true)
  })

  it('saves a voucher that is then visible in the register', async () => {
    const ledgers = await repository.listLedgers(companyId)
    const customer = ledgers.find((ledger) => ledger.partyKind === 'customer')!
    const items = await repository.listItems(companyId)
    const taxCategories = await repository.listTaxCategories(companyId)

    let counter = 0
    const voucher = buildVoucher(
      {
        type: 'sales',
        date: '2026-10-01',
        partyId: customer.id,
        narration: 'Repository test sale',
        reference: 'TEST-1',
        status: 'posted',
        items: [
          {
            itemId: items[0]!.id,
            quantityMilli: 3_000,
            rate: items[0]!.salesPrice,
            taxCategoryId: taxCategories[0]!.id,
          },
        ],
      },
      {
        ledgers,
        taxCategories,
        nextId: () => `test-${++counter}`,
        companyId,
      },
    )

    voucher.number = await repository.nextVoucherNumber(companyId, 'sales')
    const saved = await repository.saveVoucher(voucher)

    expect(saved.id).toBe(voucher.id)

    const listed = await repository.listVouchers(companyId, { search: 'TEST-1' })
    expect(listed).toHaveLength(1)
    expect(listed[0]?.id).toBe(voucher.id)

    const fetched = await repository.getVoucher(companyId, voucher.id)
    expect(fetched?.narration).toBe('Repository test sale')
    expect(totalDebit(fetched!)).toBe(totalDebit(voucher))
  })

  it('records an audit event when a voucher is posted', async () => {
    const events = await repository.listAuditEvents(companyId)
    expect(events.length).toBeGreaterThan(0)
    expect(events.some((event) => event.action.startsWith('voucher.'))).toBe(true)
  })

  it('produces a dashboard whose figures come from the books', async () => {
    const year = (await repository.listFinancialYears(companyId)).find((item) => !item.isClosed)!
    const snapshot = await repository.getDashboard(companyId, {
      from: year.start,
      to: year.end,
    })

    expect(snapshot.cash.total).toBe(snapshot.cash.cash + snapshot.cash.bank)
    expect(snapshot.profit).toBe(snapshot.sales - snapshot.expenses)
    expect(snapshot.monthly.length).toBeGreaterThan(0)
    expect(snapshot.gst.outputTax).toBeGreaterThanOrEqual(0)
    expect(snapshot.bankReconciliation.length).toBeGreaterThan(0)
  })

  it('reconciles a statement line and records the change', async () => {
    const lines = await repository.listStatementLines(companyId, { reconciled: false })
    expect(lines.length).toBeGreaterThan(0)

    const target = lines.find((line) => line.matchedVoucherId) ?? lines[0]!
    const updated = await repository.reconcileStatementLine(
      companyId,
      target.id,
      target.matchedVoucherId ?? null,
    )

    expect(updated.isReconciled).toBe(true)

    const reconciled = await repository.listStatementLines(companyId, { reconciled: true })
    expect(reconciled.some((line) => line.id === target.id)).toBe(true)
  })

  it('refuses to post into a closed financial year', async () => {
    const ledgers = await repository.listLedgers(companyId)
    const years = await repository.listFinancialYears(companyId)
    const closed = years.find((year) => year.isClosed)!

    const customer = ledgers.find((ledger) => ledger.partyKind === 'customer')!
    const taxCategories = await repository.listTaxCategories(companyId)
    const items = await repository.listItems(companyId)

    let counter = 0
    const voucher = buildVoucher(
      {
        type: 'sales',
        date: '2026-01-10',
        partyId: customer.id,
        narration: 'Closed period sale',
        reference: '',
        status: 'posted',
        items: [{ itemId: items[0]!.id, quantityMilli: 1_000, rate: items[0]!.salesPrice }],
      },
      { ledgers, taxCategories, nextId: () => `closed-${++counter}`, companyId },
    )

    const issues = validateVoucher(voucher, {
      ledgers,
      taxCategories,
      closedPeriods: [{ from: closed.start, to: closed.end, label: closed.label }],
    })

    expect(issues.some((issue) => issue.severity === 'error' && issue.field === 'date')).toBe(true)
  })

  it('creates a company and isolates its books', async () => {
    const created = await repository.createCompany({
      name: 'Test Traders',
      country: 'India',
      baseCurrency: 'INR',
      fiscalYearStart: '2026-04-01',
      fiscalYearEnd: '2027-03-31',
    })

    expect(created.isDemo).toBe(true)
    const vouchers = await repository.listVouchers(created.id)
    expect(vouchers).toHaveLength(0)

    const years = await repository.listFinancialYears(created.id)
    expect(years).toHaveLength(1)
  })
})
