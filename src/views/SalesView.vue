<script setup lang="ts">
import { computed, h, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseDrawer from '@/components/ui/BaseDrawer.vue'
import BaseEmptyState from '@/components/ui/BaseEmptyState.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import BaseTabs from '@/components/ui/BaseTabs.vue'
import DataTable from '@/components/ui/DataTable.vue'
import type { TableColumn } from '@/components/ui/DataTable.vue'
import FilterBar from '@/components/ui/FilterBar.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import StatTile from '@/components/ui/StatTile.vue'
import { voucherTypeLabel } from '@/app/labels'
import { buildAllocationLedger } from '@/domain/allocations'
import type { AdvanceRecord, AllocationRecord } from '@/domain/allocations'
import { totalCredit, totalDebit } from '@/domain/accounting'
import type { Voucher } from '@/domain/types'
import { daysBetween, formatDate, todayIso } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const router = useRouter()

const periodVouchers = ref<Voucher[]>([])
const allVouchers = ref<Voucher[]>([])
/** The stored bill-wise allocations: which receipt settled which invoice. */
const storedAllocations = ref<AllocationRecord[]>([])
/** Money received that no invoice has settled yet, as the repository stores it. */
const storedAdvances = ref<AdvanceRecord[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

const fromDate = ref('')
const toDate = ref('')
const outstandingTab = ref<string>('outstanding')

const currency = computed(() => session.activeCompany?.baseCurrency ?? 'INR')
const asOf = computed(() => todayIso())

const EmptyIcon = () => h(MaterialIcon, { name: 'shopping_cart', size: 19 })
const AdvanceIcon = () => h(MaterialIcon, { name: 'savings', size: 19 })

/* ------------------------------------------------------------------ *
 * Loading
 * ------------------------------------------------------------------ */

async function load() {
  const companyId = session.activeCompanyId
  if (!companyId) {
    periodVouchers.value = []
    allVouchers.value = []
    storedAllocations.value = []
    storedAdvances.value = []
    loading.value = false
    return
  }
  loading.value = true
  error.value = null
  try {
    const [period, all, allocations, advances] = await Promise.all([
      session.repository.listVouchers(companyId, {
        type: 'sales',
        from: fromDate.value || undefined,
        to: toDate.value || undefined,
      }),
      // Allocation needs the receipts as well, so every voucher is read.
      session.repository.listVouchers(companyId),
      // The stored allocation records and the advances they leave behind.
      session.repository.listAllocations(companyId),
      session.repository.listAdvances(companyId),
    ])
    periodVouchers.value = period
    allVouchers.value = all
    storedAllocations.value = allocations
    storedAdvances.value = advances
  } catch (cause) {
    periodVouchers.value = []
    allVouchers.value = []
    storedAllocations.value = []
    storedAdvances.value = []
    error.value = cause instanceof Error ? cause.message : 'The sales workspace could not be loaded.'
  } finally {
    loading.value = false
  }
}

function resetPeriod() {
  const year = session.activeFinancialYear
  fromDate.value = year?.start ?? session.activePeriod.from
  toDate.value = year?.end ?? session.activePeriod.to
}

onMounted(async () => {
  if (!session.ready && !session.loading) await session.bootstrap()
  resetPeriod()
  await load()
})

watch(
  () => [session.activeCompanyId, session.activeYearId],
  async () => {
    resetPeriod()
    await load()
  },
)

let timer: number | undefined

function scheduleLoad() {
  if (timer !== undefined) window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    void load()
  }, 180)
}

onBeforeUnmount(() => {
  if (timer !== undefined) window.clearTimeout(timer)
})

watch([fromDate, toDate], () => {
  scheduleLoad()
})

/* ------------------------------------------------------------------ *
 * Period figures
 * ------------------------------------------------------------------ */

/** The amount charged to the customer — the domain's own invoice amount rule. */
function invoiceTotal(voucher: Voucher): number {
  return totalDebit(voucher) || totalCredit(voucher)
}

const postedInvoices = computed(() =>
  periodVouchers.value.filter((voucher) => voucher.status === 'posted'),
)

const salesValue = computed(() =>
  postedInvoices.value.reduce((sum, voucher) => sum + invoiceTotal(voucher), 0),
)

const invoiceCount = computed(() => postedInvoices.value.length)

const averageInvoice = computed(() =>
  invoiceCount.value > 0 ? Math.round(salesValue.value / invoiceCount.value) : 0,
)

/* ------------------------------------------------------------------ *
 * The allocation ledger
 * ------------------------------------------------------------------ */

const voucherById = computed(() => new Map(allVouchers.value.map((voucher) => [voucher.id, voucher])))

/**
 * The allocation ledger of the company, built by the domain over the vouchers
 * that were read. It is the authority for what is outstanding and for the
 * money that is held as an advance.
 */
const ledger = computed(() =>
  buildAllocationLedger(allVouchers.value, {
    asOf: asOf.value,
    dueDays: 30,
    idFactory: () => 'allocation',
    now: () => new Date().toISOString(),
  }),
)

/** The vouchers that are still posted, and therefore still settle anything. */
const postedVoucherIds = computed(() => {
  const ids = new Set<string>()
  for (const voucher of allVouchers.value) {
    if (voucher.status === 'posted') ids.add(voucher.id)
  }
  return ids
})

/**
 * The stored allocations that still hold. A record whose receipt or invoice is
 * no longer posted has been withdrawn by the books, so it is left out.
 */
const liveStoredAllocations = computed(() =>
  storedAllocations.value.filter(
    (record) =>
      record.side === 'receivable' &&
      postedVoucherIds.value.has(record.paymentVoucherId) &&
      postedVoucherIds.value.has(record.invoiceVoucherId),
  ),
)

/** The stored allocation of each invoice, with the receipts that settled it. */
const storedByInvoice = computed(() => {
  const map = new Map<string, { amount: number; settledBy: string[] }>()
  for (const record of liveStoredAllocations.value) {
    const payment = voucherById.value.get(record.paymentVoucherId)
    const entry = map.get(record.invoiceVoucherId) ?? { amount: 0, settledBy: [] }
    entry.amount += record.amount
    if (payment) entry.settledBy.push(payment.number)
    map.set(record.invoiceVoucherId, entry)
  }
  return map
})

function partyName(partyId: string): string {
  return session.ledgers.find((ledger) => ledger.id === partyId)?.name ?? 'Unknown party'
}

/* ------------------------------------------------------------------ *
 * Outstanding receivables
 * ------------------------------------------------------------------ */

type OutstandingStatus = 'open' | 'partial' | 'settled' | 'overdue'

type OutstandingRow = {
  id: string
  number: string
  partyId: string
  party: string
  date: string
  dueDate: string
  amount: number
  allocated: number
  outstanding: number
  status: OutstandingStatus
  daysLate: number
  settledBy: string[]
  /** True when the stored allocation no longer agrees with the books. */
  outOfSync: boolean
}

const outstandingRows = computed<OutstandingRow[]>(() =>
  ledger.value.invoices
    .filter((invoice) => invoice.side === 'receivable')
    .filter((invoice) => voucherById.value.get(invoice.voucherId)?.type === 'sales')
    .map((invoice) => {
      const stored = storedByInvoice.value.get(invoice.voucherId)
      // The stored allocation is the figure of record while it agrees with the
      // books. A record that no longer agrees has been left behind by a change
      // that did not rewrite it, so the books are shown and the difference is
      // reported below the table.
      const agrees = stored !== undefined && stored.amount === invoice.allocated
      return {
        id: invoice.voucherId,
        number: invoice.voucherNumber,
        partyId: invoice.partyId,
        party: partyName(invoice.partyId),
        date: invoice.date,
        dueDate: invoice.dueDate,
        amount: invoice.amount,
        allocated: agrees ? stored.amount : invoice.allocated,
        outstanding: agrees ? invoice.amount - stored.amount : invoice.outstanding,
        status: invoice.status,
        daysLate: daysBetween(invoice.dueDate, asOf.value),
        settledBy: stored?.settledBy ?? [],
        outOfSync: stored !== undefined && !agrees,
      }
    }),
)

const openOutstandingRows = computed(() =>
  outstandingRows.value.filter((row) => row.outstanding > 0),
)

const outstandingReceivables = computed(() =>
  openOutstandingRows.value.reduce((sum, row) => sum + row.outstanding, 0),
)

const overdueCount = computed(
  () => openOutstandingRows.value.filter((row) => row.status === 'overdue').length,
)

const outOfSyncCount = computed(
  () => outstandingRows.value.filter((row) => row.outOfSync).length,
)

const visibleOutstandingRows = computed(() =>
  outstandingTab.value === 'all' ? outstandingRows.value : openOutstandingRows.value,
)

const outstandingTabs = computed(() => [
  { value: 'outstanding', label: 'Outstanding', count: openOutstandingRows.value.length },
  { value: 'all', label: 'All invoices', count: outstandingRows.value.length },
])

const outstandingColumns: TableColumn[] = [
  { key: 'number', label: 'Invoice no.', sortable: true, width: '150px' },
  { key: 'party', label: 'Party' },
  { key: 'date', label: 'Date', sortable: true, width: '120px' },
  { key: 'dueDate', label: 'Due date', sortable: true, width: '120px' },
  { key: 'amount', label: 'Invoice amount', align: 'right', numeric: true, sortable: true },
  { key: 'allocated', label: 'Allocated', align: 'right', numeric: true, sortable: true },
  { key: 'outstanding', label: 'Outstanding', align: 'right', numeric: true, sortable: true },
  { key: 'status', label: 'Status', width: '130px' },
]

function statusTone(status: string): 'neutral' | 'info' | 'positive' | 'warning' | 'danger' {
  switch (status) {
    case 'overdue':
      return 'danger'
    case 'partial':
      return 'warning'
    case 'settled':
      return 'positive'
    default:
      return 'info'
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'overdue':
      return 'Overdue'
    case 'partial':
      return 'Part paid'
    case 'settled':
      return 'Settled'
    default:
      return 'Open'
  }
}

/* ------------------------------------------------------------------ *
 * Advances
 * ------------------------------------------------------------------ */

type AdvanceRow = {
  id: string
  date: string
  voucherId: string
  number: string
  partyId: string
  party: string
  amount: number
}

/** The parties whose advances the repository holds in the allocation records. */
const storedAdvanceParties = computed(() => {
  const parties = new Set<string>()
  for (const advance of storedAdvances.value) {
    if (advance.side !== 'receivable') continue
    if (!postedVoucherIds.value.has(advance.voucherId)) continue
    parties.add(advance.partyId)
  }
  return parties
})

const advanceRows = computed<AdvanceRow[]>(() => {
  const stored = storedAdvances.value
    .filter(
      (advance) => advance.side === 'receivable' && postedVoucherIds.value.has(advance.voucherId),
    )
    .map((advance) => ({
      id: `stored:${advance.voucherId}:${advance.partyId}`,
      date: advance.date,
      voucherId: advance.voucherId,
      number: voucherById.value.get(advance.voucherId)?.number ?? '—',
      partyId: advance.partyId,
      party: partyName(advance.partyId),
      amount: advance.amount,
    }))

  // A party with no stored advance record falls back to the ledger the domain
  // builds from the posted vouchers, so an advance is never hidden.
  const derived = ledger.value.advances
    .filter(
      (advance) =>
        advance.side === 'receivable' && !storedAdvanceParties.value.has(advance.partyId),
    )
    .map((advance) => ({
      id: `derived:${advance.voucherId}:${advance.partyId}`,
      date: advance.date,
      voucherId: advance.voucherId,
      number: voucherById.value.get(advance.voucherId)?.number ?? '—',
      partyId: advance.partyId,
      party: partyName(advance.partyId),
      amount: advance.amount,
    }))

  return [...stored, ...derived].sort((left, right) =>
    left.date === right.date
      ? left.number.localeCompare(right.number)
      : left.date < right.date
        ? 1
        : -1,
  )
})

const advanceTotal = computed(() => advanceRows.value.reduce((sum, row) => sum + row.amount, 0))

const advanceColumns: TableColumn[] = [
  { key: 'date', label: 'Date', sortable: true, width: '130px' },
  { key: 'number', label: 'Receipt no.', sortable: true, width: '150px' },
  { key: 'party', label: 'Party' },
  { key: 'amount', label: 'Advance amount', align: 'right', numeric: true, sortable: true },
]

const advancesFromStore = computed(() => storedAdvanceParties.value.size > 0)

const advanceBasis = computed(() => {
  if (advancesFromStore.value) return 'Read from the stored allocation records.'
  if (storedAllocations.value.length > 0) {
    return 'The repository holds no advance for this company, so the advances below are derived from the posted vouchers.'
  }
  return 'This company holds no stored allocation records yet, so the advances below are derived from the posted vouchers.'
})

/* ------------------------------------------------------------------ *
 * Party drill-down
 * ------------------------------------------------------------------ */

const drillParty = ref<{ id: string; name: string } | null>(null)
const drillOpen = ref(false)

type DrillRow = {
  id: string
  date: string
  number: string
  type: string
  narration: string
  amount: number
}

/** The amount a voucher moves on the party ledger. */
function partyLegAmount(voucher: Voucher): number {
  if (!voucher.partyId) return 0
  const entry = voucher.entries.find((candidate) => candidate.ledgerId === voucher.partyId)
  return entry ? Math.abs(entry.debit - entry.credit) : 0
}

const drillRows = computed<DrillRow[]>(() => {
  const party = drillParty.value
  if (!party) return []
  return allVouchers.value
    .filter((voucher) => voucher.partyId === party.id)
    .map((voucher) => ({
      id: voucher.id,
      date: voucher.date,
      number: voucher.number,
      type: voucherTypeLabel(voucher.type),
      narration: voucher.narration || '—',
      amount: partyLegAmount(voucher),
    }))
    .sort((left, right) =>
      left.date === right.date
        ? left.number.localeCompare(right.number)
        : left.date < right.date
          ? 1
          : -1,
    )
})

function openPartyDrill(partyId: string, name: string) {
  drillParty.value = { id: partyId, name }
  drillOpen.value = true
}

/* ------------------------------------------------------------------ *
 * Recent invoices
 * ------------------------------------------------------------------ */

type InvoiceRow = {
  id: string
  number: string
  date: string
  party: string
  tax: number
  total: number
  status: string
}

const recentRows = computed<InvoiceRow[]>(() =>
  periodVouchers.value.slice(0, 25).map((voucher) => ({
    id: voucher.id,
    number: voucher.number,
    date: voucher.date,
    party: voucher.partyId
      ? (session.ledgers.find((ledger) => ledger.id === voucher.partyId)?.name ?? 'Unknown party')
      : '—',
    tax: voucher.taxes.reduce((sum, line) => sum + line.amount, 0),
    total: invoiceTotal(voucher),
    status: voucher.status,
  })),
)

const recentColumns: TableColumn[] = [
  { key: 'number', label: 'Invoice no.', sortable: true, width: '150px' },
  { key: 'date', label: 'Date', sortable: true, width: '130px' },
  { key: 'party', label: 'Party' },
  { key: 'tax', label: 'Tax amount', align: 'right', numeric: true, sortable: true },
  { key: 'total', label: 'Total', align: 'right', numeric: true, sortable: true },
]

function openVoucher(row: { id: string }) {
  void router.push(`/vouchers/${row.id}`)
}

const basisNote = computed(() => {
  const parts = ['Outstanding is the invoice amount less the money applied to it.']
  parts.push(
    storedByInvoice.value.size > 0
      ? 'Applied amounts are read from the stored bill-wise allocations; an invoice the repository holds no allocation for is derived from the posted vouchers.'
      : 'Applied amounts are derived from the posted vouchers; this company holds no stored allocation records yet.',
  )
  if (outOfSyncCount.value > 0) {
    parts.push(
      `${outOfSyncCount.value} ${
        outOfSyncCount.value === 1 ? 'invoice has' : 'invoices have'
      } a stored allocation that no longer matches the books. The books are shown.`,
    )
  }
  return parts.join(' ')
})

const subtitle = computed(() => {
  const period = `${formatDate(fromDate.value)} to ${formatDate(toDate.value)}`
  if (loading.value) return period
  return `${period} · ${invoiceCount.value} posted ${invoiceCount.value === 1 ? 'invoice' : 'invoices'}`
})
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      title="Sales"
      :subtitle="subtitle"
      icon="shopping_cart"
      :breadcrumb="[{ label: 'Transactions' }]"
    >
      <template #actions>
        <BaseButton
          size="sm"
          variant="neutral"
          icon="bolt"
          @click="router.push('/vouchers/new/sales?mode=cash-sale')"
        >
          Cash sale
        </BaseButton>
        <BaseButton
          size="sm"
          variant="primary"
          icon="add"
          @click="router.push('/vouchers/new/sales')"
        >
          New sales voucher
        </BaseButton>
      </template>
    </PageHeader>

    <FilterBar>
      <BaseInput v-model="fromDate" label="From" type="date" size="sm" class="w-40" />
      <BaseInput v-model="toDate" label="To" type="date" size="sm" class="w-40" />
      <BaseButton size="sm" variant="neutral" icon="restart_alt" @click="resetPeriod">
        Financial year
      </BaseButton>

      <template #trailing>
        <span class="flex items-center gap-1 text-label-xs text-outline">
          <MaterialIcon name="info" :size="14" />
          Period figures count posted invoices only
        </span>
      </template>
    </FilterBar>

    <div class="min-h-0 flex-1 overflow-auto p-space-lg">
      <div v-if="loading" class="space-y-space-md">
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-4">
          <BaseSkeleton v-for="index in 4" :key="index" class="h-24" />
        </div>
        <BaseSkeleton class="h-72" />
        <BaseSkeleton class="h-56" />
      </div>

      <div
        v-else-if="error"
        class="rounded-md border-l-4 border-l-error bg-error-container p-space-md text-body-md text-on-error-container"
        role="alert"
      >
        <p class="font-semibold">The sales workspace could not be loaded</p>
        <p class="mt-0.5">{{ error }}</p>
      </div>

      <template v-else>
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Sales value"
            :value="formatMoney(salesValue, currency)"
            icon="trending_up"
            tone="info"
            hint="Posted invoices in the period"
          />
          <StatTile
            label="Invoices"
            :value="String(invoiceCount)"
            icon="receipt_long"
            hint="Posted sales invoices in the period"
          />
          <StatTile
            label="Average invoice"
            :value="formatMoney(averageInvoice, currency)"
            icon="functions"
            hint="Sales value divided by invoice count"
          />
          <StatTile
            label="Outstanding receivables"
            :value="formatMoney(outstandingReceivables, currency)"
            icon="assignment_turned_in"
            tone="warning"
            :hint="`${openOutstandingRows.length} open invoices, ${overdueCount} overdue`"
          />
        </div>

        <!-- Outstanding receivables -->
        <BaseCard
          class="mt-space-md"
          title="Outstanding receivables"
          :description="`Money still owed on sales invoices, as of ${formatDate(asOf)}`"
        >
          <template #actions>
            <BaseBadge tone="neutral" size="xs">
              {{ formatMoney(outstandingReceivables, currency) }} open
            </BaseBadge>
          </template>

          <BaseTabs v-model="outstandingTab" :tabs="outstandingTabs" class="mb-space-md" />

          <DataTable
            v-if="visibleOutstandingRows.length"
            :columns="outstandingColumns"
            :rows="visibleOutstandingRows"
            row-key="id"
            empty-title="No sales invoices"
            empty-description="No sales invoice exists for this company yet."
            @row-click="openVoucher"
          >
            <template #cell:number="{ row }">
              <span class="font-semibold text-on-surface">{{ row.number }}</span>
            </template>
            <template #cell:party="{ row }">
              <span class="block text-on-surface-variant">{{ row.party }}</span>
              <button
                type="button"
                class="text-label-xs font-semibold text-primary hover:underline"
                @click.stop="openPartyDrill(row.partyId, row.party)"
              >
                View documents
              </button>
            </template>
            <template #cell:date="{ row }">
              <span class="tabular text-on-surface-variant">{{ formatDate(row.date) }}</span>
            </template>
            <template #cell:dueDate="{ row }">
              <span class="tabular text-on-surface-variant">{{ formatDate(row.dueDate) }}</span>
              <span v-if="row.status === 'overdue'" class="block text-label-xs text-tertiary">
                {{ row.daysLate }} days late
              </span>
            </template>
            <template #cell:amount="{ row }">
              <span class="tabular text-on-surface">{{ formatMoney(row.amount, currency) }}</span>
            </template>
            <template #cell:allocated="{ row }">
              <span class="tabular text-on-surface-variant">
                {{ formatMoney(row.allocated, currency) }}
              </span>
              <span v-if="row.settledBy.length" class="block text-label-xs text-outline">
                via {{ row.settledBy.join(', ') }}
              </span>
            </template>
            <template #cell:outstanding="{ row }">
              <span class="tabular font-semibold text-on-surface">
                {{ formatMoney(row.outstanding, currency) }}
              </span>
            </template>
            <template #cell:status="{ row }">
              <BaseBadge :tone="statusTone(row.status)" size="xs">
                {{ statusLabel(row.status) }}
              </BaseBadge>
            </template>
          </DataTable>

          <BaseEmptyState
            v-else
            title="Nothing outstanding"
            description="Every sales invoice in this company has been settled."
            :icon="EmptyIcon"
          />

          <template #footer>
            <p class="text-label-xs text-outline">{{ basisNote }}</p>
          </template>
        </BaseCard>

        <!-- Advances -->
        <BaseCard
          class="mt-space-md"
          title="Advances held by customers"
          description="Money received from a customer that no invoice has settled yet. It stays with the customer and is applied to their oldest open invoice when one is raised."
        >
          <template #actions>
            <BaseBadge tone="neutral" size="xs">
              {{ formatMoney(advanceTotal, currency) }} held
            </BaseBadge>
          </template>

          <DataTable
            v-if="advanceRows.length"
            :columns="advanceColumns"
            :rows="advanceRows"
            row-key="id"
            empty-title="No advances"
            empty-description="No receipt is held as an advance."
            @row-click="openVoucher"
          >
            <template #cell:date="{ row }">
              <span class="tabular text-on-surface-variant">{{ formatDate(row.date) }}</span>
            </template>
            <template #cell:number="{ row }">
              <span class="font-semibold text-on-surface">{{ row.number }}</span>
            </template>
            <template #cell:party="{ row }">
              <span class="block text-on-surface-variant">{{ row.party }}</span>
              <button
                type="button"
                class="text-label-xs font-semibold text-primary hover:underline"
                @click.stop="openPartyDrill(row.partyId, row.party)"
              >
                View documents
              </button>
            </template>
            <template #cell:amount="{ row }">
              <span class="tabular font-semibold text-on-surface">
                {{ formatMoney(row.amount, currency) }}
              </span>
            </template>
          </DataTable>

          <BaseEmptyState
            v-else
            title="No advances"
            description="No receipt in this company is held as an advance against a future invoice."
            :icon="AdvanceIcon"
          />

          <template #footer>
            <p class="text-label-xs text-outline">{{ advanceBasis }}</p>
          </template>
        </BaseCard>

        <!-- Recent invoices -->
        <BaseCard
          class="mt-space-md"
          title="Recent sales invoices"
          description="The latest invoices in the selected period"
        >
          <template #actions>
            <BaseBadge tone="neutral" size="xs">{{ recentRows.length }} shown</BaseBadge>
          </template>

          <DataTable
            v-if="recentRows.length"
            :columns="recentColumns"
            :rows="recentRows"
            row-key="id"
            empty-title="No sales invoices"
            empty-description="No sales invoice was raised in this period."
            @row-click="openVoucher"
          >
            <template #cell:number="{ row }">
              <span class="font-semibold text-on-surface">{{ row.number }}</span>
              <BaseBadge v-if="row.status === 'draft'" tone="warning" size="xs" class="ml-1">
                Draft
              </BaseBadge>
            </template>
            <template #cell:date="{ row }">
              <span class="tabular text-on-surface-variant">{{ formatDate(row.date) }}</span>
            </template>
            <template #cell:party="{ row }">
              <span class="text-on-surface-variant">{{ row.party }}</span>
            </template>
            <template #cell:tax="{ row }">
              <span class="tabular text-on-surface-variant">{{ formatMoney(row.tax, currency) }}</span>
            </template>
            <template #cell:total="{ row }">
              <span class="tabular font-semibold text-on-surface">
                {{ formatMoney(row.total, currency) }}
              </span>
            </template>
          </DataTable>

          <BaseEmptyState
            v-else
            title="No sales invoices in this period"
            description="Change the period, or raise a new sales invoice."
            :icon="EmptyIcon"
          />
        </BaseCard>
      </template>
    </div>

    <!-- Documents of one party -->
    <BaseDrawer
      :open="drillOpen"
      :title="drillParty ? `Documents — ${drillParty.name}` : 'Documents'"
      :description="`${drillRows.length} vouchers of this party`"
      width="680px"
      @close="drillOpen = false"
    >
      <div v-if="drillRows.length" class="overflow-hidden rounded-sm border border-surface-container">
        <table class="w-full text-left text-body-sm">
          <caption class="sr-only">Vouchers of this party</caption>
          <thead class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline">
            <tr>
              <th scope="col" class="px-space-sm py-2">Date</th>
              <th scope="col" class="px-space-sm py-2">Voucher</th>
              <th scope="col" class="px-space-sm py-2">Type</th>
              <th scope="col" class="px-space-sm py-2">Narration</th>
              <th scope="col" class="px-space-sm py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-surface-container-low">
            <tr
              v-for="row in drillRows"
              :key="row.id"
              class="cursor-pointer hover:bg-surface-container-low/70"
              @click="openVoucher(row)"
            >
              <td class="whitespace-nowrap px-space-sm py-1.5 text-numeric-sm tabular text-outline">
                {{ formatDate(row.date) }}
              </td>
              <td class="px-space-sm py-1.5 font-medium text-on-surface">{{ row.number }}</td>
              <td class="px-space-sm py-1.5 text-on-surface-variant">{{ row.type }}</td>
              <td class="px-space-sm py-1.5 text-on-surface-variant">{{ row.narration }}</td>
              <td class="px-space-sm py-1.5 text-right text-numeric-sm tabular text-on-surface">
                {{ formatMoney(row.amount, currency) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <BaseEmptyState
        v-else
        size="sm"
        title="No documents"
        description="This party has no voucher in the books."
        :icon="MaterialIcon"
      />

      <template #footer>
        <BaseButton
          variant="outlined"
          size="sm"
          icon="receipt_long"
          @click="router.push('/vouchers')"
        >
          Open voucher register
        </BaseButton>
      </template>
    </BaseDrawer>
  </div>
</template>
