<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseEmptyState from '@/components/ui/BaseEmptyState.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import DataTable from '@/components/ui/DataTable.vue'
import FilterBar from '@/components/ui/FilterBar.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import StatTile from '@/components/ui/StatTile.vue'
import { useToastStore } from '@/stores/toast'
import { useSessionStore } from '@/stores/session'
import { totalDebit } from '@/domain/accounting'
import type { TaxType, Voucher } from '@/domain/types'
import { currencyMeta, formatMoney, type Money } from '@/lib/money'
import { formatDate, formatPeriod } from '@/lib/datetime'

const session = useSessionStore()
const toast = useToastStore()

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

type GstType = 'cgst' | 'sgst' | 'igst' | 'cess'

type TableColumnSpec = {
  key: string
  label: string
  align?: 'left' | 'right' | 'center'
  numeric?: boolean
  sortable?: boolean
  width?: string
}

type TaxPeriod = {
  value: string
  label: string
  from: string
  to: string
}

type TypeRow = {
  type: GstType
  label: string
  taxable: Money
  tax: Money
}

type CategoryRow = {
  id: string
  name: string
  type: string
  rate: number
  taxable: Money
  tax: Money
}

type AnnexureRow = {
  id: string
  number: string
  date: string
  party: string
  gstin: string
  taxable: Money
  cgst: Money
  sgst: Money
  igst: Money
  cess: Money
  tax: Money
  total: Money
  isCreditNote: boolean
}

/* ------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------ */

const GST_TYPES: GstType[] = ['cgst', 'sgst', 'igst', 'cess']

const GST_TYPE_LABELS: Record<GstType, string> = {
  cgst: 'CGST',
  sgst: 'SGST',
  igst: 'IGST',
  cess: 'Cess',
}

const ALL_TAX_TYPE_LABELS: Record<TaxType, string> = {
  ...GST_TYPE_LABELS,
  tds: 'TDS',
  tcs: 'TCS',
}

const typeColumns: TableColumnSpec[] = [
  { key: 'label', label: 'Tax type' },
  { key: 'taxable', label: 'Taxable value', align: 'right', numeric: true },
  { key: 'tax', label: 'Tax amount', align: 'right', numeric: true },
  { key: 'share', label: 'Share of tax', align: 'right', numeric: true },
]

const categoryColumns: TableColumnSpec[] = [
  { key: 'name', label: 'Tax category', sortable: true },
  { key: 'type', label: 'Type' },
  { key: 'rate', label: 'Rate', align: 'right', numeric: true },
  { key: 'taxable', label: 'Taxable value', align: 'right', numeric: true },
  { key: 'tax', label: 'Tax amount', align: 'right', numeric: true },
]

const annexureColumns: TableColumnSpec[] = [
  { key: 'number', label: 'Invoice', sortable: true },
  { key: 'date', label: 'Date', sortable: true },
  { key: 'party', label: 'Party' },
  { key: 'gstin', label: 'Party GSTIN' },
  { key: 'taxable', label: 'Taxable value', align: 'right', numeric: true },
  { key: 'cgst', label: 'CGST', align: 'right', numeric: true },
  { key: 'sgst', label: 'SGST', align: 'right', numeric: true },
  { key: 'igst', label: 'IGST', align: 'right', numeric: true },
  { key: 'total', label: 'Invoice total', align: 'right', numeric: true },
]

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

const selectedPeriod = ref('')
const outbound = ref<Voucher[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
let requestId = 0

const company = computed(() => session.activeCompany)
const currency = computed(() => company.value?.baseCurrency ?? 'INR')

/** Icon for the screen-level empty state. */
const EmptyIcon = () => h(MaterialIcon, { name: 'inbox', size: 19 })

const taxById = computed(
  () => new Map(session.taxCategories.map((category) => [category.id, category])),
)

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/** Every calendar month covered by the active period. */
function monthPeriods(from: string, to: string): TaxPeriod[] {
  if (!from || !to) return []
  const periods: TaxPeriod[] = []
  const start = new Date(`${from}T00:00:00`)
  const end = new Date(`${to}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return []
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
  while (cursor.getFullYear() < end.getFullYear() || (cursor.getFullYear() === end.getFullYear() && cursor.getMonth() <= end.getMonth())) {
    const year = cursor.getFullYear()
    const month = cursor.getMonth()
    const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`
    const lastDay = new Date(year, month + 1, 0).getDate()
    const monthEnd = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    periods.push({
      value: `${year}-${String(month + 1).padStart(2, '0')}`,
      label: formatPeriod(monthStart),
      from: monthStart < from ? from : monthStart,
      to: monthEnd > to ? to : monthEnd,
    })
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return periods
}

const periods = computed(() => monthPeriods(session.activePeriod.from, session.activePeriod.to))

const periodOptions = computed(() =>
  periods.value.map((period) => ({ value: period.value, label: period.label })),
)

const activePeriod = computed(
  () => periods.value.find((period) => period.value === selectedPeriod.value) ?? null,
)

/** Value of the supply on a voucher: line values after discount, before tax. */
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

function isGstType(type: TaxType): type is GstType {
  return type === 'cgst' || type === 'sgst' || type === 'igst' || type === 'cess'
}

function signFor(voucher: Voucher): 1 | -1 {
  return voucher.type === 'credit-note' ? -1 : 1
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

function rateLabel(rate: number): string {
  return `${Number.isInteger(rate) ? rate : rate.toFixed(2)}%`
}

/* ------------------------------------------------------------------ *
 * Derived figures
 * ------------------------------------------------------------------ */

const typeRows = computed<TypeRow[]>(() => {
  const buckets = new Map<GstType, { taxable: Money; tax: Money }>()
  for (const type of GST_TYPES) buckets.set(type, { taxable: 0, tax: 0 })
  for (const voucher of outbound.value) {
    const sign = signFor(voucher)
    for (const line of voucher.taxes) {
      const category = taxById.value.get(line.taxCategoryId)
      if (!category || !isGstType(category.type)) continue
      const bucket = buckets.get(category.type)
      if (!bucket) continue
      bucket.taxable += sign * line.taxable
      bucket.tax += sign * line.amount
    }
  }
  return GST_TYPES.map((type) => ({
    type,
    label: GST_TYPE_LABELS[type],
    taxable: buckets.get(type)?.taxable ?? 0,
    tax: buckets.get(type)?.tax ?? 0,
  }))
})

const totalTax = computed(() => typeRows.value.reduce((sum, row) => sum + row.tax, 0))
const totalTaxableSupply = computed(() =>
  outbound.value.reduce((sum, voucher) => sum + signFor(voucher) * grossValue(voucher), 0),
)

const categoryRows = computed<CategoryRow[]>(() => {
  const rows = new Map<string, CategoryRow>()
  for (const voucher of outbound.value) {
    const sign = signFor(voucher)
    for (const line of voucher.taxes) {
      const category = taxById.value.get(line.taxCategoryId)
      if (!category || !isGstType(category.type)) continue
      const existing = rows.get(category.id)
      if (existing) {
        existing.taxable += sign * line.taxable
        existing.tax += sign * line.amount
        continue
      }
      rows.set(category.id, {
        id: category.id,
        name: category.name,
        type: ALL_TAX_TYPE_LABELS[category.type],
        rate: category.rate,
        taxable: sign * line.taxable,
        tax: sign * line.amount,
      })
    }
  }
  return [...rows.values()].sort((left, right) => right.tax - left.tax)
})

const annexureRows = computed<AnnexureRow[]>(() =>
  outbound.value
    .map((voucher) => {
      const sign = signFor(voucher)
      const byType: Record<GstType, Money> = { cgst: 0, sgst: 0, igst: 0, cess: 0 }
      for (const line of voucher.taxes) {
        const category = taxById.value.get(line.taxCategoryId)
        if (!category || !isGstType(category.type)) continue
        byType[category.type] += sign * line.amount
      }
      return {
        id: voucher.id,
        number: voucher.number,
        date: voucher.date,
        party: partyName(voucher),
        gstin: partyGstin(voucher),
        taxable: sign * grossValue(voucher),
        cgst: byType.cgst,
        sgst: byType.sgst,
        igst: byType.igst,
        cess: byType.cess,
        tax: sign * taxTotal(voucher),
        total: sign * invoiceTotal(voucher),
        isCreditNote: voucher.type === 'credit-note',
      }
    })
    .sort((left, right) => (left.date === right.date ? left.number.localeCompare(right.number) : right.date.localeCompare(left.date))),
)

const salesCount = computed(() => outbound.value.filter((voucher) => voucher.type === 'sales').length)
const creditNoteCount = computed(() => outbound.value.filter((voucher) => voucher.type === 'credit-note').length)

/* ------------------------------------------------------------------ *
 * Loading
 * ------------------------------------------------------------------ */

async function load() {
  const companyId = session.activeCompanyId
  const period = activePeriod.value
  const token = ++requestId
  if (!companyId || !period) {
    outbound.value = []
    loading.value = false
    return
  }
  loading.value = true
  error.value = null
  try {
    const [sales, credits] = await Promise.all([
      session.repository.listVouchers(companyId, {
        type: 'sales',
        from: period.from,
        to: period.to,
        status: 'posted',
      }),
      session.repository.listVouchers(companyId, {
        type: 'credit-note',
        from: period.from,
        to: period.to,
        status: 'posted',
      }),
    ])
    if (token !== requestId) return
    outbound.value = [...sales, ...credits]
  } catch (cause) {
    if (token !== requestId) return
    outbound.value = []
    error.value =
      cause instanceof Error
        ? cause.message
        : 'The vouchers for this tax period could not be read from the repository.'
  } finally {
    if (token === requestId) loading.value = false
  }
}

onMounted(async () => {
  if (!session.ready && !session.loading) await session.bootstrap()
  await load()
})

watch(
  periods,
  (list) => {
    if (!list.length) {
      selectedPeriod.value = ''
      return
    }
    if (!list.some((period) => period.value === selectedPeriod.value)) {
      selectedPeriod.value = list[list.length - 1]!.value
    }
  },
  { immediate: true },
)

watch(
  [selectedPeriod, () => session.activeCompanyId],
  () => {
    void load()
  },
)

/* ------------------------------------------------------------------ *
 * Local export
 * ------------------------------------------------------------------ */

/** Major-unit decimal built with integer arithmetic only. */
function majorString(minor: Money): string {
  const meta = currencyMeta(currency.value)
  const sign = minor < 0 ? '-' : ''
  const absolute = Math.abs(minor)
  const whole = Math.floor(absolute / meta.minorUnits)
  const fraction = String(absolute % meta.minorUnits).padStart(meta.decimals, '0')
  return `${sign}${whole}.${fraction}`
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function downloadCsv() {
  const period = activePeriod.value
  if (!period || !annexureRows.value.length) {
    toast.warning('Nothing to export', 'This tax period has no posted sales invoices.')
    return
  }

  const lines: string[][] = [
    ['GSTR-1 summary (prepared locally — not filed)'],
    ['Tax period', period.label],
    ['Company', company.value?.name ?? ''],
    ['GSTIN', company.value?.gstin ?? 'Not configured'],
    ['Currency', currency.value],
    ['Status', 'Prepared locally. Filing requires the GST portal, which is not connected in this build.'],
    [],
    ['Tax type', 'Taxable value', 'Tax amount'],
    ...typeRows.value.map((row) => [row.label, majorString(row.taxable), majorString(row.tax)]),
    ['Total', '', majorString(totalTax.value)],
    [],
    ['Invoice', 'Date', 'Party', 'Party GSTIN', 'Taxable value', 'CGST', 'SGST', 'IGST', 'Total'],
    ...annexureRows.value.map((row) => [
      row.number,
      row.date,
      row.party,
      row.gstin,
      majorString(row.taxable),
      majorString(row.cgst),
      majorString(row.sgst),
      majorString(row.igst),
      majorString(row.total),
    ]),
  ]

  const csv = lines.map((cells) => cells.map(csvCell).join(',')).join('\r\n')
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `gstr-1-${period.value}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)

  toast.success(
    'Summary exported',
    `${annexureRows.value.length} invoice rows written to gstr-1-${period.value}.csv. This is a local file, not a filing.`,
  )
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      title="GSTR-1"
      subtitle="Outbound supply summary prepared from the books"
      icon="description"
      :breadcrumb="[{ label: 'Tax and compliance' }, { label: 'GSTR-1' }]"
    >
      <template #title-meta>
        <BaseBadge tone="info" size="xs" icon="edit_document">Prepared locally</BaseBadge>
      </template>
    </PageHeader>

    <FilterBar>
      <BaseSelect
        v-model="selectedPeriod"
        label="Tax period"
        size="sm"
        class="w-48"
        :options="periodOptions"
        :disabled="!periodOptions.length"
      />
      <template #trailing>
        <BaseButton
          size="sm"
          variant="outlined"
          icon="download"
          :disabled="!annexureRows.length || loading"
          @click="downloadCsv"
        >
          Download summary (CSV)
        </BaseButton>
      </template>
    </FilterBar>

    <div class="min-h-0 flex-1 overflow-auto p-space-lg">
      <div v-if="loading" class="space-y-space-md">
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-4">
          <BaseSkeleton v-for="index in 4" :key="index" class="h-24" />
        </div>
        <BaseSkeleton class="h-48" />
        <BaseSkeleton class="h-64" />
      </div>

      <div
        v-else-if="error"
        class="rounded-sm border-l-4 border-l-error bg-error-container p-space-md"
        role="alert"
      >
        <p class="text-label-md font-bold text-on-error-container">The summary could not be built</p>
        <p class="mt-0.5 text-body-sm text-on-error-container">{{ error }}</p>
      </div>

      <template v-else>
        <!-- What this is -->
        <div class="rounded-sm border-l-4 border-l-tertiary bg-surface-container-low p-space-md">
          <div class="flex items-start gap-space-sm">
            <MaterialIcon name="info" :size="18" class="mt-0.5 shrink-0 text-tertiary" />
            <div class="min-w-0">
              <p class="text-label-md font-bold text-on-surface">
                <template v-if="salesCount === 0 && creditNoteCount === 0">
                  No sales invoice or credit note was posted in this period.
                </template>
                <template v-else>
                  Prepared from {{ salesCount }} sales
                  {{ salesCount === 1 ? 'invoice' : 'invoices' }}<span v-if="creditNoteCount">
                    and {{ creditNoteCount }} credit
                    {{ creditNoteCount === 1 ? 'note' : 'notes' }}</span
                  >.
                </template>
                Filing requires the GST portal, which is not connected in this build.
              </p>
              <p class="mt-0.5 text-body-sm text-on-surface-variant">
                This screen computes the return from posted vouchers in your books. It has not been
                submitted anywhere, no ARN exists, and nothing on this screen is a filing status.
              </p>
            </div>
          </div>
        </div>

        <div class="mt-space-md grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Taxable value of supply"
            :value="formatMoney(totalTaxableSupply, currency)"
            icon="receipt_long"
            hint="Posted sales less credit notes in the period"
          />
          <StatTile
            label="Total output tax"
            :value="formatMoney(totalTax, currency)"
            icon="percent"
            tone="info"
            :hint="`${activePeriod?.label ?? 'Period'} · prepared locally`"
          />
          <StatTile
            label="Sales invoices"
            :value="String(salesCount)"
            icon="shopping_cart"
            hint="Posted vouchers in the selected period"
          />
          <StatTile
            label="Credit notes"
            :value="String(creditNoteCount)"
            icon="description"
            hint="Reduce the taxable value above"
          />
        </div>

        <BaseCard
          class="mt-space-md"
          title="Outbound supply by tax type"
          description="Taxable value and tax collected, split by tax head"
        >
          <DataTable
            :columns="typeColumns"
            :rows="typeRows"
            row-key="type"
            :clickable="false"
            empty-title="No outbound supply"
            empty-description="No posted sales invoice or credit note falls in this tax period."
          >
            <template #cell:taxable="{ row }">
              <span class="num text-on-surface">{{ formatMoney(row.taxable, currency) }}</span>
            </template>
            <template #cell:tax="{ row }">
              <span class="num font-semibold text-on-surface">{{ formatMoney(row.tax, currency) }}</span>
            </template>
            <template #cell:share="{ row }">
              <span class="num text-on-surface-variant">
                {{ totalTax === 0 ? '—' : `${((row.tax / totalTax) * 100).toFixed(1)}%` }}
              </span>
            </template>
          </DataTable>

          <p class="mt-space-sm text-label-xs text-outline">
            CGST and SGST are charged on the same intra-state supply, so the taxable value repeats
            across those two rows and must not be added together.
          </p>
        </BaseCard>

        <BaseCard
          class="mt-space-md"
          title="Tax category detail"
          description="The tax categories actually used by the vouchers in this period"
        >
          <DataTable
            :columns="categoryColumns"
            :rows="categoryRows"
            row-key="id"
            :clickable="false"
            empty-title="No tax charged"
            empty-description="No posted voucher in this period carries GST."
          >
            <template #cell:rate="{ row }">
              <span class="num text-on-surface">{{ rateLabel(row.rate) }}</span>
            </template>
            <template #cell:taxable="{ row }">
              <span class="num text-on-surface">{{ formatMoney(row.taxable, currency) }}</span>
            </template>
            <template #cell:tax="{ row }">
              <span class="num font-semibold text-on-surface">{{ formatMoney(row.tax, currency) }}</span>
            </template>
          </DataTable>
        </BaseCard>

        <BaseCard
          class="mt-space-md"
          title="Invoice annexure"
          description="Every posted sales invoice and credit note in the period"
        >
          <DataTable
            :columns="annexureColumns"
            :rows="annexureRows"
            row-key="id"
            :clickable="false"
            empty-title="No invoices in this period"
            empty-description="Choose another tax period, or post a sales invoice in the books."
          >
            <template #cell:number="{ row }">
              <span class="flex items-center gap-1.5">
                <span class="num font-semibold text-on-surface">{{ row.number }}</span>
                <BaseBadge v-if="row.isCreditNote" tone="danger" size="xs">Credit note</BaseBadge>
              </span>
            </template>
            <template #cell:date="{ row }">
              <span class="num text-on-surface-variant">{{ formatDate(row.date) }}</span>
            </template>
            <template #cell:gstin="{ row }">
              <span class="num text-on-surface-variant">{{ row.gstin }}</span>
            </template>
            <template #cell:taxable="{ row }">
              <span class="num text-on-surface">{{ formatMoney(row.taxable, currency) }}</span>
            </template>
            <template #cell:cgst="{ row }">
              <span class="num text-on-surface">{{ formatMoney(row.cgst, currency) }}</span>
            </template>
            <template #cell:sgst="{ row }">
              <span class="num text-on-surface">{{ formatMoney(row.sgst, currency) }}</span>
            </template>
            <template #cell:igst="{ row }">
              <span class="num text-on-surface">{{ formatMoney(row.igst, currency) }}</span>
            </template>
            <template #cell:total="{ row }">
              <span class="num font-semibold text-on-surface">{{ formatMoney(row.total, currency) }}</span>
            </template>
          </DataTable>
        </BaseCard>

        <BaseEmptyState
          v-if="!annexureRows.length"
          class="mt-space-md"
          :icon="EmptyIcon"
          title="No outbound supply in this period"
          description="Nothing was posted to sales or credit notes between the period start and end."
        />
      </template>
    </div>
  </div>
</template>
