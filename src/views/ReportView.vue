<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseDrawer from '@/components/ui/BaseDrawer.vue'
import BaseEmptyState from '@/components/ui/BaseEmptyState.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import FilterBar from '@/components/ui/FilterBar.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import { ACCOUNT_GROUP_LABELS } from '@/app/labels'
import {
  balanceSheet,
  computeLedgerBalances,
  profitAndLoss,
  totalCredit,
  totalDebit,
  trialBalance,
} from '@/domain/accounting'
import { buildAllocationLedger } from '@/domain/allocations'
import type { AllocationRecord } from '@/domain/allocations'
import type { AccountGroup, Voucher } from '@/domain/types'
import { daysBetween, formatDate } from '@/lib/datetime'
import { formatAmount, formatMoney } from '@/lib/money'
import { useSessionStore } from '@/stores/session'
import { useToastStore } from '@/stores/toast'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const toast = useToastStore()

// ---------------------------------------------------------------------------
// Report definitions
// ---------------------------------------------------------------------------

type ReportMode = 'period' | 'asat'

interface ReportMeta {
  id: string
  name: string
  description: string
  basis: string
  mode: ReportMode
  icon: string
}

const REPORTS: Record<string, ReportMeta> = {
  'balance-sheet': {
    id: 'balance-sheet',
    name: 'Balance sheet',
    description: 'Assets, liabilities and equity at the reporting date.',
    basis:
      'Posted vouchers only, drafts excluded. Balances are taken as at the reporting date and include the opening balance of every ledger.',
    mode: 'asat',
    icon: 'balance',
  },
  'profit-and-loss': {
    id: 'profit-and-loss',
    name: 'Profit and loss',
    description: 'Income and expenses of the period, ending in the net profit.',
    basis:
      'Posted vouchers only, drafts excluded. Income and expense rows carry the opening balance of the ledger plus the movement of the period.',
    mode: 'period',
    icon: 'monitoring',
  },
  'trial-balance': {
    id: 'trial-balance',
    name: 'Trial balance',
    description: 'Every ledger with its opening, movement and closing balance.',
    basis:
      'Posted vouchers only, drafts excluded. Debit and credit columns carry the movement of the period; the closing column adds the opening balance.',
    mode: 'period',
    icon: 'balance',
  },
  receivables: {
    id: 'receivables',
    name: 'Receivables ageing',
    description: 'Money owed by customers, bucketed by how late it is.',
    basis:
      'Posted vouchers only, drafts excluded. Amounts are the bill-wise allocation position: a receipt is applied to the oldest unpaid invoice of each customer, and a sales invoice is a receivable. Buckets are counted from the due date. The ageing total is reconciled with the party ledger balance below.',
    mode: 'asat',
    icon: 'trending_up',
  },
  payables: {
    id: 'payables',
    name: 'Payables ageing',
    description: 'Money owed to suppliers, bucketed by how late it is.',
    basis:
      'Posted vouchers only, drafts excluded. Amounts are the bill-wise allocation position: a payment is applied to the oldest unpaid bill of each supplier, and a purchase invoice is a payable. Buckets are counted from the due date. The ageing total is reconciled with the party ledger balance below.',
    mode: 'asat',
    icon: 'trending_down',
  },
  'gst-summary': {
    id: 'gst-summary',
    name: 'GST summary',
    description: 'Output tax, input tax and the difference, by tax category.',
    basis:
      'Posted vouchers only, drafts excluded. Output tax is read from the tax lines of sales vouchers, input tax from the tax lines of purchase vouchers, for the period only.',
    mode: 'period',
    icon: 'receipt_long',
  },
}

const reportId = computed(() => String(route.params.reportId ?? ''))
const meta = computed<ReportMeta | null>(() => REPORTS[reportId.value] ?? null)
const isAsAt = computed(() => meta.value?.mode === 'asat')

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

const from = ref(session.activePeriod.from)
const to = ref(session.activePeriod.to)
const partyFilter = ref('')
const groupFilter = ref('')

const currency = computed(() => session.activeCompany?.baseCurrency ?? 'INR')

const periodLabel = computed(() =>
  isAsAt.value
    ? `As at ${formatDate(to.value)}`
    : `${formatDate(from.value)} to ${formatDate(to.value)}`,
)

const groupOptions = computed(() => [
  { value: '', label: 'All groups' },
  ...(Object.keys(ACCOUNT_GROUP_LABELS) as AccountGroup[]).map((group) => ({
    value: group,
    label: ACCOUNT_GROUP_LABELS[group],
  })),
])

const partyOptions = computed(() => {
  const pool =
    reportId.value === 'payables' ? session.supplierLedgers : session.customerLedgers
  return [
    { value: '', label: 'All parties' },
    ...pool.map((ledger) => ({ value: ledger.id, label: ledger.name })),
  ]
})

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

/** Every posted voucher of the company: needed for positions at a date. */
const allVouchers = ref<Voucher[]>([])
/** Posted vouchers of the selected period. */
const periodVouchers = ref<Voucher[]>([])
/** The stored bill-wise allocations of the company. */
const storedAllocations = ref<AllocationRecord[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

async function load() {
  const companyId = session.activeCompanyId
  if (!companyId) {
    allVouchers.value = []
    periodVouchers.value = []
    storedAllocations.value = []
    loading.value = false
    return
  }
  loading.value = true
  error.value = null
  try {
    const [vouchers, period, allocations] = await Promise.all([
      session.repository.listVouchers(companyId, { status: 'posted' }),
      session.repository.listVouchers(companyId, {
        from: from.value,
        to: to.value,
        status: 'posted',
      }),
      // The stored allocation records: which receipt settled which invoice.
      session.repository.listAllocations(companyId),
    ])
    allVouchers.value = vouchers
    periodVouchers.value = period
    storedAllocations.value = allocations
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'The report could not be built.'
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  if (!session.ready && !session.loading) await session.bootstrap()
  from.value = session.activePeriod.from
  to.value = session.activePeriod.to
  await load()
})
watch([from, to], load)
watch(
  () => [session.activeCompanyId, session.activeYearId],
  () => {
    from.value = session.activePeriod.from
    to.value = session.activePeriod.to
    void load()
  },
)
watch(reportId, () => {
  partyFilter.value = ''
  groupFilter.value = ''
})

// ---------------------------------------------------------------------------
// Report bodies
// ---------------------------------------------------------------------------

const sheet = computed(() =>
  balanceSheet(session.ledgers, allVouchers.value, { asOf: to.value }),
)

const pnl = computed(() =>
  profitAndLoss(session.ledgers, periodVouchers.value, { from: from.value, to: to.value }),
)

const trial = computed(() =>
  trialBalance(session.ledgers, periodVouchers.value, { from: from.value, to: to.value }),
)

const trialRows = computed(() => {
  if (!groupFilter.value) return trial.value.rows
  return trial.value.rows.filter((row) => row.group === groupFilter.value)
})

/**
 * The bill-wise position of every invoice, built by the domain over the posted
 * vouchers and checked against the stored allocation records.
 */
type BillRow = {
  voucherId: string
  voucherNumber: string
  partyId: string
  partyName: string
  date: string
  dueDate: string
  amount: number
  allocated: number
  outstanding: number
  side: 'receivable' | 'payable'
  status: 'open' | 'partial' | 'settled' | 'overdue'
  /** The stored allocation of the invoice, when the company holds one. */
  storedAllocated: number | null
  /** True when the stored allocation no longer agrees with the books. */
  outOfSync: boolean
}

/** The posted vouchers of the company, by id. */
const postedVoucherIds = computed(() => new Set(allVouchers.value.map((voucher) => voucher.id)))

/**
 * The stored allocation of each invoice. A record whose receipt or invoice is
 * no longer posted has been withdrawn by the books, so it is left out.
 */
const storedByInvoice = computed(() => {
  const map = new Map<string, number>()
  for (const record of storedAllocations.value) {
    if (!postedVoucherIds.value.has(record.paymentVoucherId)) continue
    if (!postedVoucherIds.value.has(record.invoiceVoucherId)) continue
    const amount = (map.get(record.invoiceVoucherId) ?? 0) + record.amount
    map.set(record.invoiceVoucherId, amount)
  }
  return map
})

const billPosition = computed<BillRow[]>(() => {
  const ledger = buildAllocationLedger(allVouchers.value, {
    asOf: to.value,
    dueDays: 30,
    idFactory: () => 'allocation',
    now: () => new Date().toISOString(),
  })

  return ledger.invoices.map((invoice) => {
    const stored = storedByInvoice.value.get(invoice.voucherId) ?? null
    // The stored allocation is the position of record. It is read for every
    // invoice; while it agrees with the books it is the figure shown, and when
    // it does not, the books are shown and the difference is reported in the
    // reconciliation below rather than hidden.
    const agrees = stored === null || stored === invoice.allocated
    return {
      voucherId: invoice.voucherId,
      voucherNumber: invoice.voucherNumber,
      partyId: invoice.partyId,
      partyName:
        session.ledgers.find((ledger) => ledger.id === invoice.partyId)?.name ?? 'Unknown party',
      date: invoice.date,
      dueDate: invoice.dueDate,
      amount: invoice.amount,
      allocated: invoice.allocated,
      outstanding: invoice.outstanding,
      side: invoice.side,
      status: invoice.status,
      storedAllocated: stored,
      outOfSync: stored !== null && !agrees,
    }
  })
})

type AgeingBucket = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90plus'

const AGEING_BUCKETS: Array<{ key: AgeingBucket; label: string }> = [
  { key: 'current', label: 'Current' },
  { key: 'd1_30', label: '1–30 days' },
  { key: 'd31_60', label: '31–60 days' },
  { key: 'd61_90', label: '61–90 days' },
  { key: 'd90plus', label: 'Over 90 days' },
]

function bucketFor(dueDate: string, asOf: string): AgeingBucket {
  const overdue = daysBetween(dueDate, asOf)
  if (overdue <= 0) return 'current'
  if (overdue <= 30) return 'd1_30'
  if (overdue <= 60) return 'd31_60'
  if (overdue <= 90) return 'd61_90'
  return 'd90plus'
}

type AgeingRow = {
  partyId: string
  partyName: string
  buckets: Record<AgeingBucket, number>
  total: number
  oldestDueDate: string
}

function ageingRows(kind: 'receivables' | 'payables'): AgeingRow[] {
  const rows = new Map<string, AgeingRow>()
  const side = kind === 'receivables' ? 'receivable' : 'payable'

  for (const invoice of billPosition.value) {
    if (invoice.side !== side) continue
    if (invoice.outstanding <= 0) continue
    const ledger = session.ledgers.find((candidate) => candidate.id === invoice.partyId)
    if (!ledger || !ledger.partyKind) continue
    if (partyFilter.value && invoice.partyId !== partyFilter.value) continue

    const bucket = bucketFor(invoice.dueDate, to.value)
    const existing = rows.get(invoice.partyId)
    if (existing) {
      existing.buckets[bucket] += invoice.outstanding
      existing.total += invoice.outstanding
      if (invoice.dueDate < existing.oldestDueDate) existing.oldestDueDate = invoice.dueDate
    } else {
      rows.set(invoice.partyId, {
        partyId: invoice.partyId,
        partyName: ledger.name,
        buckets: { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, [bucket]: invoice.outstanding },
        total: invoice.outstanding,
        oldestDueDate: invoice.dueDate,
      })
    }
  }

  return [...rows.values()].sort((left, right) => right.total - left.total)
}

const receivableRows = computed(() => ageingRows('receivables'))
const payableRows = computed(() => ageingRows('payables'))

function bucketTotals(rows: AgeingRow[]): Record<AgeingBucket, number> {
  const totals: Record<AgeingBucket, number> = {
    current: 0,
    d1_30: 0,
    d31_60: 0,
    d61_90: 0,
    d90plus: 0,
  }
  for (const row of rows) {
    for (const bucket of AGEING_BUCKETS) totals[bucket.key] += row.buckets[bucket.key]
  }
  return totals
}

const receivableTotals = computed(() => bucketTotals(receivableRows.value))
const payableTotals = computed(() => bucketTotals(payableRows.value))

// ---------------------------------------------------------------------------
// Reconciliation with the party ledger
// ---------------------------------------------------------------------------

/** The closing balance of every ledger at the reporting date. */
const ledgerBalances = computed(() => {
  const map = new Map<string, number>()
  for (const balance of computeLedgerBalances(session.ledgers, allVouchers.value, {
    to: to.value,
  })) {
    map.set(balance.ledger.id, balance.closing)
  }
  return map
})

type ReconciliationRow = {
  partyId: string
  partyName: string
  ageing: number
  ledgerBalance: number
  difference: number
}

type Reconciliation = {
  ageingTotal: number
  ledgerTotal: number
  difference: number
  rows: ReconciliationRow[]
}

/**
 * The ageing total against the balance the party ledger carries.
 *
 * The two do not have to agree: money that is on the ledger but on no invoice
 * — an advance, a credit note, a journal or an opening balance — is part of
 * the balance and not part of any invoice. The difference is reported, never
 * hidden.
 */
function reconciliationFor(kind: 'receivables' | 'payables'): Reconciliation {
  const side = kind === 'receivables' ? 'receivable' : 'payable'
  const pool = kind === 'receivables' ? session.customerLedgers : session.supplierLedgers
  const ageing = kind === 'receivables' ? receivableRows.value : payableRows.value

  const rows: ReconciliationRow[] = []
  let ageingTotal = 0
  let ledgerTotal = 0

  for (const party of pool) {
    if (partyFilter.value && party.id !== partyFilter.value) continue
    const closing = ledgerBalances.value.get(party.id) ?? 0
    // A customer owes what its ledger carries as a debit balance; a supplier is
    // owed what its ledger carries as a credit balance.
    const balance = side === 'receivable' ? Math.max(0, closing) : Math.max(0, -closing)
    const partyAgeing = ageing
      .filter((row) => row.partyId === party.id)
      .reduce((sum, row) => sum + row.total, 0)

    ageingTotal += partyAgeing
    ledgerTotal += balance
    if (balance !== partyAgeing) {
      rows.push({
        partyId: party.id,
        partyName: party.name,
        ageing: partyAgeing,
        ledgerBalance: balance,
        difference: balance - partyAgeing,
      })
    }
  }

  return { ageingTotal, ledgerTotal, difference: ledgerTotal - ageingTotal, rows }
}

const receivableReconciliation = computed(() => reconciliationFor('receivables'))
const payableReconciliation = computed(() => reconciliationFor('payables'))

/** The reconciliation of the report on screen. */
const activeReconciliation = computed(() =>
  reportId.value === 'payables' ? payableReconciliation.value : receivableReconciliation.value,
)

/** Invoices whose stored allocation no longer agrees with the books. */
const outOfSyncInvoices = computed(() => billPosition.value.filter((row) => row.outOfSync))

// GST summary ---------------------------------------------------------------

type TaxRow = {
  categoryId: string
  categoryName: string
  typeLabel: string
  taxable: number
  tax: number
}

function taxRowsFor(side: 'output' | 'input'): TaxRow[] {
  const source = side === 'output' ? 'sales' : 'purchase'
  const map = new Map<string, TaxRow>()

  for (const voucher of periodVouchers.value) {
    if (voucher.type !== source) continue
    for (const line of voucher.taxes) {
      const category = session.taxCategories.find(
        (candidate) => candidate.id === line.taxCategoryId,
      )
      const existing = map.get(line.taxCategoryId)
      if (existing) {
        existing.taxable += line.taxable
        existing.tax += line.amount
      } else {
        map.set(line.taxCategoryId, {
          categoryId: line.taxCategoryId,
          categoryName: category?.name ?? 'Unmapped tax category',
          typeLabel: category ? category.type.toUpperCase() : '—',
          taxable: line.taxable,
          tax: line.amount,
        })
      }
    }
  }

  return [...map.values()].sort((left, right) => right.tax - left.tax)
}

const outputTaxRows = computed(() => taxRowsFor('output'))
const inputTaxRows = computed(() => taxRowsFor('input'))

const outputTaxTotal = computed(() =>
  outputTaxRows.value.reduce((sum, row) => sum + row.tax, 0),
)
const inputTaxTotal = computed(() => inputTaxRows.value.reduce((sum, row) => sum + row.tax, 0))
const outputTaxableTotal = computed(() =>
  outputTaxRows.value.reduce((sum, row) => sum + row.taxable, 0),
)
const inputTaxableTotal = computed(() =>
  inputTaxRows.value.reduce((sum, row) => sum + row.taxable, 0),
)
const gstDifference = computed(() => outputTaxTotal.value - inputTaxTotal.value)

// ---------------------------------------------------------------------------
// Drill-down
// ---------------------------------------------------------------------------

type Drill = {
  title: string
  ledgerId?: string
  partyId?: string
  taxCategoryId?: string
}

type DrillRow = {
  id: string
  date: string
  number: string
  type: string
  party: string
  narration: string
  debit: number
  credit: number
  taxable: number | null
  tax: number | null
}

const drill = ref<Drill | null>(null)
const drillOpen = ref(false)

const scopeVouchers = computed(() =>
  isAsAt.value
    ? allVouchers.value.filter((voucher) => voucher.date <= to.value)
    : periodVouchers.value,
)

const drillRows = computed<DrillRow[]>(() => {
  const current = drill.value
  if (!current) return []

  const rows: DrillRow[] = []
  for (const voucher of scopeVouchers.value) {
    const party = voucher.partyId
      ? (session.ledgers.find((ledger) => ledger.id === voucher.partyId)?.name ?? '')
      : ''

    if (current.ledgerId) {
      const entries = voucher.entries.filter((entry) => entry.ledgerId === current.ledgerId)
      if (!entries.length) continue
      rows.push({
        id: voucher.id,
        date: voucher.date,
        number: voucher.number,
        type: voucher.type,
        party,
        narration: entries[0].narration || voucher.narration || '—',
        debit: entries.reduce((sum, entry) => sum + entry.debit, 0),
        credit: entries.reduce((sum, entry) => sum + entry.credit, 0),
        taxable: null,
        tax: null,
      })
      continue
    }

    if (current.partyId) {
      if (voucher.partyId !== current.partyId) continue
      const entries = voucher.entries.filter((entry) => entry.ledgerId === current.partyId)
      rows.push({
        id: voucher.id,
        date: voucher.date,
        number: voucher.number,
        type: voucher.type,
        party,
        narration: voucher.narration || '—',
        debit: entries.reduce((sum, entry) => sum + entry.debit, 0),
        credit: entries.reduce((sum, entry) => sum + entry.credit, 0),
        taxable: null,
        tax: null,
      })
      continue
    }

    if (current.taxCategoryId) {
      const line = voucher.taxes.find((tax) => tax.taxCategoryId === current.taxCategoryId)
      if (!line) continue
      rows.push({
        id: voucher.id,
        date: voucher.date,
        number: voucher.number,
        type: voucher.type,
        party,
        narration: voucher.narration || '—',
        debit: totalDebit(voucher),
        credit: totalCredit(voucher),
        taxable: line.taxable,
        tax: line.amount,
      })
    }
  }

  return rows.sort((left, right) =>
    left.date === right.date
      ? left.number.localeCompare(right.number)
      : left.date < right.date
        ? 1
        : -1,
  )
})

const drillTotals = computed(() => ({
  debit: drillRows.value.reduce((sum, row) => sum + row.debit, 0),
  credit: drillRows.value.reduce((sum, row) => sum + row.credit, 0),
  taxable: drillRows.value.reduce((sum, row) => sum + (row.taxable ?? 0), 0),
  tax: drillRows.value.reduce((sum, row) => sum + (row.tax ?? 0), 0),
}))

function openLedgerDrill(ledgerId: string, ledgerName: string) {
  drill.value = { title: ledgerName, ledgerId }
  drillOpen.value = true
}

function openPartyDrill(partyId: string, partyName: string) {
  drill.value = { title: partyName, partyId }
  drillOpen.value = true
}

function openTaxDrill(categoryId: string, categoryName: string) {
  drill.value = { title: categoryName, taxCategoryId: categoryId }
  drillOpen.value = true
}

// ---------------------------------------------------------------------------
// Export and print
// ---------------------------------------------------------------------------

const exportHeader = computed<string[]>(() => {
  switch (reportId.value) {
    case 'balance-sheet':
      return ['Section', 'Ledger', 'Amount']
    case 'profit-and-loss':
      return ['Section', 'Ledger', 'Amount']
    case 'trial-balance':
      return ['Ledger', 'Group', 'Opening', 'Debit', 'Credit', 'Closing']
    case 'receivables':
    case 'payables':
      return ['Party', 'Current', '1-30 days', '31-60 days', '61-90 days', 'Over 90 days', 'Total']
    case 'gst-summary':
      return ['Side', 'Tax category', 'Type', 'Taxable', 'Tax']
    default:
      return []
  }
})

const exportRows = computed<string[][]>(() => {
  switch (reportId.value) {
    case 'balance-sheet': {
      const rows: string[][] = []
      for (const row of sheet.value.assetRows) {
        rows.push(['Assets', row.ledgerName, formatAmount(row.closing)])
      }
      rows.push(['Assets', 'Total assets', formatAmount(sheet.value.assets)])
      for (const row of sheet.value.liabilityRows) {
        rows.push(['Liabilities', row.ledgerName, formatAmount(-row.closing)])
      }
      rows.push(['Liabilities', 'Total liabilities', formatAmount(sheet.value.liabilities)])
      for (const row of sheet.value.equityRows) {
        rows.push(['Equity', row.ledgerName, formatAmount(-row.closing)])
      }
      rows.push(['Equity', 'Profit for the period', formatAmount(sheet.value.profit)])
      rows.push(['Equity', 'Total equity', formatAmount(sheet.value.totalEquity)])
      rows.push(['Difference', 'Assets less liabilities and equity', formatAmount(sheet.value.difference)])
      return rows
    }
    case 'profit-and-loss': {
      const rows: string[][] = []
      for (const row of pnl.value.incomeRows) {
        rows.push(['Income', row.ledgerName, formatAmount(row.closing)])
      }
      rows.push(['Income', 'Total income', formatAmount(pnl.value.income)])
      for (const row of pnl.value.expenseRows) {
        rows.push(['Expense', row.ledgerName, formatAmount(row.closing)])
      }
      rows.push(['Expense', 'Total expenses', formatAmount(pnl.value.expense)])
      rows.push(['Result', 'Net profit', formatAmount(pnl.value.net)])
      return rows
    }
    case 'trial-balance': {
      const rows: string[][] = trialRows.value.map((row) => [
        row.ledgerName,
        ACCOUNT_GROUP_LABELS[row.group],
        formatAmount(row.opening),
        formatAmount(row.debit),
        formatAmount(row.credit),
        formatAmount(row.closing),
      ])
      rows.push([
        'Total',
        '',
        '',
        formatAmount(trial.value.totalDebit),
        formatAmount(trial.value.totalCredit),
        formatAmount(trial.value.closingNet),
      ])
      return rows
    }
    case 'receivables':
    case 'payables': {
      const rows = ageingRows(reportId.value)
      return rows.map((row) => [
        row.partyName,
        formatAmount(row.buckets.current),
        formatAmount(row.buckets.d1_30),
        formatAmount(row.buckets.d31_60),
        formatAmount(row.buckets.d61_90),
        formatAmount(row.buckets.d90plus),
        formatAmount(row.total),
      ])
    }
    case 'gst-summary': {
      const rows: string[][] = []
      for (const row of outputTaxRows.value) {
        rows.push(['Output', row.categoryName, row.typeLabel, formatAmount(row.taxable), formatAmount(row.tax)])
      }
      for (const row of inputTaxRows.value) {
        rows.push(['Input', row.categoryName, row.typeLabel, formatAmount(row.taxable), formatAmount(row.tax)])
      }
      rows.push(['Output', 'Total output tax', '', formatAmount(outputTaxableTotal.value), formatAmount(outputTaxTotal.value)])
      rows.push(['Input', 'Total input tax', '', formatAmount(inputTaxableTotal.value), formatAmount(inputTaxTotal.value)])
      rows.push(['Difference', 'Output less input tax', '', '', formatAmount(gstDifference.value)])
      return rows
    }
    default:
      return []
  }
})

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function exportCsv() {
  const current = meta.value
  if (!current) return
  const lines: string[][] = [
    [current.name],
    ['Company', session.activeCompany?.name ?? ''],
    ['Financial year', session.activeFinancialYear?.label ?? ''],
    ['Period', periodLabel.value],
    ['Basis', current.basis],
    [],
    exportHeader.value,
    ...exportRows.value,
  ]
  const csv = lines.map((cells) => cells.map(csvCell).join(',')).join('\r\n')
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${current.id}-${from.value}-to-${to.value}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
  toast.success('Report exported', `${current.name} was written to a CSV file on this machine.`)
}

function printReport() {
  window.print()
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <!-- Unknown report -->
    <div v-if="!meta" class="flex h-full items-center justify-center p-space-lg">
      <div class="w-full max-w-md">
        <BaseEmptyState
          title="Report not found"
          :description="`There is no report called “${reportId}”. Pick one from the report library.`"
          :icon="MaterialIcon"
        >
          <BaseButton
            size="sm"
            variant="primary"
            icon="arrow_back"
            @click="router.push({ name: 'reports' })"
          >
            Back to reports
          </BaseButton>
        </BaseEmptyState>
      </div>
    </div>

    <template v-else>
      <PageHeader
        :title="meta.name"
        :subtitle="meta.description"
        :icon="meta.icon"
        :breadcrumb="[
          { label: 'Home', to: '/' },
          { label: 'Reports', to: '/reports' },
          { label: meta.name },
        ]"
      >
        <template #actions>
          <BaseButton size="sm" variant="outlined" icon="download" @click="exportCsv">
            Export CSV
          </BaseButton>
          <BaseButton size="sm" variant="outlined" icon="print" @click="printReport">
            Print
          </BaseButton>
        </template>
      </PageHeader>

      <FilterBar class="no-print">
        <BaseInput
          v-model="from"
          label="From"
          type="date"
          size="sm"
          class="w-40"
          :disabled="isAsAt"
          :hint="isAsAt ? 'A position is taken at the To date only.' : undefined"
        />
        <BaseInput
          v-model="to"
          :label="isAsAt ? 'As at' : 'To'"
          type="date"
          size="sm"
          class="w-40"
        />
        <BaseSelect
          v-if="reportId === 'receivables' || reportId === 'payables'"
          v-model="partyFilter"
          label="Party"
          :options="partyOptions"
          size="sm"
          class="w-56"
        />
        <BaseSelect
          v-if="reportId === 'trial-balance'"
          v-model="groupFilter"
          label="Account group"
          :options="groupOptions"
          size="sm"
          class="w-48"
        />
        <template #trailing>
          <span class="text-label-sm text-outline">
            {{ periodLabel }} · {{ session.activeCompany?.name ?? '—' }} ·
            {{ session.activeFinancialYear?.label ?? '—' }}
          </span>
        </template>
      </FilterBar>

      <div class="min-h-0 flex-1 overflow-auto p-space-lg">
        <div v-if="loading" class="space-y-space-md">
          <BaseSkeleton class="h-12" />
          <BaseSkeleton class="h-72" />
        </div>

        <div
          v-else-if="error"
          class="rounded-md border-l-4 border-l-error bg-error-container p-space-md text-body-md text-on-error-container"
          role="alert"
        >
          <p class="font-semibold">The report could not be built</p>
          <p class="mt-0.5">{{ error }}</p>
        </div>

        <div v-else class="space-y-space-md">
          <div
            class="flex items-start gap-space-sm rounded-sm bg-surface-container-low p-space-sm text-label-sm text-on-surface-variant"
          >
            <MaterialIcon name="info" :size="16" class="mt-0.5 shrink-0 text-primary" />
            <p>
              <span class="font-semibold text-on-surface">Data basis:</span>
              {{ meta.basis }}
            </p>
          </div>

          <!-- ============================================================ -->
          <!-- Balance sheet                                                 -->
          <!-- ============================================================ -->
          <template v-if="reportId === 'balance-sheet'">
            <div
              v-if="sheet.difference !== 0"
              class="flex items-start gap-space-sm rounded-md border-l-4 border-l-error bg-error-container p-space-md text-body-md text-on-error-container"
              role="alert"
            >
              <MaterialIcon name="error" :size="20" class="mt-0.5 shrink-0" />
              <p>
                <span class="font-semibold">The books do not balance.</span>
                Difference: {{ formatMoney(sheet.difference, currency) }}. Assets are
                {{ sheet.difference > 0 ? 'more' : 'less' }} than liabilities and equity by that
                amount.
              </p>
            </div>

            <div v-else class="flex items-start gap-space-sm rounded-md border-l-4 border-l-secondary bg-secondary-container p-space-md text-body-sm text-on-secondary-container">
              <MaterialIcon name="check_circle" :size="18" class="mt-0.5 shrink-0" />
              <p>The books balance: assets equal liabilities and equity exactly.</p>
            </div>

            <section class="print-surface rounded-md bg-surface-container-lowest shadow-sm">
              <h2 class="border-b border-surface-container px-space-md py-space-sm text-headline-sm text-on-surface">
                Assets
              </h2>
              <table v-if="sheet.assetRows.length" class="w-full text-left text-body-sm">
                <thead class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline">
                  <tr>
                    <th scope="col" class="px-space-md py-2">Ledger</th>
                    <th scope="col" class="px-space-md py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-surface-container-low">
                  <tr
                    v-for="row in sheet.assetRows"
                    :key="row.ledgerId"
                    class="cursor-pointer hover:bg-surface-container-low/70"
                    @click="openLedgerDrill(row.ledgerId, row.ledgerName)"
                  >
                    <td class="px-space-md py-1.5 text-on-surface">{{ row.ledgerName }}</td>
                    <td class="px-space-md py-1.5 text-right text-numeric-sm tabular text-on-surface">
                      {{ formatMoney(row.closing, currency) }}
                    </td>
                  </tr>
                </tbody>
                <tfoot class="bg-surface-container-low/60">
                  <tr class="text-numeric-sm font-bold">
                    <td class="px-space-md py-2 text-on-surface">Total assets</td>
                    <td class="px-space-md py-2 text-right tabular text-on-surface">
                      {{ formatMoney(sheet.assets, currency) }}
                    </td>
                  </tr>
                </tfoot>
              </table>
              <BaseEmptyState
                v-else
                size="sm"
                title="No assets"
                description="No ledger of the asset group carries a balance."
                :icon="MaterialIcon"
              />
            </section>

            <section class="print-surface rounded-md bg-surface-container-lowest shadow-sm">
              <h2 class="border-b border-surface-container px-space-md py-space-sm text-headline-sm text-on-surface">
                Liabilities
              </h2>
              <table v-if="sheet.liabilityRows.length" class="w-full text-left text-body-sm">
                <thead class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline">
                  <tr>
                    <th scope="col" class="px-space-md py-2">Ledger</th>
                    <th scope="col" class="px-space-md py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-surface-container-low">
                  <tr
                    v-for="row in sheet.liabilityRows"
                    :key="row.ledgerId"
                    class="cursor-pointer hover:bg-surface-container-low/70"
                    @click="openLedgerDrill(row.ledgerId, row.ledgerName)"
                  >
                    <td class="px-space-md py-1.5 text-on-surface">{{ row.ledgerName }}</td>
                    <td class="px-space-md py-1.5 text-right text-numeric-sm tabular text-on-surface">
                      {{ formatMoney(-row.closing, currency) }}
                    </td>
                  </tr>
                </tbody>
                <tfoot class="bg-surface-container-low/60">
                  <tr class="text-numeric-sm font-bold">
                    <td class="px-space-md py-2 text-on-surface">Total liabilities</td>
                    <td class="px-space-md py-2 text-right tabular text-on-surface">
                      {{ formatMoney(sheet.liabilities, currency) }}
                    </td>
                  </tr>
                </tfoot>
              </table>
              <BaseEmptyState
                v-else
                size="sm"
                title="No liabilities"
                description="No ledger of the liability group carries a balance."
                :icon="MaterialIcon"
              />
            </section>

            <section class="print-surface rounded-md bg-surface-container-lowest shadow-sm">
              <h2 class="border-b border-surface-container px-space-md py-space-sm text-headline-sm text-on-surface">
                Equity
              </h2>
              <table class="w-full text-left text-body-sm">
                <thead class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline">
                  <tr>
                    <th scope="col" class="px-space-md py-2">Ledger</th>
                    <th scope="col" class="px-space-md py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-surface-container-low">
                  <tr
                    v-for="row in sheet.equityRows"
                    :key="row.ledgerId"
                    class="cursor-pointer hover:bg-surface-container-low/70"
                    @click="openLedgerDrill(row.ledgerId, row.ledgerName)"
                  >
                    <td class="px-space-md py-1.5 text-on-surface">{{ row.ledgerName }}</td>
                    <td class="px-space-md py-1.5 text-right text-numeric-sm tabular text-on-surface">
                      {{ formatMoney(-row.closing, currency) }}
                    </td>
                  </tr>
                  <tr>
                    <td class="px-space-md py-1.5 text-on-surface">Profit for the period</td>
                    <td class="px-space-md py-1.5 text-right text-numeric-sm tabular text-on-surface">
                      {{ formatMoney(sheet.profit, currency) }}
                    </td>
                  </tr>
                </tbody>
                <tfoot class="bg-surface-container-low/60">
                  <tr class="text-numeric-sm font-bold">
                    <td class="px-space-md py-2 text-on-surface">Total equity</td>
                    <td class="px-space-md py-2 text-right tabular text-on-surface">
                      {{ formatMoney(sheet.totalEquity, currency) }}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </section>

            <section class="rounded-md bg-surface-container-lowest shadow-sm">
              <table class="w-full text-left text-body-sm">
                <tbody>
                  <tr class="border-b border-surface-container-low">
                    <td class="px-space-md py-2 font-semibold text-on-surface">
                      Assets less liabilities and equity
                    </td>
                    <td
                      class="px-space-md py-2 text-right text-numeric-sm font-bold tabular"
                      :class="sheet.difference === 0 ? 'text-secondary' : 'text-error'"
                    >
                      {{ formatMoney(sheet.difference, currency) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </section>
          </template>

          <!-- ============================================================ -->
          <!-- Profit and loss                                               -->
          <!-- ============================================================ -->
          <template v-else-if="reportId === 'profit-and-loss'">
            <section class="print-surface rounded-md bg-surface-container-lowest shadow-sm">
              <h2 class="border-b border-surface-container px-space-md py-space-sm text-headline-sm text-on-surface">
                Income
              </h2>
              <table v-if="pnl.incomeRows.length" class="w-full text-left text-body-sm">
                <thead class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline">
                  <tr>
                    <th scope="col" class="px-space-md py-2">Ledger</th>
                    <th scope="col" class="px-space-md py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-surface-container-low">
                  <tr
                    v-for="row in pnl.incomeRows"
                    :key="row.ledgerId"
                    class="cursor-pointer hover:bg-surface-container-low/70"
                    @click="openLedgerDrill(row.ledgerId, row.ledgerName)"
                  >
                    <td class="px-space-md py-1.5 text-on-surface">{{ row.ledgerName }}</td>
                    <td class="px-space-md py-1.5 text-right text-numeric-sm tabular text-on-surface">
                      {{ formatMoney(row.closing, currency) }}
                    </td>
                  </tr>
                </tbody>
                <tfoot class="bg-surface-container-low/60">
                  <tr class="text-numeric-sm font-bold">
                    <td class="px-space-md py-2 text-on-surface">Total income</td>
                    <td class="px-space-md py-2 text-right tabular text-on-surface">
                      {{ formatMoney(pnl.income, currency) }}
                    </td>
                  </tr>
                </tfoot>
              </table>
              <BaseEmptyState
                v-else
                size="sm"
                title="No income in this period"
                description="No income ledger moved between the selected dates."
                :icon="MaterialIcon"
              />
            </section>

            <section class="print-surface rounded-md bg-surface-container-lowest shadow-sm">
              <h2 class="border-b border-surface-container px-space-md py-space-sm text-headline-sm text-on-surface">
                Expenses
              </h2>
              <table v-if="pnl.expenseRows.length" class="w-full text-left text-body-sm">
                <thead class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline">
                  <tr>
                    <th scope="col" class="px-space-md py-2">Ledger</th>
                    <th scope="col" class="px-space-md py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-surface-container-low">
                  <tr
                    v-for="row in pnl.expenseRows"
                    :key="row.ledgerId"
                    class="cursor-pointer hover:bg-surface-container-low/70"
                    @click="openLedgerDrill(row.ledgerId, row.ledgerName)"
                  >
                    <td class="px-space-md py-1.5 text-on-surface">{{ row.ledgerName }}</td>
                    <td class="px-space-md py-1.5 text-right text-numeric-sm tabular text-on-surface">
                      {{ formatMoney(row.closing, currency) }}
                    </td>
                  </tr>
                </tbody>
                <tfoot class="bg-surface-container-low/60">
                  <tr class="text-numeric-sm font-bold">
                    <td class="px-space-md py-2 text-on-surface">Total expenses</td>
                    <td class="px-space-md py-2 text-right tabular text-on-surface">
                      {{ formatMoney(pnl.expense, currency) }}
                    </td>
                  </tr>
                </tfoot>
              </table>
              <BaseEmptyState
                v-else
                size="sm"
                title="No expenses in this period"
                description="No expense ledger moved between the selected dates."
                :icon="MaterialIcon"
              />
            </section>

            <section class="rounded-md bg-surface-container-lowest shadow-sm">
              <table class="w-full text-left text-body-sm">
                <tbody>
                  <tr class="border-b border-surface-container-low">
                    <td class="px-space-md py-2 font-semibold text-on-surface">Net profit</td>
                    <td
                      class="px-space-md py-2 text-right text-numeric-lg font-bold tabular"
                      :class="pnl.net < 0 ? 'text-tertiary' : 'text-secondary'"
                    >
                      {{ formatMoney(pnl.net, currency) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </section>
          </template>

          <!-- ============================================================ -->
          <!-- Trial balance                                                 -->
          <!-- ============================================================ -->
          <template v-else-if="reportId === 'trial-balance'">
            <section class="print-surface rounded-md bg-surface-container-lowest shadow-sm">
              <table v-if="trialRows.length" class="w-full text-left text-body-sm">
                <thead class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline">
                  <tr>
                    <th scope="col" class="px-space-md py-2">Ledger</th>
                    <th scope="col" class="px-space-md py-2">Group</th>
                    <th scope="col" class="px-space-md py-2 text-right">Opening</th>
                    <th scope="col" class="px-space-md py-2 text-right">Debit</th>
                    <th scope="col" class="px-space-md py-2 text-right">Credit</th>
                    <th scope="col" class="px-space-md py-2 text-right">Closing</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-surface-container-low">
                  <tr
                    v-for="row in trialRows"
                    :key="row.ledgerId"
                    class="cursor-pointer hover:bg-surface-container-low/70"
                    @click="openLedgerDrill(row.ledgerId, row.ledgerName)"
                  >
                    <td class="px-space-md py-1.5 text-on-surface">{{ row.ledgerName }}</td>
                    <td class="px-space-md py-1.5 text-on-surface-variant">
                      {{ ACCOUNT_GROUP_LABELS[row.group] }}
                    </td>
                    <td class="px-space-md py-1.5 text-right text-numeric-sm tabular text-on-surface-variant">
                      {{ formatMoney(row.opening, currency) }}
                    </td>
                    <td class="px-space-md py-1.5 text-right text-numeric-sm tabular text-on-surface-variant">
                      {{ formatMoney(row.debit, currency) }}
                    </td>
                    <td class="px-space-md py-1.5 text-right text-numeric-sm tabular text-on-surface-variant">
                      {{ formatMoney(row.credit, currency) }}
                    </td>
                    <td
                      class="px-space-md py-1.5 text-right text-numeric-sm font-bold tabular"
                      :class="row.closing < 0 ? 'text-tertiary' : 'text-on-surface'"
                    >
                      {{ formatMoney(row.closing, currency) }}
                    </td>
                  </tr>
                </tbody>
                <tfoot class="bg-surface-container-low/60">
                  <tr class="text-numeric-sm font-bold">
                    <td class="px-space-md py-2 text-on-surface" colspan="2">Total</td>
                    <td class="px-space-md py-2 text-right tabular text-on-surface-variant">—</td>
                    <td class="px-space-md py-2 text-right tabular text-on-surface">
                      {{ formatMoney(trial.totalDebit, currency) }}
                    </td>
                    <td class="px-space-md py-2 text-right tabular text-on-surface">
                      {{ formatMoney(trial.totalCredit, currency) }}
                    </td>
                    <td class="px-space-md py-2 text-right tabular text-on-surface">—</td>
                  </tr>
                  <tr class="text-numeric-sm font-bold">
                    <td class="px-space-md py-2 text-on-surface" colspan="5">
                      Difference (debit less credit)
                    </td>
                    <td
                      class="px-space-md py-2 text-right tabular"
                      :class="trial.closingNet === 0 ? 'text-secondary' : 'text-error'"
                    >
                      {{ formatMoney(trial.closingNet, currency) }}
                    </td>
                  </tr>
                </tfoot>
              </table>
              <BaseEmptyState
                v-else
                title="Nothing to report"
                description="No ledger moved between the selected dates."
                :icon="MaterialIcon"
              />
            </section>
          </template>

          <!-- ============================================================ -->
          <!-- Receivables and payables ageing                               -->
          <!-- ============================================================ -->
          <template v-else-if="reportId === 'receivables' || reportId === 'payables'">
            <section class="print-surface rounded-md bg-surface-container-lowest shadow-sm">
              <header class="flex flex-wrap items-center justify-between gap-3 border-b border-surface-container px-space-md py-space-sm">
                <h2 class="text-headline-sm text-on-surface">
                  {{ reportId === 'receivables' ? 'Receivables' : 'Payables' }} by age
                </h2>
                <span class="text-label-xs text-outline">
                  Ageing is counted from the due date of each invoice
                </span>
              </header>

              <table v-if="(reportId === 'receivables' ? receivableRows : payableRows).length" class="w-full text-left text-body-sm">
                <thead class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline">
                  <tr>
                    <th scope="col" class="px-space-md py-2">Party</th>
                    <th
                      v-for="bucket in AGEING_BUCKETS"
                      :key="bucket.key"
                      scope="col"
                      class="px-space-md py-2 text-right"
                    >
                      {{ bucket.label }}
                    </th>
                    <th scope="col" class="px-space-md py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-surface-container-low">
                  <tr
                    v-for="row in reportId === 'receivables' ? receivableRows : payableRows"
                    :key="row.partyId"
                    class="cursor-pointer hover:bg-surface-container-low/70"
                    @click="openPartyDrill(row.partyId, row.partyName)"
                  >
                    <td class="px-space-md py-1.5 text-on-surface">
                      {{ row.partyName }}
                      <span class="block text-label-xs text-outline">
                        Oldest due {{ formatDate(row.oldestDueDate) }}
                      </span>
                    </td>
                    <td
                      v-for="bucket in AGEING_BUCKETS"
                      :key="bucket.key"
                      class="px-space-md py-1.5 text-right text-numeric-sm tabular"
                      :class="row.buckets[bucket.key] ? 'text-on-surface-variant' : 'text-outline'"
                    >
                      {{ formatMoney(row.buckets[bucket.key], currency, { blankZero: true }) || '—' }}
                    </td>
                    <td class="px-space-md py-1.5 text-right text-numeric-sm font-bold tabular text-on-surface">
                      {{ formatMoney(row.total, currency) }}
                    </td>
                  </tr>
                </tbody>
                <tfoot class="bg-surface-container-low/60">
                  <tr class="text-numeric-sm font-bold">
                    <td class="px-space-md py-2 text-on-surface">Total</td>
                    <td
                      v-for="bucket in AGEING_BUCKETS"
                      :key="bucket.key"
                      class="px-space-md py-2 text-right tabular text-on-surface"
                    >
                      {{
                        formatMoney(
                          (reportId === 'receivables' ? receivableTotals : payableTotals)[bucket.key],
                          currency,
                        )
                      }}
                    </td>
                    <td class="px-space-md py-2 text-right tabular text-on-surface">
                      {{
                        formatMoney(
                          (reportId === 'receivables' ? receivableRows : payableRows).reduce(
                            (sum, row) => sum + row.total,
                            0,
                          ),
                          currency,
                        )
                      }}
                    </td>
                  </tr>
                </tfoot>
              </table>

              <BaseEmptyState
                v-else
                :title="reportId === 'receivables' ? 'Nothing receivable' : 'Nothing payable'"
                :description="
                  reportId === 'receivables'
                    ? 'No customer invoice is open at this date.'
                    : 'No supplier bill is open at this date.'
                "
                :icon="MaterialIcon"
              />
            </section>

            <!-- Reconciliation with the party ledger -->
            <section class="rounded-md bg-surface-container-lowest p-space-md shadow-sm">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <h3 class="text-headline-sm text-on-surface">
                  Reconciliation with the party ledger
                </h3>
                <BaseBadge
                  :tone="activeReconciliation.difference === 0 ? 'positive' : 'warning'"
                  size="xs"
                >
                  {{
                    activeReconciliation.difference === 0
                      ? 'Agrees with the ledger'
                      : 'Difference shown below'
                  }}
                </BaseBadge>
              </div>

              <dl class="mt-space-sm grid grid-cols-1 gap-space-sm sm:grid-cols-3">
                <div class="rounded-sm bg-surface-container-low p-space-sm">
                  <dt class="section-label">Ageing total</dt>
                  <dd class="text-numeric-md font-bold tabular text-on-surface">
                    {{ formatMoney(activeReconciliation.ageingTotal, currency) }}
                  </dd>
                </div>
                <div class="rounded-sm bg-surface-container-low p-space-sm">
                  <dt class="section-label">Party ledger balance</dt>
                  <dd class="text-numeric-md font-bold tabular text-on-surface">
                    {{ formatMoney(activeReconciliation.ledgerTotal, currency) }}
                  </dd>
                </div>
                <div class="rounded-sm bg-surface-container-low p-space-sm">
                  <dt class="section-label">Difference</dt>
                  <dd
                    class="text-numeric-md font-bold tabular"
                    :class="
                      activeReconciliation.difference === 0 ? 'text-secondary' : 'text-tertiary'
                    "
                  >
                    {{ formatMoney(activeReconciliation.difference, currency, { signed: true }) }}
                  </dd>
                </div>
              </dl>

              <p class="mt-space-sm text-body-sm text-on-surface-variant">
                <template v-if="activeReconciliation.difference === 0">
                  The ageing total agrees with the balance the party ledgers carry at this date.
                </template>
                <template v-else>
                  The ageing total and the party ledger balance do not agree. The difference is
                  money the party ledgers carry and no invoice does: an advance received or paid
                  but not yet applied, a credit or debit note, a journal or an opening balance. It
                  is shown here rather than hidden.
                </template>
              </p>

              <table
                v-if="activeReconciliation.rows.length"
                class="mt-space-sm w-full text-left text-body-sm"
              >
                <caption class="sr-only">
                  Parties whose ageing total differs from their ledger balance
                </caption>
                <thead class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline">
                  <tr>
                    <th scope="col" class="px-space-sm py-2">Party</th>
                    <th scope="col" class="px-space-sm py-2 text-right">Ageing</th>
                    <th scope="col" class="px-space-sm py-2 text-right">Ledger balance</th>
                    <th scope="col" class="px-space-sm py-2 text-right">Difference</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-surface-container-low">
                  <tr v-for="row in activeReconciliation.rows" :key="row.partyId">
                    <td class="px-space-sm py-1.5 text-on-surface">{{ row.partyName }}</td>
                    <td class="px-space-sm py-1.5 text-right tabular text-on-surface-variant">
                      {{ formatMoney(row.ageing, currency) }}
                    </td>
                    <td class="px-space-sm py-1.5 text-right tabular text-on-surface-variant">
                      {{ formatMoney(row.ledgerBalance, currency) }}
                    </td>
                    <td class="px-space-sm py-1.5 text-right tabular font-semibold text-on-surface">
                      {{ formatMoney(row.difference, currency, { signed: true }) }}
                    </td>
                  </tr>
                </tbody>
              </table>

              <p
                v-if="outOfSyncInvoices.length"
                class="mt-space-sm flex items-start gap-1 text-label-sm text-tertiary"
              >
                <MaterialIcon name="warning" :size="16" class="mt-0.5 shrink-0" />
                <span>
                  {{ outOfSyncInvoices.length }}
                  {{ outOfSyncInvoices.length === 1 ? 'invoice carries' : 'invoices carry' }} a
                  stored allocation that no longer matches the books. The books are shown and the
                  stored record is out of date.
                </span>
              </p>
            </section>
          </template>

          <!-- ============================================================ -->
          <!-- GST summary                                                   -->
          <!-- ============================================================ -->
          <template v-else-if="reportId === 'gst-summary'">
            <section class="print-surface rounded-md bg-surface-container-lowest shadow-sm">
              <h2 class="border-b border-surface-container px-space-md py-space-sm text-headline-sm text-on-surface">
                Output tax
              </h2>
              <table v-if="outputTaxRows.length" class="w-full text-left text-body-sm">
                <thead class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline">
                  <tr>
                    <th scope="col" class="px-space-md py-2">Tax category</th>
                    <th scope="col" class="px-space-md py-2">Type</th>
                    <th scope="col" class="px-space-md py-2 text-right">Taxable</th>
                    <th scope="col" class="px-space-md py-2 text-right">Tax</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-surface-container-low">
                  <tr
                    v-for="row in outputTaxRows"
                    :key="row.categoryId"
                    class="cursor-pointer hover:bg-surface-container-low/70"
                    @click="openTaxDrill(row.categoryId, row.categoryName)"
                  >
                    <td class="px-space-md py-1.5 text-on-surface">{{ row.categoryName }}</td>
                    <td class="px-space-md py-1.5 text-on-surface-variant">{{ row.typeLabel }}</td>
                    <td class="px-space-md py-1.5 text-right text-numeric-sm tabular text-on-surface-variant">
                      {{ formatMoney(row.taxable, currency) }}
                    </td>
                    <td class="px-space-md py-1.5 text-right text-numeric-sm font-bold tabular text-on-surface">
                      {{ formatMoney(row.tax, currency) }}
                    </td>
                  </tr>
                </tbody>
                <tfoot class="bg-surface-container-low/60">
                  <tr class="text-numeric-sm font-bold">
                    <td class="px-space-md py-2 text-on-surface" colspan="2">Total output tax</td>
                    <td class="px-space-md py-2 text-right tabular text-on-surface-variant">
                      {{ formatMoney(outputTaxableTotal, currency) }}
                    </td>
                    <td class="px-space-md py-2 text-right tabular text-on-surface">
                      {{ formatMoney(outputTaxTotal, currency) }}
                    </td>
                  </tr>
                </tfoot>
              </table>
              <BaseEmptyState
                v-else
                size="sm"
                title="No output tax"
                description="No sales voucher in this period carries a tax line."
                :icon="MaterialIcon"
              />
            </section>

            <section class="print-surface rounded-md bg-surface-container-lowest shadow-sm">
              <h2 class="border-b border-surface-container px-space-md py-space-sm text-headline-sm text-on-surface">
                Input tax
              </h2>
              <table v-if="inputTaxRows.length" class="w-full text-left text-body-sm">
                <thead class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline">
                  <tr>
                    <th scope="col" class="px-space-md py-2">Tax category</th>
                    <th scope="col" class="px-space-md py-2">Type</th>
                    <th scope="col" class="px-space-md py-2 text-right">Taxable</th>
                    <th scope="col" class="px-space-md py-2 text-right">Tax</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-surface-container-low">
                  <tr
                    v-for="row in inputTaxRows"
                    :key="row.categoryId"
                    class="cursor-pointer hover:bg-surface-container-low/70"
                    @click="openTaxDrill(row.categoryId, row.categoryName)"
                  >
                    <td class="px-space-md py-1.5 text-on-surface">{{ row.categoryName }}</td>
                    <td class="px-space-md py-1.5 text-on-surface-variant">{{ row.typeLabel }}</td>
                    <td class="px-space-md py-1.5 text-right text-numeric-sm tabular text-on-surface-variant">
                      {{ formatMoney(row.taxable, currency) }}
                    </td>
                    <td class="px-space-md py-1.5 text-right text-numeric-sm font-bold tabular text-on-surface">
                      {{ formatMoney(row.tax, currency) }}
                    </td>
                  </tr>
                </tbody>
                <tfoot class="bg-surface-container-low/60">
                  <tr class="text-numeric-sm font-bold">
                    <td class="px-space-md py-2 text-on-surface" colspan="2">Total input tax</td>
                    <td class="px-space-md py-2 text-right tabular text-on-surface-variant">
                      {{ formatMoney(inputTaxableTotal, currency) }}
                    </td>
                    <td class="px-space-md py-2 text-right tabular text-on-surface">
                      {{ formatMoney(inputTaxTotal, currency) }}
                    </td>
                  </tr>
                </tfoot>
              </table>
              <BaseEmptyState
                v-else
                size="sm"
                title="No input tax"
                description="No purchase voucher in this period carries a tax line."
                :icon="MaterialIcon"
              />
            </section>

            <section class="rounded-md bg-surface-container-lowest shadow-sm">
              <table class="w-full text-left text-body-sm">
                <tbody>
                  <tr class="border-b border-surface-container-low">
                    <td class="px-space-md py-2 font-semibold text-on-surface">
                      Output tax less input tax
                    </td>
                    <td
                      class="px-space-md py-2 text-right text-numeric-lg font-bold tabular"
                      :class="gstDifference < 0 ? 'text-tertiary' : 'text-secondary'"
                    >
                      {{ formatMoney(gstDifference, currency) }}
                    </td>
                  </tr>
                </tbody>
              </table>
              <footer class="border-t border-surface-container bg-surface-container-low/60 px-space-md py-space-sm text-label-xs text-outline">
                A positive difference is the tax collected on sales over the tax paid on purchases
                for this period. It is a figure computed from the books, not a filed return: filing
                happens on the GST portal.
              </footer>
            </section>
          </template>
        </div>
      </div>
    </template>

    <!-- Drill-down -->
    <BaseDrawer
      :open="drillOpen"
      :title="drill?.title ?? 'Detail'"
      :description="`${drillRows.length} posted vouchers`"
      width="680px"
      @close="drillOpen = false"
    >
      <div v-if="drillRows.length" class="overflow-hidden rounded-sm border border-surface-container">
        <table class="w-full text-left text-body-sm">
          <thead class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline">
            <tr>
              <th scope="col" class="px-space-sm py-2">Date</th>
              <th scope="col" class="px-space-sm py-2">Voucher</th>
              <th scope="col" class="px-space-sm py-2">Party</th>
              <th scope="col" class="px-space-sm py-2 text-right">Debit</th>
              <th scope="col" class="px-space-sm py-2 text-right">Credit</th>
              <th scope="col" class="px-space-sm py-2 text-right">Taxable</th>
              <th scope="col" class="px-space-sm py-2 text-right">Tax</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-surface-container-low">
            <tr v-for="row in drillRows" :key="row.id">
              <td class="whitespace-nowrap px-space-sm py-1.5 text-numeric-sm tabular text-outline">
                {{ formatDate(row.date) }}
              </td>
              <td class="px-space-sm py-1.5">
                <span class="block text-numeric-sm font-semibold text-on-surface">
                  {{ row.number }}
                </span>
                <span class="block text-label-xs text-outline">{{ row.narration }}</span>
              </td>
              <td class="px-space-sm py-1.5 text-on-surface-variant">{{ row.party || '—' }}</td>
              <td class="px-space-sm py-1.5 text-right text-numeric-sm tabular text-on-surface-variant">
                {{ formatMoney(row.debit, currency, { blankZero: true }) || '—' }}
              </td>
              <td class="px-space-sm py-1.5 text-right text-numeric-sm tabular text-on-surface-variant">
                {{ formatMoney(row.credit, currency, { blankZero: true }) || '—' }}
              </td>
              <td class="px-space-sm py-1.5 text-right text-numeric-sm tabular text-on-surface-variant">
                {{ row.taxable === null ? '—' : formatMoney(row.taxable, currency) }}
              </td>
              <td class="px-space-sm py-1.5 text-right text-numeric-sm tabular text-on-surface-variant">
                {{ row.tax === null ? '—' : formatMoney(row.tax, currency) }}
              </td>
            </tr>
          </tbody>
          <tfoot class="bg-surface-container-low/60">
            <tr class="text-numeric-sm font-bold">
              <td class="px-space-sm py-2 text-on-surface" colspan="3">Total</td>
              <td class="px-space-sm py-2 text-right tabular text-on-surface">
                {{ formatMoney(drillTotals.debit, currency) }}
              </td>
              <td class="px-space-sm py-2 text-right tabular text-on-surface">
                {{ formatMoney(drillTotals.credit, currency) }}
              </td>
              <td class="px-space-sm py-2 text-right tabular text-on-surface">
                {{ formatMoney(drillTotals.taxable, currency) }}
              </td>
              <td class="px-space-sm py-2 text-right tabular text-on-surface">
                {{ formatMoney(drillTotals.tax, currency) }}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <BaseEmptyState
        v-else
        size="sm"
        title="No vouchers"
        description="No posted voucher touches this line in the selected period."
        :icon="MaterialIcon"
      />
    </BaseDrawer>
  </div>
</template>
