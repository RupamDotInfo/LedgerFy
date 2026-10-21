<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseEmptyState from '@/components/ui/BaseEmptyState.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import FilterBar from '@/components/ui/FilterBar.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import StatTile from '@/components/ui/StatTile.vue'
import { useToastStore } from '@/stores/toast'
import { useSessionStore } from '@/stores/session'
import type { TaxType, Voucher } from '@/domain/types'
import { currencyMeta, formatMoney, type Money } from '@/lib/money'
import { formatPeriod } from '@/lib/datetime'

const session = useSessionStore()
const toast = useToastStore()

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

type GstType = 'cgst' | 'sgst' | 'igst' | 'cess'

type TaxPeriod = {
  value: string
  label: string
  from: string
  to: string
}

type BreakdownRow = {
  id: string
  label: string
  detail: string
  amount: Money
  kind: 'section' | 'item' | 'subtotal' | 'result'
}

const GST_TYPES: GstType[] = ['cgst', 'sgst', 'igst', 'cess']

const GST_TYPE_LABELS: Record<GstType, string> = {
  cgst: 'CGST',
  sgst: 'SGST',
  igst: 'IGST',
  cess: 'Cess',
}

const EmptyIcon = () => h(MaterialIcon, { name: 'inbox', size: 19 })

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

const selectedPeriod = ref('')
const sales = ref<Voucher[]>([])
const creditNotes = ref<Voucher[]>([])
const purchases = ref<Voucher[]>([])
const debitNotes = ref<Voucher[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
let requestId = 0

const company = computed(() => session.activeCompany)
const currency = computed(() => company.value?.baseCurrency ?? 'INR')

const taxById = computed(
  () => new Map(session.taxCategories.map((category) => [category.id, category])),
)

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function monthPeriods(from: string, to: string): TaxPeriod[] {
  if (!from || !to) return []
  const periods: TaxPeriod[] = []
  const start = new Date(`${from}T00:00:00`)
  const end = new Date(`${to}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return []
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
  while (
    cursor.getFullYear() < end.getFullYear() ||
    (cursor.getFullYear() === end.getFullYear() && cursor.getMonth() <= end.getMonth())
  ) {
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

function isGstType(type: TaxType): type is GstType {
  return type === 'cgst' || type === 'sgst' || type === 'igst' || type === 'cess'
}

function taxOf(voucher: Voucher, type: GstType): Money {
  return voucher.taxes.reduce((sum, line) => {
    const category = taxById.value.get(line.taxCategoryId)
    if (!category || category.type !== type) return sum
    return sum + line.amount
  }, 0)
}

function totalTaxOf(voucher: Voucher): Money {
  return voucher.taxes.reduce((sum, line) => {
    const category = taxById.value.get(line.taxCategoryId)
    if (!category || !isGstType(category.type)) return sum
    return sum + line.amount
  }, 0)
}

/** The supplier ledger of a purchase, used for the eligibility test. */
function supplierTaxNumber(voucher: Voucher): string {
  if (!voucher.partyId) return ''
  const ledger = session.ledgers.find((candidate) => candidate.id === voucher.partyId)
  return ledger?.taxNumber?.trim() ?? ''
}

/* ------------------------------------------------------------------ *
 * Derived figures
 * ------------------------------------------------------------------ */

const outputTax = computed(() => {
  const positive = sales.value.reduce((sum, voucher) => sum + totalTaxOf(voucher), 0)
  const negative = creditNotes.value.reduce((sum, voucher) => sum + totalTaxOf(voucher), 0)
  return positive - negative
})

const inputTax = computed(() => {
  const positive = purchases.value.reduce((sum, voucher) => sum + totalTaxOf(voucher), 0)
  const negative = debitNotes.value.reduce((sum, voucher) => sum + totalTaxOf(voucher), 0)
  return positive - negative
})

/**
 * Simple eligibility test used by this screen: input tax on a purchase is
 * eligible when the supplier ledger carries a tax number. The statutory
 * eligibility rules are not implemented — see the notice on the screen.
 */
const eligibleInputCredit = computed(() =>
  purchases.value.reduce(
    (sum, voucher) => (supplierTaxNumber(voucher) ? sum + totalTaxOf(voucher) : sum),
    0,
  ),
)

const notEligibleInputCredit = computed(() => inputTax.value - eligibleInputCredit.value)

const challanPayable = computed(() => Math.max(0, outputTax.value - eligibleInputCredit.value))

const excessCredit = computed(() => Math.max(0, eligibleInputCredit.value - outputTax.value))

const breakdownRows = computed<BreakdownRow[]>(() => {
  const rows: BreakdownRow[] = []
  rows.push({
    id: 'outward',
    label: 'Outward supplies — tax on sales',
    detail: 'Posted sales invoices, less credit notes',
    amount: outputTax.value,
    kind: 'section',
  })
  for (const type of GST_TYPES) {
    const positive = sales.value.reduce((sum, voucher) => sum + taxOf(voucher, type), 0)
    const negative = creditNotes.value.reduce((sum, voucher) => sum + taxOf(voucher, type), 0)
    rows.push({
      id: `out-${type}`,
      label: `Output ${GST_TYPE_LABELS[type]}`,
      detail: 'Tax collected on outward supplies',
      amount: positive - negative,
      kind: 'item',
    })
  }
  rows.push({
    id: 'out-total',
    label: 'Total output tax',
    detail: 'Sum of the outward tax heads above',
    amount: outputTax.value,
    kind: 'subtotal',
  })
  rows.push({
    id: 'inward',
    label: 'Inward supplies — tax on purchases',
    detail: 'Posted purchase bills, less debit notes',
    amount: inputTax.value,
    kind: 'section',
  })
  for (const type of GST_TYPES) {
    const positive = purchases.value.reduce((sum, voucher) => sum + taxOf(voucher, type), 0)
    const negative = debitNotes.value.reduce((sum, voucher) => sum + taxOf(voucher, type), 0)
    rows.push({
      id: `in-${type}`,
      label: `Input ${GST_TYPE_LABELS[type]}`,
      detail: 'Tax paid on inward supplies',
      amount: positive - negative,
      kind: 'item',
    })
  }
  rows.push({
    id: 'in-total',
    label: 'Total input tax',
    detail: 'Sum of the inward tax heads above',
    amount: inputTax.value,
    kind: 'subtotal',
  })
  rows.push({
    id: 'eligible',
    label: 'Less — input credit eligible',
    detail: 'Purchase tax where the supplier ledger carries a tax number',
    amount: -eligibleInputCredit.value,
    kind: 'item',
  })
  rows.push({
    id: 'not-eligible',
    label: 'Input credit not eligible',
    detail: 'Purchase tax where the supplier ledger has no tax number',
    amount: notEligibleInputCredit.value,
    kind: 'item',
  })
  rows.push({
    id: 'result',
    label: challanPayable.value > 0 ? 'Challan payable' : 'Excess input credit carried forward',
    detail:
      challanPayable.value > 0
        ? 'Output tax less eligible input credit'
        : 'Eligible input credit exceeds the output tax',
    amount: challanPayable.value > 0 ? challanPayable.value : excessCredit.value,
    kind: 'result',
  })
  return rows
})

const voucherCount = computed(
  () =>
    sales.value.length +
    creditNotes.value.length +
    purchases.value.length +
    debitNotes.value.length,
)

/* ------------------------------------------------------------------ *
 * Loading
 * ------------------------------------------------------------------ */

async function load() {
  const companyId = session.activeCompanyId
  const period = activePeriod.value
  const token = ++requestId
  if (!companyId || !period) {
    sales.value = []
    creditNotes.value = []
    purchases.value = []
    debitNotes.value = []
    loading.value = false
    return
  }
  loading.value = true
  error.value = null
  try {
    const filters = { from: period.from, to: period.to, status: 'posted' as const }
    const [salesList, creditList, purchaseList, debitList] = await Promise.all([
      session.repository.listVouchers(companyId, { ...filters, type: 'sales' }),
      session.repository.listVouchers(companyId, { ...filters, type: 'credit-note' }),
      session.repository.listVouchers(companyId, { ...filters, type: 'purchase' }),
      session.repository.listVouchers(companyId, { ...filters, type: 'debit-note' }),
    ])
    if (token !== requestId) return
    sales.value = salesList
    creditNotes.value = creditList
    purchases.value = purchaseList
    debitNotes.value = debitList
  } catch (cause) {
    if (token !== requestId) return
    sales.value = []
    creditNotes.value = []
    purchases.value = []
    debitNotes.value = []
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

watch([selectedPeriod, () => session.activeCompanyId], () => {
  void load()
})

/* ------------------------------------------------------------------ *
 * Local export
 * ------------------------------------------------------------------ */

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
  if (!period) return
  const lines: string[][] = [
    ['GSTR-3B summary (computed locally — not filed)'],
    ['Tax period', period.label],
    ['Company', company.value?.name ?? ''],
    ['GSTIN', company.value?.gstin ?? 'Not configured'],
    ['Currency', currency.value],
    ['Status', 'Computed from the books. Filing requires the GST portal, which is not connected in this build.'],
    [],
    ['Line', 'Description', 'Amount'],
    ...breakdownRows.value.map((row) => [row.label, row.detail, majorString(row.amount)]),
  ]
  const csv = lines.map((cells) => cells.map(csvCell).join(',')).join('\r\n')
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `gstr-3b-${period.value}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
  toast.success(
    'Summary exported',
    `gstr-3b-${period.value}.csv written. This is a local file, not a filed return.`,
  )
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      title="GSTR-3B"
      subtitle="Monthly summary of output tax, input credit and challan payable"
      icon="description"
      :breadcrumb="[{ label: 'Tax and compliance' }, { label: 'GSTR-3B' }]"
    >
      <template #title-meta>
        <BaseBadge tone="warning" size="xs" icon="cloud_off">Not filed</BaseBadge>
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
          :disabled="loading || !activePeriod"
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
        <BaseSkeleton class="h-72" />
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
        <div class="rounded-sm border-l-4 border-l-tertiary bg-surface-container-low p-space-md">
          <div class="flex items-start gap-space-sm">
            <MaterialIcon name="warning" :size="18" class="mt-0.5 shrink-0 text-tertiary" />
            <div class="min-w-0">
              <p class="text-label-md font-bold text-on-surface">
                This is a locally computed summary, not a filed GSTR-3B.
              </p>
              <p class="mt-0.5 text-body-sm text-on-surface-variant">
                <template v-if="voucherCount === 0">
                  Nothing was posted to sales, credit notes, purchases or debit notes in
                  {{ activePeriod?.label ?? 'this period' }}, so every figure below is zero.
                </template>
                <template v-else>
                  The figures below are calculated from {{ voucherCount }} posted
                  {{ voucherCount === 1 ? 'voucher' : 'vouchers' }} in your books for
                  {{ activePeriod?.label ?? 'the period' }}.
                </template>
                Nothing has been submitted to the GST portal, no challan has been paid, and no ARN or
                filing status exists for this return.
              </p>
            </div>
          </div>
        </div>

        <div class="mt-space-md grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Output tax"
            :value="formatMoney(outputTax, currency)"
            icon="north_east"
            tone="info"
            hint="Tax collected on outward supplies"
          />
          <StatTile
            label="Input tax"
            :value="formatMoney(inputTax, currency)"
            icon="south_west"
            hint="Tax paid on inward supplies"
          />
          <StatTile
            label="Input credit eligible"
            :value="formatMoney(eligibleInputCredit, currency)"
            icon="task_alt"
            tone="positive"
            hint="Simple supplier tax-number test only"
          />
          <StatTile
            label="Challan payable"
            :value="formatMoney(challanPayable, currency)"
            icon="payments"
            :tone="challanPayable > 0 ? 'warning' : 'default'"
            :hint="excessCredit > 0 ? `${formatMoney(excessCredit, currency)} excess credit` : 'Output tax less eligible credit'"
          />
        </div>

        <BaseCard
          class="mt-space-md"
          title="Monthly breakdown"
          description="Every line that feeds the challan figure"
        >
          <div class="overflow-x-auto">
            <table class="w-full text-left text-body-sm">
              <thead
                class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline"
              >
                <tr>
                  <th scope="col" class="px-space-md py-2.5">Line</th>
                  <th scope="col" class="px-space-md py-2.5">Basis</th>
                  <th scope="col" class="px-space-md py-2.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-surface-container-low">
                <tr
                  v-for="row in breakdownRows"
                  :key="row.id"
                  :class="{
                    'bg-surface-container-low/70': row.kind === 'section',
                    'bg-inverse-surface text-inverse-on-surface': row.kind === 'result',
                    'font-semibold': row.kind === 'subtotal' || row.kind === 'result',
                  }"
                >
                  <td
                    class="px-space-md py-2"
                    :class="row.kind === 'section' ? 'section-label' : 'text-on-surface'"
                  >
                    {{ row.label }}
                  </td>
                  <td
                    class="px-space-md py-2 text-label-sm"
                    :class="
                      row.kind === 'result'
                        ? 'text-inverse-on-surface/80'
                        : 'text-on-surface-variant'
                    "
                  >
                    {{ row.detail }}
                  </td>
                  <td
                    class="num px-space-md py-2 text-right"
                    :class="
                      row.kind === 'result'
                        ? 'text-numeric-md font-bold text-inverse-on-surface'
                        : row.kind === 'subtotal'
                          ? 'font-bold text-on-surface'
                          : 'text-on-surface-variant'
                    "
                  >
                    {{ formatMoney(row.amount, currency) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </BaseCard>

        <div class="mt-space-md grid grid-cols-1 gap-space-md lg:grid-cols-2">
          <div class="rounded-sm border-l-4 border-l-tertiary bg-surface-container-low p-space-md">
            <div class="flex items-start gap-space-sm">
              <MaterialIcon name="rule" :size="18" class="mt-0.5 shrink-0 text-tertiary" />
              <div class="min-w-0">
                <p class="text-label-md font-bold text-on-surface">Input credit eligibility</p>
                <p class="mt-0.5 text-body-sm text-on-surface-variant">
                  This screen applies one simple test: input tax on a purchase is eligible when the
                  supplier ledger carries a tax number, and not eligible when it does not. The
                  statutory eligibility rules — section 16 and 17, section 16A and 16B, the place of
                  supply and the time limit for availing credit — are not implemented. Treat
                  {{ formatMoney(eligibleInputCredit, currency) }} as an indication, not a claim.
                </p>
              </div>
            </div>
          </div>

          <div class="rounded-sm border-l-4 border-l-tertiary bg-surface-container-low p-space-md">
            <div class="flex items-start gap-space-sm">
              <MaterialIcon name="lock_open" :size="18" class="mt-0.5 shrink-0 text-tertiary" />
              <div class="min-w-0">
                <p class="text-label-md font-bold text-on-surface">Period locking and reconciliation</p>
                <p class="mt-0.5 text-body-sm text-on-surface-variant">
                  Return-period locking is not implemented, so a period summarised here can still be
                  changed by later vouchers, and nothing is reconciled against data already filed
                  on the portal. Neither is implemented in this build.
                </p>
              </div>
            </div>
          </div>
        </div>

        <BaseEmptyState
          v-if="!voucherCount"
          class="mt-space-md"
          :icon="EmptyIcon"
          title="Nothing posted in this period"
          description="No sales, credit note, purchase or debit note voucher falls in the selected tax period."
        />
      </template>
    </div>
  </div>
</template>
