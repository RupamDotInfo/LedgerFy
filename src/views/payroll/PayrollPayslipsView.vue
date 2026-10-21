<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseEmptyState from '@/components/ui/BaseEmptyState.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import DataTable from '@/components/ui/DataTable.vue'
import FilterBar from '@/components/ui/FilterBar.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import StatTile from '@/components/ui/StatTile.vue'
import type { PayrollRun, PayrollSnapshot } from '@/domain/types'
import { formatPeriod } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { useSessionStore } from '@/stores/session'
import { useToastStore } from '@/stores/toast'

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

type PayslipRow = {
  id: string
  employeeId: string
  name: string
  code: string
  department: string
  runId: string
  runNumber: string
  period: string
  periodLabel: string
  grossEarnings: number
  netPay: number
}

const columns: TableColumnSpec[] = [
  { key: 'name', label: 'Employee', sortable: true },
  { key: 'code', label: 'Code' },
  { key: 'department', label: 'Department' },
  { key: 'runNumber', label: 'Run' },
  { key: 'periodLabel', label: 'Period', sortable: true },
  { key: 'grossEarnings', label: 'Gross', align: 'right', numeric: true },
  { key: 'netPay', label: 'Net pay', align: 'right', numeric: true },
]

const EmptyIcon = () => h(MaterialIcon, { name: 'receipt', size: 19 })

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

const loading = ref(true)
const runs = ref<PayrollRun[]>([])
const snapshots = ref<PayrollSnapshot[]>([])

const search = ref('')
const runFilter = ref('all')

const currency = computed(() => session.activeCompany?.baseCurrency ?? 'INR')
const companyId = computed(() => session.activeCompanyId)

const runOptions = computed(() => [
  { value: 'all', label: 'All runs' },
  ...runs.value.map((run) => ({ value: run.id, label: run.number })),
])

const rows = computed<PayslipRow[]>(() => {
  const term = search.value.trim().toLowerCase()
  const byRun = new Map(runs.value.map((run) => [run.id, run]))
  return snapshots.value
    .map((snapshot) => {
      const run = byRun.get(snapshot.runId)
      const employee = session.employees.find((entry) => entry.id === snapshot.employeeId)
      return {
        id: `${snapshot.runId}-${snapshot.employeeId}`,
        employeeId: snapshot.employeeId,
        name: employee?.name ?? 'Unknown employee',
        code: employee?.code ?? '—',
        department: employee?.department ?? 'Not recorded',
        runId: snapshot.runId,
        runNumber: run?.number ?? '—',
        period: run?.period ?? '',
        periodLabel: run ? formatPeriod(run.periodStart) : '—',
        grossEarnings: snapshot.snapshot.grossEarnings,
        netPay: snapshot.snapshot.netPay,
      }
    })
    .filter((row) => {
      if (runFilter.value !== 'all' && row.runId !== runFilter.value) return false
      if (!term) return true
      return `${row.name} ${row.code} ${row.department} ${row.runNumber}`.toLowerCase().includes(term)
    })
})

const grossShown = computed(() => rows.value.reduce((sum, row) => sum + row.grossEarnings, 0))
const netShown = computed(() => rows.value.reduce((sum, row) => sum + row.netPay, 0))

/* ------------------------------------------------------------------ *
 * Loading
 * ------------------------------------------------------------------ */

async function load() {
  const id = companyId.value
  if (!id) {
    runs.value = []
    snapshots.value = []
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
  } catch (cause) {
    toast.error(
      'The payslips could not be read',
      cause instanceof Error ? cause.message : 'The repository did not say why.',
    )
  } finally {
    loading.value = false
  }
}

function openPayslip(row: PayslipRow) {
  void router.push(`/payroll/payslips/${row.runId}/${row.employeeId}`)
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
      title="Payslips"
      subtitle="The payslip of every employee in the runs this company has calculated"
      icon="receipt"
      :breadcrumb="[{ label: 'Payroll' }, { label: 'Payslips' }]"
    />

    <FilterBar>
      <BaseInput
        v-model="search"
        type="search"
        placeholder="Search by employee, code or run"
        size="sm"
        class="w-72"
        label="Search"
      />
      <BaseSelect v-model="runFilter" label="Run" size="sm" class="w-56" :options="runOptions" />
      <template #trailing>
        <span class="text-label-sm text-outline">{{ rows.length }} payslips</span>
      </template>
    </FilterBar>

    <div class="min-h-0 flex-1 overflow-auto p-space-lg">
      <div v-if="loading" class="space-y-space-md">
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-3">
          <BaseSkeleton v-for="index in 3" :key="index" class="h-24" />
        </div>
        <BaseSkeleton class="h-72" />
      </div>

      <template v-else>
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-3">
          <StatTile
            label="Payslips"
            :value="String(rows.length)"
            icon="receipt"
            hint="One for each employee in each run"
          />
          <StatTile label="Gross" :value="formatMoney(grossShown, currency)" icon="trending_up" />
          <StatTile
            label="Net pay"
            :value="formatMoney(netShown, currency)"
            icon="account_balance_wallet"
            tone="info"
          />
        </div>

        <BaseCard
          class="mt-space-md"
          title="Payslips"
          description="Each payslip is rendered from the snapshot that was stored when the run was calculated"
          padded
        >
          <DataTable
            :columns="columns"
            :rows="rows"
            row-key="id"
            empty-title="No payslip yet"
            empty-description="A payslip exists once a run has been calculated."
          >
            <template #cell:name="{ row }">
              <button
                type="button"
                class="text-on-surface hover:text-primary hover:underline"
                @click="openPayslip(row)"
              >
                {{ row.name }}
              </button>
            </template>
            <template #cell:code="{ row }">
              <span class="num text-on-surface-variant">{{ row.code }}</span>
            </template>
            <template #cell:department="{ row }">
              <span class="text-on-surface-variant">{{ row.department }}</span>
            </template>
            <template #cell:runNumber="{ row }">
              <button
                type="button"
                class="num text-primary hover:underline"
                @click="router.push(`/payroll/pay-runs/${row.runId}`)"
              >
                {{ row.runNumber }}
              </button>
            </template>
            <template #cell:periodLabel="{ row }">
              <span class="num text-on-surface-variant">{{ row.periodLabel }}</span>
            </template>
            <template #cell:grossEarnings="{ row }">
              <span class="num text-on-surface">{{ formatMoney(row.grossEarnings, currency) }}</span>
            </template>
            <template #cell:netPay="{ row }">
              <span class="num font-semibold text-on-surface">{{ formatMoney(row.netPay, currency) }}</span>
            </template>
          </DataTable>
        </BaseCard>

        <BaseEmptyState
          v-if="!rows.length"
          class="mt-space-md"
          :icon="EmptyIcon"
          title="No payslip yet"
          description="Calculate a payroll run and the payslip of each employee in it will be listed here."
        >
          <BaseButton size="sm" variant="primary" icon="payments" @click="router.push('/payroll/pay-runs')">
            Go to the payroll runs
          </BaseButton>
        </BaseEmptyState>
      </template>
    </div>
  </div>
</template>
