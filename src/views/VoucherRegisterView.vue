<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseEmptyState from '@/components/ui/BaseEmptyState.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BasePagination from '@/components/ui/BasePagination.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import DataTable from '@/components/ui/DataTable.vue'
import type { TableColumn } from '@/components/ui/DataTable.vue'
import FilterBar from '@/components/ui/FilterBar.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import { VOUCHER_TYPE_META } from '@/app/navigation'
import {
  VOUCHER_TYPE_LABELS,
  voucherStatusLabel,
  voucherStatusTone,
  voucherTypeTone,
} from '@/app/labels'
import { totalCredit, totalDebit } from '@/domain/accounting'
import type { Voucher, VoucherStatus, VoucherType } from '@/domain/types'
import { formatDate } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const router = useRouter()

const vouchers = ref<Voucher[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

const search = ref('')
const typeFilter = ref<string>('all')
const statusFilter = ref<string>('all')
const fromDate = ref('')
const toDate = ref('')
/**
 * The party whose documents are shown. It is set from the address bar, so a
 * drill-down from an outstanding balance arrives here already filtered.
 */
const partyFilter = ref<string>('')

const page = ref(1)
const pageSize = ref(25)
const sortBy = ref<string | null>('date')
const sortDir = ref<'asc' | 'desc'>('desc')

const currency = computed(() => session.activeCompany?.baseCurrency ?? 'INR')

const route = useRoute()

/**
 * The key the loaded filters correspond to. It is declared before the watcher
 * below, which runs immediately and reads it.
 */
let loadedKey = ''

// A drill-down from an outstanding balance arrives with the party in the
// address bar.
watch(
  () => route.query.party,
  (value) => {
    partyFilter.value = typeof value === 'string' ? value : ''
    page.value = 1
    void load()
  },
  { immediate: true },
)

const filteredPartyName = computed(
  () => session.ledgers.find((ledger) => ledger.id === partyFilter.value)?.name ?? '',
)

/* ------------------------------------------------------------------ *
 * Filter options
 * ------------------------------------------------------------------ */

/** Every voucher type the domain knows about. */
const voucherTypes = Object.keys(VOUCHER_TYPE_LABELS) as VoucherType[]

const typeOptions = computed(() => [
  { value: 'all', label: 'All types' },
  ...voucherTypes.map((type) => ({
    value: type,
    label: VOUCHER_TYPE_META[type]?.label ?? VOUCHER_TYPE_LABELS[type],
  })),
])

const statusOptions = computed(() => [
  { value: 'all', label: 'All statuses' },
  { value: 'posted', label: voucherStatusLabel('posted') },
  { value: 'draft', label: voucherStatusLabel('draft') },
  { value: 'cancelled', label: voucherStatusLabel('cancelled') },
])

/* ------------------------------------------------------------------ *
 * Loading
 * ------------------------------------------------------------------ */

/** Identifies the filter set the current result belongs to. */
function filterKey(): string {
  return [
    search.value,
    typeFilter.value,
    statusFilter.value,
    fromDate.value,
    toDate.value,
    partyFilter.value,
  ].join('|')
}

async function load() {
  const companyId = session.activeCompanyId
  if (!companyId) {
    vouchers.value = []
    loading.value = false
    return
  }
  loadedKey = filterKey()
  loading.value = true
  error.value = null
  try {
    vouchers.value = await session.repository.listVouchers(companyId, {
      from: fromDate.value || undefined,
      to: toDate.value || undefined,
      type: typeFilter.value as VoucherType | 'all',
      status: statusFilter.value as VoucherStatus | 'all',
      search: search.value.trim() || undefined,
      partyId: partyFilter.value || undefined,
    })
  } catch (cause) {
    vouchers.value = []
    error.value =
      cause instanceof Error ? cause.message : 'The voucher register could not be loaded.'
  } finally {
    loading.value = false
  }
}

/** The register opens on the financial year the session has open. */
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

/** Typing in the search box should not fire a query per keystroke. */
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

watch([search, typeFilter, statusFilter, fromDate, toDate], () => {
  // Setting the opening period is not a user filter change.
  if (filterKey() === loadedKey) return
  page.value = 1
  scheduleLoad()
})

/* ------------------------------------------------------------------ *
 * Rows
 * ------------------------------------------------------------------ */

type RegisterRow = {
  id: string
  number: string
  type: VoucherType
  date: string
  party: string
  narration: string
  debit: number
  credit: number
  status: VoucherStatus
}

const ledgerNames = computed(() => new Map(session.ledgers.map((ledger) => [ledger.id, ledger.name])))

function partyName(voucher: Voucher): string {
  if (!voucher.partyId) return '—'
  return ledgerNames.value.get(voucher.partyId) ?? 'Unknown party'
}

const rows = computed<RegisterRow[]>(() =>
  vouchers.value.map((voucher) => ({
    id: voucher.id,
    number: voucher.number,
    type: voucher.type,
    date: voucher.date,
    party: partyName(voucher),
    narration: voucher.narration,
    debit: totalDebit(voucher),
    credit: totalCredit(voucher),
    status: voucher.status,
  })),
)

const columns: TableColumn[] = [
  { key: 'number', label: 'Voucher no.', sortable: true, width: '150px' },
  { key: 'type', label: 'Type', sortable: true, width: '150px' },
  { key: 'date', label: 'Date', sortable: true, width: '130px' },
  { key: 'party', label: 'Party' },
  { key: 'narration', label: 'Narration' },
  { key: 'debit', label: 'Debit', align: 'right', numeric: true, sortable: true, width: '150px' },
  { key: 'credit', label: 'Credit', align: 'right', numeric: true, sortable: true, width: '150px' },
  { key: 'status', label: 'Status', width: '130px' },
]

/* ------------------------------------------------------------------ *
 * Sorting and pagination
 * ------------------------------------------------------------------ */

const sortedRows = computed<RegisterRow[]>(() => {
  const key = sortBy.value
  if (!key) return rows.value
  const factor = sortDir.value === 'asc' ? 1 : -1
  return [...rows.value].sort((left, right) => {
    const a = (left as Record<string, unknown>)[key]
    const b = (right as Record<string, unknown>)[key]
    if (a === b) return 0
    if (a === null || a === undefined) return 1
    if (b === null || b === undefined) return -1
    if (typeof a === 'number' && typeof b === 'number') return (a - b) * factor
    return String(a).localeCompare(String(b), undefined, { numeric: true }) * factor
  })
})

const totalPages = computed(() => Math.max(1, Math.ceil(sortedRows.value.length / pageSize.value)))

const pagedRows = computed<RegisterRow[]>(() => {
  const start = (page.value - 1) * pageSize.value
  return sortedRows.value.slice(start, start + pageSize.value)
})

watch(totalPages, (count) => {
  if (page.value > count) page.value = count
})

function onSort(key: string, dir: 'asc' | 'desc') {
  sortBy.value = key
  sortDir.value = dir
  page.value = 1
}

function openVoucher(row: RegisterRow) {
  void router.push(`/vouchers/${row.id}`)
}

/* ------------------------------------------------------------------ *
 * Summary
 * ------------------------------------------------------------------ */

const summary = computed(() => {
  let posted = 0
  let drafts = 0
  let cancelled = 0
  let debits = 0
  let credits = 0
  for (const row of rows.value) {
    if (row.status === 'posted') posted += 1
    else if (row.status === 'draft') drafts += 1
    else cancelled += 1
    // Cancelled vouchers never reach the books, so they stay out of the totals.
    if (row.status === 'cancelled') continue
    debits += row.debit
    credits += row.credit
  }
  return { posted, drafts, cancelled, debits, credits }
})

const subtitle = computed(() => {
  const period = `${formatDate(fromDate.value)} to ${formatDate(toDate.value)}`
  if (loading.value) return period
  const count = rows.value.length
  return `${period} · ${count} ${count === 1 ? 'voucher' : 'vouchers'}`
})
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      title="Voucher register"
      :subtitle="subtitle"
      icon="receipt_long"
      :breadcrumb="[{ label: 'Accounting' }]"
    >
      <template #title-meta>
        <BaseBadge tone="neutral" size="xs" icon="menu_book">Day book</BaseBadge>
      </template>
    </PageHeader>

    <FilterBar>
      <BaseInput
        v-model="search"
        label="Search"
        type="search"
        size="sm"
        placeholder="Number, narration or reference"
        class="w-64"
      />

      <!-- The drill-down filter from an outstanding balance. -->
      <div v-if="filteredPartyName" class="flex items-end">
        <span
          class="inline-flex items-center gap-1.5 rounded-sm bg-primary-soft px-2 py-1.5 text-label-sm font-semibold text-primary-text"
        >
          <MaterialIcon name="person" :size="15" />
          {{ filteredPartyName }}
          <button
            type="button"
            class="rounded-sm p-0.5 text-primary-text transition-colors hover:bg-primary-fixed"
            aria-label="Show every party"
            @click="partyFilter = ''; load()"
          >
            <MaterialIcon name="close" :size="14" />
          </button>
        </span>
      </div>

      <BaseSelect v-model="typeFilter" label="Type" :options="typeOptions" size="sm" class="w-44" />
      <BaseSelect
        v-model="statusFilter"
        label="Status"
        :options="statusOptions"
        size="sm"
        class="w-40"
      />
      <BaseInput v-model="fromDate" label="From" type="date" size="sm" class="w-40" />
      <BaseInput v-model="toDate" label="To" type="date" size="sm" class="w-40" />

      <template #trailing>
        <span class="flex items-center gap-1 text-label-xs text-outline">
          <MaterialIcon name="info" :size="14" />
          Drafts do not affect balances
        </span>
      </template>
    </FilterBar>

    <div class="flex min-h-0 flex-1 flex-col gap-space-md overflow-auto p-space-lg">
      <div v-if="loading" class="space-y-space-md">
        <BaseSkeleton class="h-20" />
        <BaseSkeleton class="h-96" />
      </div>

      <div
        v-else-if="error"
        class="rounded-md border-l-4 border-l-error bg-error-container p-space-md text-body-md text-on-error-container"
        role="alert"
      >
        <p class="font-semibold">The voucher register could not be loaded</p>
        <p class="mt-0.5">{{ error }}</p>
      </div>

      <template v-else>
        <!-- Summary of the current filter set -->
        <section
          class="flex flex-wrap items-center gap-x-space-lg gap-y-space-sm rounded-md bg-surface-container-lowest px-space-md py-space-sm shadow-sm"
          aria-label="Summary of the filtered vouchers"
        >
          <div class="flex flex-col">
            <span class="section-label">Posted</span>
            <span class="num text-numeric-md font-semibold text-on-surface">{{ summary.posted }}</span>
          </div>
          <div class="flex flex-col">
            <span class="section-label">Drafts</span>
            <span class="num text-numeric-md font-semibold text-on-surface">{{ summary.drafts }}</span>
          </div>
          <div class="flex flex-col">
            <span class="section-label">Cancelled</span>
            <span class="num text-numeric-md font-semibold text-on-surface">
              {{ summary.cancelled }}
            </span>
          </div>
          <div class="flex flex-col">
            <span class="section-label">Total debits</span>
            <span class="num text-numeric-md font-semibold text-on-surface">
              {{ formatMoney(summary.debits, currency) }}
            </span>
          </div>
          <div class="flex flex-col">
            <span class="section-label">Total credits</span>
            <span class="num text-numeric-md font-semibold text-on-surface">
              {{ formatMoney(summary.credits, currency) }}
            </span>
          </div>
          <p class="ml-auto flex items-center gap-1 text-label-xs text-outline">
            <MaterialIcon name="info" :size="14" />
            Cancelled vouchers are excluded from the totals.
          </p>
        </section>

        <section
          class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md bg-surface-container-lowest shadow-sm"
        >
          <DataTable
            v-if="pagedRows.length"
            :columns="columns"
            :rows="pagedRows"
            row-key="id"
            :sort-by="sortBy"
            :sort-dir="sortDir"
            empty-title="No vouchers"
            empty-description="No voucher matches the current filters."
            @sort="onSort"
            @row-click="openVoucher"
          >
            <template #cell:number="{ row }">
              <span class="font-semibold text-on-surface">{{ row.number }}</span>
            </template>
            <template #cell:type="{ row }">
              <BaseBadge :tone="voucherTypeTone(row.type)" size="xs">
                {{ VOUCHER_TYPE_META[row.type]?.label ?? VOUCHER_TYPE_LABELS[row.type] }}
              </BaseBadge>
            </template>
            <template #cell:date="{ row }">
              <span class="tabular text-on-surface-variant">{{ formatDate(row.date) }}</span>
            </template>
            <template #cell:party="{ row }">
              <span class="text-on-surface-variant">{{ row.party }}</span>
            </template>
            <template #cell:narration="{ row }">
              <span class="text-on-surface-variant">{{ row.narration || '—' }}</span>
            </template>
            <template #cell:debit="{ row }">
              <span class="tabular text-on-surface">{{ formatMoney(row.debit, currency) }}</span>
            </template>
            <template #cell:credit="{ row }">
              <span class="tabular text-on-surface">{{ formatMoney(row.credit, currency) }}</span>
            </template>
            <template #cell:status="{ row }">
              <BaseBadge :tone="voucherStatusTone(row.status)" size="xs">
                {{ voucherStatusLabel(row.status) }}
              </BaseBadge>
            </template>
          </DataTable>

          <BaseEmptyState
            v-else
            title="No vouchers match these filters"
            description="Widen the date range, clear the search box, or pick a different voucher type."
          >
            <button
              type="button"
              class="rounded-sm bg-surface-container px-space-sm py-1 text-label-sm font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-high"
              @click="resetPeriod"
            >
              Reset to the financial year
            </button>
          </BaseEmptyState>

          <BasePagination
            v-model:page="page"
            v-model:page-size="pageSize"
            :total="rows.length"
            label="Vouchers"
          />
        </section>
      </template>
    </div>
  </div>
</template>
