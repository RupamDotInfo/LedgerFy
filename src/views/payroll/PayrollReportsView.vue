<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

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
import { summariseRun } from '@/domain/payroll'
import type { PayrollPayment, PayrollRun, PayrollSnapshot } from '@/domain/types'
import { formatDate, formatPeriod } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { useSessionStore } from '@/stores/session'
import { useToastStore } from '@/stores/toast'
import {
  periodBounds,
  periodOptions,
  runState,
  runStateTone,
  RUN_STATE_LABEL,
} from '@/views/payroll/payrollSupport'

const session = useSessionStore()
const toast = useToastStore()
const router = useRouter()

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

const runColumns: TableColumnSpec[] = [
  { key: 'number', label: 'Run', sortable: true },
  { key: 'periodLabel', label: 'Period', sortable: true },
  { key: 'paymentDate', label: 'Payment date', sortable: true },
  { key: 'employeeCount', label: 'Employees', align: 'right', numeric: true },
  { key: 'grossEarnings', label: 'Gross', align: 'right', numeric: true },
  { key: 'employeeDeductions', label: 'Employee deductions', align: 'right', numeric: true },
  { key: 'statutoryDeductions', label: 'Statutory deductions', align: 'right', numeric: true },
  { key: 'employerContributions', label: "Employer's share", align: 'right', numeric: true },
  { key: 'netPay', label: 'Net payable', align: 'right', numeric: true },
  { key: 'state', label: 'State' },
]

const EmptyIcon = () => h(MaterialIcon, { name: 'query_stats', size: 19 })

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

const loading = ref(true)
const runs = ref<PayrollRun[]>([])
const snapshots = ref<PayrollSnapshot[]>([])
const payments = ref<PayrollPayment[]>([])

const periodFilter = ref('all')
const runFilter = ref('all')

const currency = computed(() => session.activeCompany?.baseCurrency ?? 'INR')
const companyId = computed(() => session.activeCompanyId)

const periodOptionsAvailable = computed(() => {
  const periods = new Set<string>()
  for (const run of runs.value) periods.add(run.period)
  return [...periods].sort().reverse()
})

const periodFilterOptions = computed(() => [
  { value: 'all', label: 'All periods' },
  ...periodOptions(periodOptionsAvailable.value),
])

const filteredRuns = computed(() =>
  runs.value.filter((run) => {
    if (periodFilter.value !== 'all' && run.period !== periodFilter.value) return false
    if (runFilter.value !== 'all' && run.id !== runFilter.value) return false
    return true
  }),
)

const runRows = computed(() =>
  filteredRuns.value.map((run) => {
    const bounds = periodBounds(run.period)
    return {
      id: run.id,
      number: run.number,
      period: run.period,
      periodLabel: formatPeriod(bounds.start),
      paymentDate: run.paymentDate,
      employeeCount: run.employeeCount,
      grossEarnings: run.grossEarnings,
      employeeDeductions: run.employeeDeductions,
      statutoryDeductions: run.statutoryDeductions,
      employerContributions: run.employerContributions,
      netPay: run.netPay,
      state: runState(
        run,
        snapshots.value.some((snapshot) => snapshot.runId === run.id),
        payments.value.filter((payment) => payment.runId === run.id),
      ),
    }
  }),
)

/** The snapshots of the runs the filters leave. */
const selectedSnapshots = computed(() => {
  const ids = new Set(filteredRuns.value.map((run) => run.id))
  return snapshots.value.filter((snapshot) => ids.has(snapshot.runId))
})

/** The totals of the period, from the domain. */
const totals = computed(() => summariseRun(selectedSnapshots.value.map((entry) => entry.snapshot)))

/** Every statutory deduction of the period, by the rule that took it. */
const statutoryBreakdown = computed(() => {
  const byCode = new Map<string, { code: string; name: string; amount: number }>()
  for (const snapshot of selectedSnapshots.value) {
    for (const entry of snapshot.snapshot.statutoryDeductions) {
      const existing = byCode.get(entry.code)
      if (existing) existing.amount += entry.amount
      else byCode.set(entry.code, { ...entry })
    }
  }
  return [...byCode.values()].sort((left, right) => right.amount - left.amount)
})

const employeeBreakdown = computed(() => {
  const byCode = new Map<string, { code: string; name: string; amount: number }>()
  for (const snapshot of selectedSnapshots.value) {
    for (const entry of snapshot.snapshot.employeeDeductions) {
      const existing = byCode.get(entry.code)
      if (existing) existing.amount += entry.amount
      else byCode.set(entry.code, { ...entry })
    }
  }
  return [...byCode.values()].sort((left, right) => right.amount - left.amount)
})

const employerBreakdown = computed(() => {
  const byCode = new Map<string, { code: string; name: string; amount: number }>()
  for (const snapshot of selectedSnapshots.value) {
    for (const entry of snapshot.snapshot.employerContributions) {
      const existing = byCode.get(entry.code)
      if (existing) existing.amount += entry.amount
      else byCode.set(entry.code, { ...entry })
    }
  }
  return [...byCode.values()].sort((left, right) => right.amount - left.amount)
})

const selectedRunIds = computed(() => new Set(filteredRuns.value.map((run) => run.id)))

const paymentRows = computed(() =>
  payments.value
    .filter((payment) => selectedRunIds.value.has(payment.runId))
    .map((payment) => {
      const employee = session.employees.find((entry) => entry.id === payment.employeeId)
      const run = runs.value.find((entry) => entry.id === payment.runId)
      return {
        id: payment.id,
        name: employee?.name ?? 'Unknown employee',
        code: employee?.code ?? '—',
        runNumber: run?.number ?? '—',
        paidOn: payment.paidOn,
        amount: payment.amount,
      }
    }),
)

/* ------------------------------------------------------------------ *
 * Loading
 * ------------------------------------------------------------------ */

async function load() {
  const id = companyId.value
  if (!id) {
    runs.value = []
    snapshots.value = []
    payments.value = []
    loading.value = false
    return
  }
  loading.value = true
  try {
    const list = await session.repository.listPayrollRuns(id)
    runs.value = list
    const details = await Promise.all(
      list.map((run) => session.repository.getPayrollRun(id, run.id)),
    )
    snapshots.value = details.flatMap((detail) => (detail ? detail.snapshots : []))
    const allPayments: PayrollPayment[] = []
    await Promise.all(
      list.map(async (run) => {
        allPayments.push(...(await session.repository.listPayrollPayments(id, run.id)))
      }),
    )
    payments.value = allPayments
  } catch (cause) {
    toast.error(
      'The payroll reports could not be read',
      cause instanceof Error ? cause.message : 'The repository did not say why.',
    )
  } finally {
    loading.value = false
  }
}

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

onMounted(async () => {
  if (!session.ready && !session.loading) await session.bootstrap()
  await load()
})

watch(
  () => session.activeCompanyId,
  () => {
    void load()
  },
)
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      title="Payroll reports"
      subtitle="The register, the statutory summary and the payments"
      icon="query_stats"
      :breadcrumb="[{ label: 'Payroll' }, { label: 'Reports' }]"
    />

    <FilterBar>
      <BaseSelect
        v-model="periodFilter"
        label="Period"
        size="sm"
        class="w-56"
        :options="periodFilterOptions"
      />
      <BaseSelect
        v-model="runFilter"
        label="Run"
        size="sm"
        class="w-56"
        :options="[
          { value: 'all', label: 'All runs' },
          ...runs.map((run) => ({ value: run.id, label: run.number })),
        ]"
      />
      <template #trailing>
        <span class="text-label-sm text-outline">{{ filteredRuns.length }} runs</span>
      </template>
    </FilterBar>

    <div class="min-h-0 flex-1 overflow-auto p-space-lg">
      <div v-if="loading" class="space-y-space-md">
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-4">
          <BaseSkeleton v-for="index in 4" :key="index" class="h-24" />
        </div>
        <BaseSkeleton class="h-72" />
      </div>

      <template v-else>
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Gross earnings"
            :value="formatMoney(totals.grossEarnings, currency)"
            icon="trending_up"
            hint="The gross of the runs shown"
          />
          <StatTile
            label="Net payable"
            :value="formatMoney(totals.netPay, currency)"
            icon="account_balance_wallet"
            tone="info"
            hint="What the employees are owed"
          />
          <StatTile
            label="Employee contributions"
            :value="formatMoney(totals.employeeDeductions, currency)"
            icon="remove_circle_outline"
            hint="What the employees contribute"
          />
          <StatTile
            label="Employer's contributions"
            :value="formatMoney(totals.employerContributions, currency)"
            icon="handshake"
            hint="What the employer owes on their behalf"
          />
        </div>

        <BaseCard
          class="mt-space-md"
          title="The run register"
          description="Every run in the period, with the totals it carries"
          padded
        >
          <DataTable
            :columns="runColumns"
            :rows="runRows"
            row-key="id"
            empty-title="No payroll run in this period"
            empty-description="Raise a run and calculate it to see it here."
          >
            <template #cell:number="{ row }">
              <button
                type="button"
                class="num font-semibold text-primary hover:underline"
                @click="router.push(`/payroll/pay-runs/${row.id}`)"
              >
                {{ row.number }}
              </button>
            </template>
            <template #cell:periodLabel="{ row }">
              <span class="num text-on-surface-variant">{{ row.periodLabel }}</span>
            </template>
            <template #cell:paymentDate="{ row }">
              <span class="num text-on-surface-variant">{{ formatDate(row.paymentDate) }}</span>
            </template>
            <template #cell:employeeCount="{ row }">
              <span class="num text-on-surface">{{ row.employeeCount }}</span>
            </template>
            <template #cell:grossEarnings="{ row }">
              <span class="num text-on-surface">{{ formatMoney(row.grossEarnings, currency) }}</span>
            </template>
            <template #cell:employeeDeductions="{ row }">
              <span class="num text-on-surface">
                {{ formatMoney(row.employeeDeductions, currency) }}
              </span>
            </template>
            <template #cell:statutoryDeductions="{ row }">
              <span class="num text-on-surface">
                {{ formatMoney(row.statutoryDeductions, currency) }}
              </span>
            </template>
            <template #cell:employerContributions="{ row }">
              <span class="num text-on-surface">
                {{ formatMoney(row.employerContributions, currency) }}
              </span>
            </template>
            <template #cell:netPay="{ row }">
              <span class="num font-semibold text-on-surface">{{ formatMoney(row.netPay, currency) }}</span>
            </template>
            <template #cell:state="{ row }">
              <BaseBadge :tone="runStateTone(row.state)" size="xs">
                {{ RUN_STATE_LABEL[row.state] }}
              </BaseBadge>
            </template>
          </DataTable>
        </BaseCard>

        <div class="mt-space-md grid grid-cols-1 gap-space-md lg:grid-cols-3">
          <BaseCard
            title="The statutory summary"
            description="What the rules took, and what the employer owes on top"
          >
            <div v-if="!selectedSnapshots.length" class="text-body-sm text-on-surface-variant">
              No run in this period has been calculated, so there is nothing to summarise.
            </div>
            <div v-else class="space-y-space-md">
              <div>
                <p class="section-label mb-1">The employees' contributions</p>
                <ul class="space-y-1">
                  <li
                    v-for="entry in employeeBreakdown"
                    :key="entry.code"
                    class="flex items-center justify-between gap-2 text-body-sm"
                  >
                    <span class="text-on-surface-variant">{{ entry.name }}</span>
                    <span class="num text-on-surface">{{ formatMoney(entry.amount, currency) }}</span>
                  </li>
                </ul>
              </div>
              <div>
                <p class="section-label mb-1">The tax deducted at source</p>
                <ul class="space-y-1">
                  <li
                    v-for="entry in statutoryBreakdown"
                    :key="entry.code"
                    class="flex items-center justify-between gap-2 text-body-sm"
                  >
                    <span class="text-on-surface-variant">{{ entry.name }}</span>
                    <span class="num text-on-surface">{{ formatMoney(entry.amount, currency) }}</span>
                  </li>
                  <li v-if="!statutoryBreakdown.length" class="text-body-sm text-on-surface-variant">
                    No statutory deduction was made in this period.
                  </li>
                </ul>
              </div>
              <div>
                <p class="section-label mb-1">The employer's contributions</p>
                <ul class="space-y-1">
                  <li
                    v-for="entry in employerBreakdown"
                    :key="entry.code"
                    class="flex items-center justify-between gap-2 text-body-sm"
                  >
                    <span class="text-on-surface-variant">{{ entry.name }}</span>
                    <span class="num text-on-surface">{{ formatMoney(entry.amount, currency) }}</span>
                  </li>
                </ul>
              </div>
              <div class="rounded-sm bg-inverse-surface p-space-sm text-inverse-on-surface">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-label-sm">The liability the runs create</span>
                  <span class="num text-headline-sm">{{ formatMoney(totals.liability, currency) }}</span>
                </div>
              </div>
            </div>
          </BaseCard>

          <BaseCard
            title="The payments"
            description="What has been paid against the runs shown"
            class="lg:col-span-2"
          >
            <div v-if="!paymentRows.length" class="text-body-sm text-on-surface-variant">
              Nothing has been paid against the runs shown. A payment is recorded on the run once
              the salary has been paid.
            </div>
            <ul v-else class="space-y-space-sm">
              <li
                v-for="payment in paymentRows"
                :key="payment.id"
                class="flex flex-wrap items-center justify-between gap-2 rounded-sm bg-surface-container-low p-space-sm"
              >
                <div class="min-w-0">
                  <p class="text-body-md text-on-surface">{{ payment.name }}</p>
                  <p class="text-label-xs text-outline">
                    {{ payment.runNumber }} · {{ formatDate(payment.paidOn) }}
                  </p>
                </div>
                <span class="num text-body-md text-on-surface">
                  {{ formatMoney(payment.amount, currency) }}
                </span>
              </li>
            </ul>
          </BaseCard>
        </div>

        <BaseEmptyState
          v-if="!runs.length"
          class="mt-space-md"
          :icon="EmptyIcon"
          title="No payroll run yet"
          description="Raise a payroll run and calculate it to see the register, the statutory summary and the payments."
        >
          <BaseButton size="sm" variant="primary" icon="payments" @click="router.push('/payroll/pay-runs')">
            Go to the payroll runs
          </BaseButton>
        </BaseEmptyState>
      </template>
    </div>
  </div>
</template>
