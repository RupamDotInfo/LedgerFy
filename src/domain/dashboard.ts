/**
 * Dashboard computation.
 *
 * The dashboard is derived entirely from the books, so it is computed here
 * once and used by every repository implementation. The demo repository and
 * the local SQLite repository therefore show exactly the same figures for the
 * same records.
 */

import {
  allocateOutstanding,
  balanceSheet,
  cashPosition,
  computeLedgerBalances,
  profitAndLoss,
  totalDebit,
} from '@/domain/accounting'
import type {
  Item,
  Ledger,
  StatementLine,
  StockMovement,
  Unit,
  Voucher,
} from '@/domain/types'
import type {
  DashboardSnapshot,
  DateRange,
  OutstandingSummary,
} from '@/repositories/contracts'

export interface DashboardInput {
  range: DateRange
  ledgers: Ledger[]
  /** Every voucher for the company, including drafts. */
  vouchers: Voucher[]
  items: Item[]
  units: Unit[]
  stockMovements: StockMovement[]
  statementLines: StatementLine[]
  /** The date used to decide whether an invoice is overdue. */
  asOf: string
}

export function buildDashboardSnapshot(input: DashboardInput): DashboardSnapshot {
  const { range, ledgers, items, units, stockMovements } = input

  const posted = input.vouchers.filter((voucher) => voucher.status === 'posted')
  const periodVouchers = posted.filter(
    (voucher) => voucher.date >= range.from && voucher.date <= range.to,
  )

  const pnl = profitAndLoss(ledgers, posted, range)
  const cash = cashPosition(ledgers, posted, { asOf: range.to })
  const sheet = balanceSheet(ledgers, posted, { asOf: range.to })

  const ledgerById = new Map(ledgers.map((ledger) => [ledger.id, ledger]))
  const typeOf = (ledgerId: string) => ledgerById.get(ledgerId)?.type

  const receivables = sheet.assetRows
    .filter((row) => typeOf(row.ledgerId) === 'receivable')
    .reduce((sum, row) => sum + row.closing, 0)

  const payables = -sheet.liabilityRows
    .filter((row) => typeOf(row.ledgerId) === 'payable')
    .reduce((sum, row) => sum + row.closing, 0)

  const sales = pnl.incomeRows
    .filter((row) => typeOf(row.ledgerId) === 'sales')
    .reduce((sum, row) => sum + row.closing, 0)

  const purchases = pnl.expenseRows
    .filter((row) => typeOf(row.ledgerId) === 'purchase')
    .reduce((sum, row) => sum + row.closing, 0)

  const allocations = allocateOutstanding(posted, ledgers, { asOf: range.to })
  const receivableAllocations = allocations.filter((a) => a.side === 'receivable')
  const payableAllocations = allocations.filter((a) => a.side === 'payable')

  const inPeriod = (date: string) => date >= range.from && date <= range.to

  const openCustomerInvoices = receivableAllocations.filter(
    (allocation) => allocation.outstanding > 0 && inPeriod(allocation.date),
  )
  const openInvoices: OutstandingSummary = {
    count: openCustomerInvoices.length,
    amount: openCustomerInvoices.reduce((sum, allocation) => sum + allocation.outstanding, 0),
  }

  const openSupplierBills = payableAllocations.filter(
    (allocation) => allocation.outstanding > 0 && inPeriod(allocation.date),
  )
  const pendingBills: OutstandingSummary = {
    count: openSupplierBills.length,
    amount: openSupplierBills.reduce((sum, allocation) => sum + allocation.outstanding, 0),
  }

  const overdue = receivableAllocations.filter(
    (allocation) => allocation.outstanding > 0 && allocation.dueDate < input.asOf,
  )
  const overdueReceivables: OutstandingSummary = {
    count: overdue.length,
    amount: overdue.reduce((sum, allocation) => sum + allocation.outstanding, 0),
  }

  const balances = computeLedgerBalances(ledgers, posted, { to: range.to })
  const topReceivables = balances
    .filter((balance) => balance.ledger.type === 'receivable' && balance.closing > 0)
    .map((balance) => ({
      ledgerId: balance.ledger.id,
      name: balance.ledger.name,
      amount: balance.closing,
      count: balance.debitCount,
    }))
    .sort((left, right) => right.amount - left.amount)
    .slice(0, 6)

  const topPayables = balances
    .filter((balance) => balance.ledger.type === 'payable' && balance.closing < 0)
    .map((balance) => ({
      ledgerId: balance.ledger.id,
      name: balance.ledger.name,
      amount: -balance.closing,
      count: balance.creditCount,
    }))
    .sort((left, right) => right.amount - left.amount)
    .slice(0, 6)

  // Monthly series for the trend chart.
  const monthly: DashboardSnapshot['monthly'] = []
  const cursor = new Date(`${range.from}T00:00:00`)
  const last = new Date(`${range.to}T00:00:00`)
  while (cursor <= last) {
    const month = cursor.toISOString().slice(0, 7)
    const monthPnl = profitAndLoss(ledgers, posted, { from: `${month}-01`, to: `${month}-31` })
    monthly.push({
      label: cursor.toLocaleDateString('en-IN', { month: 'short' }),
      income: monthPnl.income,
      expense: monthPnl.expense,
    })
    cursor.setMonth(cursor.getMonth() + 1)
  }

  // Stock alerts.
  const onHand = new Map<string, number>(items.map((item) => [item.id, item.openingQuantityMilli]))
  for (const movement of stockMovements) {
    if (movement.date > range.to) continue
    onHand.set(movement.itemId, (onHand.get(movement.itemId) ?? 0) + movement.quantityMilli)
  }
  const unitNames = new Map(units.map((unit) => [unit.id, unit.name]))
  const lowStock = items
    .filter((item) => item.isInventory && (onHand.get(item.id) ?? 0) <= item.reorderLevelMilli)
    .map((item) => ({
      itemId: item.id,
      name: item.name,
      unit: unitNames.get(item.unitId) ?? '',
      quantity: onHand.get(item.id) ?? 0,
      reorderLevel: item.reorderLevelMilli,
    }))
    .sort((left, right) => left.quantity - right.quantity)
    .slice(0, 6)

  const attention: DashboardSnapshot['attention'] = []
  if (overdueReceivables.count > 0) {
    attention.push({
      id: 'overdue-receivables',
      title: `${overdueReceivables.count} overdue ${overdueReceivables.count === 1 ? 'invoice' : 'invoices'}`,
      detail: 'Payments are past the agreed credit period.',
      tone: 'danger',
      route: '/reports/receivables',
    })
  }
  if (pendingBills.count > 0) {
    attention.push({
      id: 'pending-bills',
      title: `${pendingBills.count} bills awaiting payment`,
      detail: 'Purchase invoices still have an outstanding balance.',
      tone: 'warning',
      route: '/reports/payables',
    })
  }
  if (lowStock.length > 0) {
    attention.push({
      id: 'low-stock',
      title: `${lowStock.length} items at or below reorder level`,
      detail: 'Raise a purchase order before the next despatch.',
      tone: 'warning',
      route: '/inventory',
    })
  }
  const draftCount = input.vouchers.filter(
    (voucher) => voucher.status === 'draft' && inPeriod(voucher.date),
  ).length
  if (draftCount > 0) {
    attention.push({
      id: 'drafts',
      title: `${draftCount} draft ${draftCount === 1 ? 'voucher' : 'vouchers'} not posted`,
      detail: 'Drafts do not affect balances or reports until posted.',
      tone: 'info',
      route: '/vouchers',
    })
  }

  const recentVouchers = [...periodVouchers]
    .sort((left, right) => (left.date < right.date ? 1 : -1))
    .slice(0, 8)

  const reconciliation = bankLedgerIds(ledgers).map((ledger) => {
    const lines = input.statementLines.filter((line) => line.ledgerId === ledger.id)
    const reconciled = lines.filter((line) => line.isReconciled)
    const unmatched = lines.filter((line) => !line.isReconciled)
    return {
      ledgerId: ledger.id,
      ledgerName: ledger.name,
      total: lines.length,
      reconciled: reconciled.length,
      unmatched: unmatched.length,
      reconciledAmount: reconciled.reduce((sum, line) => sum + line.amount, 0),
      unmatchedAmount: unmatched.reduce((sum, line) => sum + line.amount, 0),
      percentage: lines.length ? (reconciled.length / lines.length) * 100 : 100,
    }
  })

  const gst = buildGstSummary(periodVouchers, range)

  return {
    range,
    cash: { cash: cash.cash, bank: cash.bank, total: cash.total },
    cashBreakdown: cash.breakdown.map((row) => ({
      ledgerId: row.ledgerId,
      name: row.ledgerName,
      amount: row.closing,
      kind: (ledgerById.get(row.ledgerId)?.type === 'cash' ? 'cash' : 'bank') as 'cash' | 'bank',
    })),
    receivables,
    payables,
    sales,
    purchases,
    expenses: pnl.expense,
    profit: pnl.net,
    marginPercent: pnl.income === 0 ? 0 : (pnl.net / pnl.income) * 100,
    pendingBills,
    overdueReceivables,
    openInvoices,
    recentVouchers,
    monthly,
    topReceivables,
    topPayables,
    lowStock,
    attention,
    bankReconciliation: reconciliation,
    gst,
  }
}

function bankLedgerIds(ledgers: Ledger[]): Ledger[] {
  return ledgers.filter((ledger) => ledger.type === 'bank')
}

/** Value above which a consignment needs an e-way bill. */
const EWAY_BILL_THRESHOLD = 5_000_000

function buildGstSummary(vouchers: Voucher[], range: DateRange) {
  const sales = vouchers.filter((voucher) => voucher.type === 'sales')
  const purchases = vouchers.filter((voucher) => voucher.type === 'purchase')
  const outputTax = sales.reduce(
    (sum, voucher) => sum + voucher.taxes.reduce((inner, tax) => inner + tax.amount, 0),
    0,
  )
  const inputTax = purchases.reduce(
    (sum, voucher) => sum + voucher.taxes.reduce((inner, tax) => inner + tax.amount, 0),
    0,
  )

  return {
    period: range.to.slice(0, 7),
    outputTax,
    inputTax,
    itcEligible: inputTax,
    cashChallanDue: Math.max(0, outputTax - inputTax),
    salesVoucherCount: sales.length,
    purchaseVoucherCount: purchases.length,
    invoicesAboveEwayThreshold: sales.filter(
      (voucher) => totalDebit(voucher) >= EWAY_BILL_THRESHOLD,
    ).length,
    ewayThreshold: EWAY_BILL_THRESHOLD,
  }
}
