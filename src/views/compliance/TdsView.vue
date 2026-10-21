<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseEmptyState from '@/components/ui/BaseEmptyState.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import DataTable from '@/components/ui/DataTable.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import StatTile from '@/components/ui/StatTile.vue'
import { useSessionStore } from '@/stores/session'
import { computeLedgerBalances } from '@/domain/accounting'
import type { Ledger, TaxCategory, Voucher } from '@/domain/types'
import { formatMoney, type Money } from '@/lib/money'

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

type LedgerRow = {
  id: string
  name: string
  kind: string
  taxNumber: string
  debits: Money
  rate: string
  rateTone: 'neutral' | 'info' | 'warning'
}

type CategoryRow = {
  id: string
  name: string
  type: string
  rate: number
  hsn: string
  ledger: string
  isActive: boolean
}

const ledgerColumns: TableColumnSpec[] = [
  { key: 'name', label: 'Ledger', sortable: true },
  { key: 'kind', label: 'Kind' },
  { key: 'taxNumber', label: 'Tax number on file' },
  { key: 'debits', label: 'Period debits', align: 'right', numeric: true, sortable: true },
  { key: 'rate', label: 'Applicable rate' },
]

const partyColumns: TableColumnSpec[] = [
  { key: 'name', label: 'Party', sortable: true },
  { key: 'kind', label: 'Kind' },
  { key: 'taxNumber', label: 'Tax number on file' },
  { key: 'debits', label: 'Period debits', align: 'right', numeric: true, sortable: true },
  { key: 'rate', label: 'Applicable rate' },
]

const categoryColumns: TableColumnSpec[] = [
  { key: 'name', label: 'Tax category', sortable: true },
  { key: 'type', label: 'Type' },
  { key: 'rate', label: 'Rate', align: 'right', numeric: true, sortable: true },
  { key: 'hsn', label: 'HSN / SAC' },
  { key: 'ledger', label: 'Posts to ledger' },
  { key: 'status', label: 'State' },
]

const EmptyIcon = () => h(MaterialIcon, { name: 'percent', size: 19 })

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

const vouchers = ref<Voucher[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
let requestId = 0

const company = computed(() => session.activeCompany)
const currency = computed(() => company.value?.baseCurrency ?? 'INR')

/* ------------------------------------------------------------------ *
 * Master data
 * ------------------------------------------------------------------ */

const tdsCategories = computed<TaxCategory[]>(() =>
  session.taxCategories.filter(
    (category) => category.type === 'tds' || category.type === 'tcs',
  ),
)

const activeTdsCategories = computed(() => tdsCategories.value.filter((category) => category.isActive))

/**
 * The rate that would apply to a payment. Which section a payment falls
 * under, and therefore which rate applies, is not implemented — so the
 * screen reports what is configured rather than choosing a rate.
 */
function applicableRate(): { text: string; tone: 'neutral' | 'info' | 'warning' } {
  if (!activeTdsCategories.value.length) {
    return { text: 'No TDS category configured', tone: 'neutral' }
  }
  if (activeTdsCategories.value.length === 1) {
    const category = activeTdsCategories.value[0]!
    return { text: `${category.rate}% (${category.name})`, tone: 'info' }
  }
  return { text: 'Multiple categories — section not linked', tone: 'warning' }
}

function resolveLedgerName(ledgerId: string | null): string {
  if (!ledgerId) return 'Not linked to a ledger'
  const ledger = session.ledgers.find((candidate) => candidate.id === ledgerId)
  return ledger ? ledger.name : 'Linked ledger not found'
}

const categoryRows = computed<CategoryRow[]>(() =>
  tdsCategories.value.map((category) => ({
    id: category.id,
    name: category.name,
    type: category.type === 'tds' ? 'TDS' : 'TCS',
    rate: category.rate,
    hsn: category.hsn ?? 'Not recorded',
    ledger: resolveLedgerName(category.ledgerId),
    isActive: category.isActive,
  })),
)

/* ------------------------------------------------------------------ *
 * Ledgers in scope
 * ------------------------------------------------------------------ */

const balances = computed(() =>
  computeLedgerBalances(session.ledgers, vouchers.value, {
    from: session.activePeriod.from,
    to: session.activePeriod.to,
  }),
)

const debitsByLedger = computed(() => {
  const map = new Map<string, Money>()
  for (const balance of balances.value) map.set(balance.ledger.id, balance.debitTotal)
  return map
})

const expenseLedgers = computed<Ledger[]>(() =>
  session.ledgers.filter((ledger) => ledger.group === 'expenses' && ledger.isActive),
)

const partyLedgers = computed<Ledger[]>(() =>
  session.ledgers.filter((ledger) => ledger.partyKind !== null && ledger.isActive),
)

function toRow(ledger: Ledger, kind: string): LedgerRow {
  const rate = applicableRate()
  return {
    id: ledger.id,
    name: ledger.name,
    kind,
    taxNumber: ledger.taxNumber?.trim() || 'Not on file',
    debits: debitsByLedger.value.get(ledger.id) ?? 0,
    rate: rate.text,
    rateTone: rate.tone,
  }
}

const expenseRows = computed<LedgerRow[]>(() =>
  expenseLedgers.value
    .map((ledger) => toRow(ledger, 'Expense'))
    .sort((left, right) => right.debits - left.debits),
)

const partyRows = computed<LedgerRow[]>(() =>
  partyLedgers.value
    .map((ledger) => toRow(ledger, ledger.partyKind === 'customer' ? 'Customer' : 'Supplier'))
    .sort((left, right) => right.debits - left.debits),
)

const totalExpenseDebits = computed(() =>
  expenseRows.value.reduce((sum, row) => sum + row.debits, 0),
)

const partiesWithTaxNumber = computed(
  () => partyRows.value.filter((row) => row.taxNumber !== 'Not on file').length,
)

const tdsPayableLedger = computed<Ledger | null>(
  () =>
    session.ledgers.find(
      (ledger) => ledger.group === 'liabilities' && /tds|tax deducted/i.test(ledger.name),
    ) ?? null,
)

/* ------------------------------------------------------------------ *
 * Readiness
 * ------------------------------------------------------------------ */

const readiness = [
  {
    title: 'A tax category per section',
    detail: 'Each section needs its own rate and its own control account. None is configured in this company.',
    done: activeTdsCategories.value.length > 0,
  },
  {
    title: 'The payee PAN on file',
    detail: 'TDS is deducted on the PAN of the payee, not on a GSTIN. The party master carries a tax number field, but no PAN validation is implemented.',
    done: partiesWithTaxNumber.value > 0,
  },
  {
    title: 'A rule for when to deduct',
    detail: 'Section thresholds, single-payment and aggregate limits and the year-end collection rules are not implemented.',
    done: false,
  },
  {
    title: 'A posting path for the deduction',
    detail: tdsPayableLedger.value
      ? `The chart of accounts carries ${tdsPayableLedger.value.name}, but no voucher type posts a deduction to it automatically.`
      : 'A payable control account to credit the deduction is not present in the chart of accounts.',
    done: false,
  },
  {
    title: 'A return and a challan',
    detail: 'Quarterly TDS reporting, challan payment and payee certificates are not implemented and no filing can be made from this build.',
    done: false,
  },
]

/* ------------------------------------------------------------------ *
 * Loading
 * ------------------------------------------------------------------ */

async function load() {
  const companyId = session.activeCompanyId
  const period = session.activePeriod
  const token = ++requestId
  if (!companyId) {
    vouchers.value = []
    loading.value = false
    return
  }
  loading.value = true
  error.value = null
  try {
    const list = await session.repository.listVouchers(companyId, {
      from: period.from,
      to: period.to,
    })
    if (token !== requestId) return
    vouchers.value = list
  } catch (cause) {
    if (token !== requestId) return
    vouchers.value = []
    error.value =
      cause instanceof Error
        ? cause.message
        : 'The vouchers for this period could not be read from the repository.'
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
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      title="TDS and TCS"
      subtitle="Ledgers that would be subject to deduction at source"
      icon="percent"
      :breadcrumb="[{ label: 'Tax and compliance' }, { label: 'TDS and TCS' }]"
    >
      <template #title-meta>
        <BaseBadge tone="warning" size="xs" icon="block">Deduction not implemented</BaseBadge>
      </template>
    </PageHeader>

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
        <p class="text-label-md font-bold text-on-error-container">The ledger scan could not be run</p>
        <p class="mt-0.5 text-body-sm text-on-error-container">{{ error }}</p>
      </div>

      <template v-else>
        <div class="rounded-sm border-l-4 border-l-tertiary bg-surface-container-low p-space-md">
          <div class="flex items-start gap-space-sm">
            <MaterialIcon name="info" :size="18" class="mt-0.5 shrink-0 text-tertiary" />
            <div class="min-w-0">
              <p class="text-label-md font-bold text-on-surface">
                No tax is being deducted, withheld or collected by this build.
              </p>
              <p class="mt-0.5 text-body-sm text-on-surface-variant">
                The screens below identify the ledgers that would be subject to deduction and the
                rates that are configured. They do not compute an amount, post a deduction or
                produce a return.
              </p>
            </div>
          </div>
        </div>

        <div class="mt-space-md grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="TDS and TCS categories"
            :value="String(tdsCategories.length)"
            icon="percent"
            :tone="tdsCategories.length ? 'info' : 'warning'"
            :hint="tdsCategories.length ? 'Configured in the tax master' : 'None configured'"
          />
          <StatTile
            label="Expense ledgers in scope"
            :value="String(expenseRows.length)"
            icon="receipt_long"
            hint="Where a deduction is usually taken"
          />
          <StatTile
            label="Party ledgers in scope"
            :value="String(partyRows.length)"
            icon="contacts"
            :hint="`${partiesWithTaxNumber} with a tax number on file`"
          />
          <StatTile
            label="Period debits on expense ledgers"
            :value="formatMoney(totalExpenseDebits, currency)"
            icon="south_west"
            hint="Accounting activity, not a deduction base"
          />
        </div>

        <BaseCard
          class="mt-space-md"
          title="TDS and TCS tax categories"
          description="The rates this company has configured"
        >
          <DataTable
            :columns="categoryColumns"
            :rows="categoryRows"
            row-key="id"
            :clickable="false"
            empty-title="No TDS or TCS category configured"
            empty-description="Add a TDS or TCS tax category in the tax master before a rate can be shown here."
          >
            <template #cell:rate="{ row }">
              <span class="num font-semibold text-on-surface">{{ row.rate }}%</span>
            </template>
            <template #cell:status="{ row }">
              <BaseBadge
                :tone="row.isActive ? 'positive' : 'neutral'"
                size="xs"
                :icon="row.isActive ? 'check_circle' : 'pause'"
              >
                {{ row.isActive ? 'Active' : 'Inactive' }}
              </BaseBadge>
            </template>
          </DataTable>

          <div class="mt-space-sm rounded-sm border-l-4 border-l-tertiary bg-surface-container-low p-space-sm">
            <p class="text-label-sm text-on-surface-variant">
              Rate applicability by section is not implemented. A category named “TDS 10%” does not
              establish that a particular payment attracts 10%, and the screen does not decide which
              section a payment falls under. Verify the rate against the section before it is
              applied to any payment.
            </p>
          </div>
        </BaseCard>

        <div class="mt-space-md grid grid-cols-1 items-start gap-space-md xl:grid-cols-2">
          <BaseCard
            title="Expense ledgers"
            description="Ledgers where a deduction would ordinarily be taken"
          >
            <DataTable
              :columns="ledgerColumns"
              :rows="expenseRows"
              row-key="id"
              :clickable="false"
              empty-title="No expense ledgers"
              empty-description="This company has no active expense ledger in the chart of accounts."
            >
              <template #cell:debits="{ row }">
                <span class="num text-on-surface">{{ formatMoney(row.debits, currency) }}</span>
              </template>
              <template #cell:rate="{ row }">
                <BaseBadge :tone="row.rateTone" size="xs">{{ row.rate }}</BaseBadge>
              </template>
            </DataTable>
          </BaseCard>

          <BaseCard
            title="Party ledgers"
            description="Payees and customers, with the tax number held against each"
          >
            <DataTable
              :columns="partyColumns"
              :rows="partyRows"
              row-key="id"
              :clickable="false"
              empty-title="No party ledgers"
              empty-description="This company has no customer or supplier ledger in the chart of accounts."
            >
              <template #cell:debits="{ row }">
                <span class="num text-on-surface">{{ formatMoney(row.debits, currency) }}</span>
              </template>
              <template #cell:rate="{ row }">
                <BaseBadge :tone="row.rateTone" size="xs">{{ row.rate }}</BaseBadge>
              </template>
            </DataTable>
          </BaseCard>
        </div>

        <BaseCard
          class="mt-space-md"
          title="Readiness"
          description="What deduction, collection and remittance would still need"
        >
          <ul class="space-y-space-sm">
            <li
              v-for="item in readiness"
              :key="item.title"
              class="flex items-start gap-space-sm rounded-sm bg-surface-container-low p-space-sm"
            >
              <MaterialIcon
                :name="item.done ? 'check_circle' : 'radio_button_unchecked'"
                :size="18"
                class="mt-0.5 shrink-0"
                :class="item.done ? 'text-secondary' : 'text-outline'"
              />
              <div class="min-w-0">
                <p class="text-label-md font-bold text-on-surface">
                  {{ item.title }}
                  <span
                    class="ml-1 font-normal text-label-xs text-outline"
                  >
                    {{ item.done ? 'Partly present' : 'Not implemented' }}
                  </span>
                </p>
                <p class="mt-0.5 text-body-sm text-on-surface-variant">{{ item.detail }}</p>
              </div>
            </li>
          </ul>
        </BaseCard>

        <BaseEmptyState
          v-if="!tdsCategories.length"
          class="mt-space-md"
          :icon="EmptyIcon"
          title="No TDS or TCS tax category configured"
          description="Until a tax category of type TDS or TCS exists, no rate can be shown against any ledger."
        />
      </template>
    </div>
  </div>
</template>
