<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseEmptyState from '@/components/ui/BaseEmptyState.vue'
import BaseSegmented from '@/components/ui/BaseSegmented.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import DataTable from '@/components/ui/DataTable.vue'
import FilterBar from '@/components/ui/FilterBar.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import StatTile from '@/components/ui/StatTile.vue'
import { useSessionStore } from '@/stores/session'
import { totalDebit } from '@/domain/accounting'
import type { Voucher } from '@/domain/types'
import { formatMoney, type Money } from '@/lib/money'
import { formatDate } from '@/lib/datetime'

const session = useSessionStore()

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

type TableColumnSpec = {
  key: string
  label: string
  align?: 'left' | 'right' | 'center'
  numeric?: boolean
  sortable?: boolean
  width?: string
}

type InvoiceRow = {
  id: string
  number: string
  date: string
  party: string
  gstin: string
  total: Money
  qualifies: boolean
}

const columns: TableColumnSpec[] = [
  { key: 'number', label: 'Invoice', sortable: true },
  { key: 'date', label: 'Date', sortable: true },
  { key: 'party', label: 'Party' },
  { key: 'gstin', label: 'Party GSTIN' },
  { key: 'total', label: 'Invoice total', align: 'right', numeric: true, sortable: true },
  { key: 'status', label: 'E-invoice state' },
]

const EmptyIcon = () => h(MaterialIcon, { name: 'qr_code_2', size: 19 })

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

const invoices = ref<Voucher[]>([])
const threshold = ref<Money | null>(null)
const scope = ref('qualifying')
const loading = ref(true)
const error = ref<string | null>(null)
let requestId = 0

const company = computed(() => session.activeCompany)
const currency = computed(() => company.value?.baseCurrency ?? 'INR')

const scopeItems = [
  { value: 'qualifying', label: 'At or above threshold', icon: 'check_circle' },
  { value: 'all', label: 'All sales invoices', icon: 'receipt_long' },
]

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function grossValue(voucher: Voucher): Money {
  return voucher.items.reduce((sum, item) => sum + item.amount, 0)
}

function taxTotal(voucher: Voucher): Money {
  return voucher.taxes.reduce((sum, line) => sum + line.amount, 0)
}

/**
 * Invoice total. A posted sales voucher carries the invoice value on the
 * party debit line; a voucher raised without a party posts no debit, so the
 * document value is used instead.
 */
function invoiceTotal(voucher: Voucher): Money {
  const debitTotal = totalDebit(voucher)
  if (debitTotal > 0) return debitTotal
  return grossValue(voucher) + taxTotal(voucher)
}

function partyName(voucher: Voucher): string {
  if (!voucher.partyId) return 'No party recorded'
  const ledger = session.ledgers.find((candidate) => candidate.id === voucher.partyId)
  return ledger?.name ?? 'Ledger not found'
}

function partyGstin(voucher: Voucher): string {
  if (!voucher.partyId) return 'Not recorded'
  const ledger = session.ledgers.find((candidate) => candidate.id === voucher.partyId)
  return ledger?.taxNumber?.trim() || 'Not recorded'
}

/* ------------------------------------------------------------------ *
 * Derived figures
 * ------------------------------------------------------------------ */

const rows = computed<InvoiceRow[]>(() => {
  const limit = threshold.value
  return invoices.value
    .map((voucher) => {
      const total = invoiceTotal(voucher)
      return {
        id: voucher.id,
        number: voucher.number,
        date: voucher.date,
        party: partyName(voucher),
        gstin: partyGstin(voucher),
        total,
        qualifies: limit !== null && total >= limit,
      }
    })
    .sort((left, right) =>
      left.date === right.date
        ? left.number.localeCompare(right.number)
        : right.date.localeCompare(left.date),
    )
})

const visibleRows = computed(() =>
  scope.value === 'qualifying' ? rows.value.filter((row) => row.qualifies) : rows.value,
)

const qualifyingCount = computed(() => rows.value.filter((row) => row.qualifies).length)

const qualifyingValue = computed(() =>
  rows.value.filter((row) => row.qualifies).reduce((sum, row) => sum + row.total, 0),
)

/* ------------------------------------------------------------------ *
 * Loading
 * ------------------------------------------------------------------ */

async function load() {
  const companyId = session.activeCompanyId
  const period = session.activePeriod
  const token = ++requestId
  if (!companyId) {
    invoices.value = []
    threshold.value = null
    loading.value = false
    return
  }
  loading.value = true
  error.value = null
  try {
    const [salesList, dashboard] = await Promise.all([
      session.repository.listVouchers(companyId, {
        type: 'sales',
        from: period.from,
        to: period.to,
        status: 'posted',
      }),
      session.repository.getDashboard(companyId, { from: period.from, to: period.to }),
    ])
    if (token !== requestId) return
    invoices.value = salesList
    threshold.value = dashboard.gst.ewayThreshold
  } catch (cause) {
    if (token !== requestId) return
    invoices.value = []
    threshold.value = null
    error.value =
      cause instanceof Error
        ? cause.message
        : 'The sales invoices for this period could not be read from the repository.'
  } finally {
    if (token === requestId) loading.value = false
  }
}

onMounted(async () => {
  if (!session.ready && !session.loading) await session.bootstrap()
  await load()
})

watch([() => session.activeCompanyId, () => session.activeYearId], () => {
  void load()
})

/* ------------------------------------------------------------------ *
 * Configuration fields a user would need for the IRP portal
 * ------------------------------------------------------------------ */

const requiredSettings = [
  { label: 'GSTIN', value: company.value?.gstin?.trim() || 'Not configured' },
  { label: 'GST user id', value: 'Not configured' },
  { label: 'GST password', value: 'Not configured' },
  { label: 'IRP environment (production or sandbox)', value: 'Not configured' },
  { label: 'Signing certificate and key', value: 'Not configured' },
  { label: 'Authorised signatory', value: 'Not configured' },
]
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      title="E-invoice"
      subtitle="Sales invoices screened against the configured value threshold"
      icon="qr_code_2"
      :breadcrumb="[{ label: 'Tax and compliance' }, { label: 'E-invoice' }]"
    >
      <template #title-meta>
        <BaseBadge tone="warning" size="xs" icon="cloud_off">No IRP connection</BaseBadge>
      </template>
    </PageHeader>

    <FilterBar>
      <BaseSegmented v-model="scope" :items="scopeItems" size="sm" />
      <template #trailing>
        <span class="text-label-sm text-outline">
          {{ session.activePeriod.from }} to {{ session.activePeriod.to }}
        </span>
      </template>
    </FilterBar>

    <div class="min-h-0 flex-1 overflow-auto p-space-lg">
      <div v-if="loading" class="space-y-space-md">
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-4">
          <BaseSkeleton v-for="index in 4" :key="index" class="h-24" />
        </div>
        <BaseSkeleton class="h-64" />
      </div>

      <div
        v-else-if="error"
        class="rounded-sm border-l-4 border-l-error bg-error-container p-space-md"
        role="alert"
      >
        <p class="text-label-md font-bold text-on-error-container">The invoice list could not be built</p>
        <p class="mt-0.5 text-body-sm text-on-error-container">{{ error }}</p>
      </div>

      <template v-else>
        <div class="rounded-sm border-l-4 border-l-tertiary bg-surface-container-low p-space-md">
          <div class="flex items-start gap-space-sm">
            <MaterialIcon name="warning" :size="18" class="mt-0.5 shrink-0 text-tertiary" />
            <div class="min-w-0">
              <p class="text-label-md font-bold text-on-surface">
                No IRN, no signed QR code, no acknowledgement — none can be produced here.
              </p>
              <p class="mt-0.5 text-body-sm text-on-surface-variant">
                IRN generation and the signed QR code require the IRP portal and a configured GST
                credential. Neither exists in this build, so no e-invoice has been registered, no IRN
                is displayed on this screen, and no QR code is shown.
              </p>
            </div>
          </div>
        </div>

        <div class="mt-space-md grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Sales invoices in period"
            :value="String(rows.length)"
            icon="receipt_long"
            hint="Posted sales vouchers in the active period"
          />
          <StatTile
            label="At or above threshold"
            :value="String(qualifyingCount)"
            icon="check_circle"
            tone="info"
            hint="Screened against the configured threshold"
          />
          <StatTile
            label="Value of qualifying invoices"
            :value="formatMoney(qualifyingValue, currency)"
            icon="payments"
            hint="Invoice totals, excluding tax credit notes"
          />
          <StatTile
            label="Threshold in use"
            :value="threshold === null ? 'Not available' : formatMoney(threshold, currency)"
            icon="speed"
            tone="warning"
            hint="Read from the repository configuration"
          />
        </div>

        <div class="mt-space-md grid grid-cols-1 items-start gap-space-md lg:grid-cols-3">
          <BaseCard
            class="lg:col-span-2"
            title="Invoices in the active period"
            description="Screened against the configured value threshold"
          >
            <DataTable
              :columns="columns"
              :rows="visibleRows"
              row-key="id"
              :clickable="false"
              empty-title="No qualifying invoices"
              empty-description="No posted sales invoice in this period reaches the configured threshold."
            >
              <template #cell:number="{ row }">
                <span class="num font-semibold text-on-surface">{{ row.number }}</span>
              </template>
              <template #cell:date="{ row }">
                <span class="num text-on-surface-variant">{{ formatDate(row.date) }}</span>
              </template>
              <template #cell:gstin="{ row }">
                <span class="num text-on-surface-variant">{{ row.gstin }}</span>
              </template>
              <template #cell:total="{ row }">
                <span class="num font-semibold text-on-surface">
                  {{ formatMoney(row.total, currency) }}
                </span>
              </template>
              <template #cell:status="{ row }">
                <BaseBadge
                  :tone="row.qualifies ? 'info' : 'neutral'"
                  size="xs"
                  :icon="row.qualifies ? 'bolt' : 'south'"
                >
                  {{ row.qualifies ? 'Ready to generate' : 'Below threshold' }}
                </BaseBadge>
              </template>
            </DataTable>

            <p class="mt-space-sm text-label-xs text-outline">
              “Ready to generate” means the invoice clears the value test in this build. It does not
              mean an e-invoice has been generated: that step needs the IRP portal.
            </p>
          </BaseCard>

          <div class="flex flex-col gap-space-md">
            <BaseCard title="Portal connection" description="State of the IRP integration">
              <dl class="space-y-space-sm">
                <div class="flex items-center justify-between rounded-sm bg-surface-container-low p-space-sm">
                  <dt class="text-label-sm text-on-surface-variant">Company GSTIN</dt>
                  <dd class="num text-label-md font-bold text-on-surface">
                    {{ company?.gstin?.trim() || 'Not configured' }}
                  </dd>
                </div>
                <div class="flex items-center justify-between rounded-sm bg-surface-container-low p-space-sm">
                  <dt class="text-label-sm text-on-surface-variant">IRP connection</dt>
                  <dd>
                    <BaseBadge tone="warning" size="xs" icon="cloud_off">Not configured</BaseBadge>
                  </dd>
                </div>
              </dl>

              <p class="mt-space-sm text-label-sm text-on-surface-variant">
                The fields below are what a user would have to configure before an IRN could ever be
                requested. They are not editable in this build.
              </p>

              <ul class="mt-space-sm space-y-space-xs">
                <li
                  v-for="setting in requiredSettings"
                  :key="setting.label"
                  class="flex items-start justify-between gap-space-sm rounded-sm bg-surface-container-low px-space-sm py-1.5"
                >
                  <span class="text-label-sm text-on-surface-variant">{{ setting.label }}</span>
                  <span class="text-label-sm font-semibold text-on-surface">{{ setting.value }}</span>
                </li>
              </ul>

              <BaseBadge class="mt-space-sm" tone="neutral" size="xs" icon="lock">
                Not editable in this build
              </BaseBadge>
            </BaseCard>

            <div class="rounded-sm border-l-4 border-l-tertiary bg-surface-container-low p-space-md">
              <div class="flex items-start gap-space-sm">
                <MaterialIcon name="info" :size="18" class="mt-0.5 shrink-0 text-tertiary" />
                <div class="min-w-0">
                  <p class="text-label-md font-bold text-on-surface">About the threshold</p>
                  <p class="mt-0.5 text-body-sm text-on-surface-variant">
                    Thresholds are statutory and change. Confirm the current value before filing.
                    This build reads a single threshold from the repository and shares it between
                    the e-invoice and e-way bill screens; the statutory e-invoice and e-way bill
                    thresholds are separate values and are not configured separately here.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <BaseEmptyState
          v-if="!visibleRows.length"
          class="mt-space-md"
          :icon="EmptyIcon"
          title="No invoices to show"
          description="No posted sales invoice in the active period falls in this view."
        />
      </template>
    </div>
  </div>
</template>
