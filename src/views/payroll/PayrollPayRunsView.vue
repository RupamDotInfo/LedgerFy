<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseEmptyState from '@/components/ui/BaseEmptyState.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import DataTable from '@/components/ui/DataTable.vue'
import FilterBar from '@/components/ui/FilterBar.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import StatTile from '@/components/ui/StatTile.vue'
import type { PayrollPayment, PayrollRun, PayrollRunState } from '@/domain/types'
import { formatDate } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { useSessionStore } from '@/stores/session'
import { useToastStore } from '@/stores/toast'
import { calculateRun } from '@/views/payroll/payrollActions'
import PayrollPostDialog from '@/views/payroll/PayrollPostDialog.vue'
import { usePostRun } from '@/views/payroll/usePostRun'
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
const postRun = usePostRun()

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

type RunRow = {
  id: string
  number: string
  period: string
  periodLabel: string
  paymentDate: string
  employeeCount: number
  grossEarnings: number
  netPay: number
  state: PayrollRunState
  run: PayrollRun
}

const columns: TableColumnSpec[] = [
  { key: 'number', label: 'Run', sortable: true },
  { key: 'periodLabel', label: 'Period', sortable: true },
  { key: 'paymentDate', label: 'Payment date', sortable: true },
  { key: 'employeeCount', label: 'Employees', align: 'right', numeric: true },
  { key: 'grossEarnings', label: 'Gross', align: 'right', numeric: true },
  { key: 'netPay', label: 'Net payable', align: 'right', numeric: true },
  { key: 'state', label: 'State' },
  { key: 'actions', label: '', width: '210px' },
]

const EmptyIcon = () => h(MaterialIcon, { name: 'receipt_long', size: 19 })

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

const loading = ref(true)
const busy = ref(false)
const runs = ref<PayrollRun[]>([])
const snapshotsOf = ref<Map<string, number>>(new Map())
const paymentsOf = ref<Map<string, PayrollPayment[]>>(new Map())

const search = ref('')
const periodFilter = ref('all')
const stateFilter = ref('all')

const newRunOpen = ref(false)
const newRunPeriod = ref('')
const newRunPaymentDate = ref('')
const newRunError = ref('')
const postOpen = ref(false)
/** The run the confirmation is open for. */
const postingRow = ref<RunRow | null>(null)

const currency = computed(() => session.activeCompany?.baseCurrency ?? 'INR')
const companyId = computed(() => session.activeCompanyId)

const stateOptions = [
  { value: 'all', label: 'All states' },
  ...(['draft', 'calculated', 'approved', 'posted', 'paid', 'cancelled'] as PayrollRunState[]).map(
    (state) => ({ value: state, label: RUN_STATE_LABEL[state] }),
  ),
]

/** The periods a run may be raised for: the open financial year. */
const availablePeriods = computed(() => {
  const year = session.activeFinancialYear
  const periods: string[] = []
  if (year) {
    const [startYear, startMonth] = year.start.split('-').map(Number)
    for (let index = 0; index < 12; index += 1) {
      const month = startMonth + index
      const yearNumber = startYear + Math.floor((month - 1) / 12)
      const monthNumber = ((month - 1) % 12) + 1
      periods.push(`${yearNumber}-${String(monthNumber).padStart(2, '0')}`)
    }
  }
  for (const run of runs.value) {
    if (!periods.includes(run.period)) periods.push(run.period)
  }
  return periods.sort().reverse()
})

const periodFilterOptions = computed(() => [
  { value: 'all', label: 'All periods' },
  ...periodOptions(availablePeriods.value),
])

const rows = computed<RunRow[]>(() => {
  const term = search.value.trim().toLowerCase()
  return runs.value
    .map((run) => {
      const state = runState(
        run,
        (snapshotsOf.value.get(run.id) ?? 0) > 0,
        paymentsOf.value.get(run.id) ?? [],
      )
      const bounds = periodBounds(run.period)
      return {
        id: run.id,
        number: run.number,
        period: run.period,
        periodLabel: bounds.start,
        paymentDate: run.paymentDate,
        employeeCount: run.employeeCount,
        grossEarnings: run.grossEarnings,
        netPay: run.netPay,
        state,
        run,
      }
    })
    .filter((row) => {
      if (periodFilter.value !== 'all' && row.period !== periodFilter.value) return false
      if (stateFilter.value !== 'all' && row.state !== stateFilter.value) return false
      if (!term) return true
      return `${row.number} ${row.period}`.toLowerCase().includes(term)
    })
})

const filtered = computed(() => rows.value)

const grossShown = computed(() =>
  filtered.value.reduce((sum, row) => sum + row.grossEarnings, 0),
)
const netShown = computed(() => filtered.value.reduce((sum, row) => sum + row.netPay, 0))
const employeesShown = computed(() =>
  filtered.value.reduce((sum, row) => sum + row.employeeCount, 0),
)

/* ------------------------------------------------------------------ *
 * Loading
 * ------------------------------------------------------------------ */

async function load() {
  const id = companyId.value
  if (!id) {
    runs.value = []
    loading.value = false
    return
  }
  loading.value = true
  try {
    const list = await session.repository.listPayrollRuns(id)
    runs.value = list

    // The state of a run is derived from what has happened to it, so the
    // snapshot and the payments are read with it.
    const details = await Promise.all(
      list.map((run) => session.repository.getPayrollRun(id, run.id)),
    )
    const snapshotCounts = new Map<string, number>()
    for (const detail of details) {
      if (detail) snapshotCounts.set(detail.run.id, detail.snapshots.length)
    }
    snapshotsOf.value = snapshotCounts

    const payments = new Map<string, PayrollPayment[]>()
    await Promise.all(
      list
        .filter((run) => run.journalVoucherId !== null)
        .map(async (run) => {
          payments.set(run.id, await session.repository.listPayrollPayments(id, run.id))
        }),
    )
    paymentsOf.value = payments
  } catch (cause) {
    toast.error(
      'The payroll runs could not be read',
      cause instanceof Error ? cause.message : 'The repository did not say why.',
    )
  } finally {
    loading.value = false
  }
}

/* ------------------------------------------------------------------ *
 * The actions
 * ------------------------------------------------------------------ */

function openNewRun() {
  const periods = availablePeriods.value
  newRunPeriod.value = periods[0] ?? ''
  newRunPaymentDate.value = newRunPeriod.value ? `${newRunPeriod.value}-28` : ''
  newRunError.value = ''
  newRunOpen.value = true
}

async function createRun() {
  const id = companyId.value
  if (!id) {
    newRunError.value = 'Open a company before raising a payroll run.'
    return
  }
  if (!newRunPeriod.value) {
    newRunError.value = 'Choose the period the run pays.'
    return
  }
  if (!newRunPaymentDate.value) {
    newRunError.value = 'Choose the date the salary is paid on.'
    return
  }

  busy.value = true
  try {
    const number = await session.repository.nextPayrollNumber(id, newRunPeriod.value)
    const bounds = periodBounds(newRunPeriod.value)
    const now = new Date().toISOString()
    const run: PayrollRun = {
      id: `run-${Date.now().toString(36)}`,
      companyId: id,
      number,
      period: newRunPeriod.value,
      periodStart: bounds.start,
      periodEnd: bounds.end,
      paymentDate: newRunPaymentDate.value,
      status: 'draft',
      employeeCount: 0,
      grossEarnings: 0,
      employeeDeductions: 0,
      statutoryDeductions: 0,
      employerContributions: 0,
      netPay: 0,
      journalVoucherId: null,
      createdAt: now,
      updatedAt: now,
      revision: 1,
    }
    await session.repository.savePayrollRun(run)
    newRunOpen.value = false
    toast.success('Payroll run raised', `${number} is a draft for ${bounds.start}.`)
    await load()
    await router.push(`/payroll/pay-runs/${run.id}`)
  } catch (cause) {
    newRunError.value =
      cause instanceof Error ? cause.message : 'The run was not saved and the repository did not say why.'
  } finally {
    busy.value = false
  }
}

async function calculate(row: RunRow) {
  const id = companyId.value
  if (!id) return
  busy.value = true
  try {
    const employees = await session.repository.listEmployees(id)
    const year = session.activeFinancialYear
    const calculation = await calculateRun(
      session.repository,
      id,
      row.run,
      employees,
      year?.start ?? `${row.period.slice(0, 4)}-04-01`,
      year?.end ?? `${Number(row.period.slice(0, 4)) + 1}-03-31`,
    )
    if (calculation.blocked.length) {
      toast.error(
        'The run is blocked by a rule that is not in force',
        calculation.blocked.map((entry) => entry.reason).join(' '),
      )
      return
    }
    await session.repository.savePayrollRun(calculation.run, calculation.snapshots)
    toast.success(
      'Payroll calculated',
      `${row.number} carries ${calculation.run.employeeCount} employees and ${formatMoney(calculation.run.netPay, currency.value)} of net pay.`,
    )
    await load()
  } catch (cause) {
    toast.error(
      'The run was not calculated',
      cause instanceof Error ? cause.message : 'The repository did not say why.',
    )
  } finally {
    busy.value = false
  }
}

async function approve(row: RunRow) {
  const id = companyId.value
  if (!id) return
  busy.value = true
  try {
    // A posted run keeps the journal that carried it; a run that is not
    // posted has none.
    await session.repository.savePayrollRun({ ...row.run, status: 'approved' })
    toast.success('Payroll approved', `${row.number} is approved and may now be posted.`)
    await load()
  } catch (cause) {
    toast.error(
      'The run was not approved',
      cause instanceof Error ? cause.message : 'The repository did not say why.',
    )
  } finally {
    busy.value = false
  }
}

async function post(row: RunRow) {
  const id = companyId.value
  if (!id) return
  busy.value = true
  try {
    const detail = await session.repository.getPayrollRun(id, row.id)
    if (!detail) {
      toast.error('The run was not posted', 'The run could not be read from the repository.')
      return
    }
    const prepared = await postRun.prepare(detail.run, detail.snapshots)
    if (!prepared) {
      toast.error('The run was not posted', postRun.reason.value)
      return
    }
    postingRow.value = row
    postOpen.value = true
  } catch (cause) {
    toast.error(
      'The run was not posted',
      cause instanceof Error ? cause.message : 'The repository did not say why.',
    )
  } finally {
    busy.value = false
  }
}

async function confirmPost(row: RunRow) {
  busy.value = true
  try {
    const posted = await postRun.post(row.run)
    if (!posted) {
      toast.error('The run was not posted', postRun.reason.value)
      return
    }
    postOpen.value = false
    await load()
  } finally {
    busy.value = false
  }
}

async function cancel(row: RunRow) {
  const id = companyId.value
  if (!id) return
  busy.value = true
  try {
    await session.repository.savePayrollRun({ ...row.run, status: 'cancelled' })
    toast.success('Payroll cancelled', `${row.number} has been cancelled.`)
    await load()
  } catch (cause) {
    toast.error(
      'The run was not cancelled',
      cause instanceof Error ? cause.message : 'The repository did not say why.',
    )
  } finally {
    busy.value = false
  }
}

function openDetail(row: RunRow) {
  void router.push(`/payroll/pay-runs/${row.id}`)
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
      title="Payroll runs"
      subtitle="Every run of salary this company has raised"
      icon="payments"
      :breadcrumb="[{ label: 'Payroll' }, { label: 'Pay runs' }]"
    >
      <template #actions>
        <BaseButton size="sm" variant="primary" icon="add" @click="openNewRun">New run</BaseButton>
      </template>
    </PageHeader>

    <FilterBar>
      <BaseInput
        v-model="search"
        type="search"
        placeholder="Search by run number or period"
        size="sm"
        class="w-64"
        label="Search"
      />
      <BaseSelect
        v-model="periodFilter"
        label="Period"
        size="sm"
        class="w-48"
        :options="periodFilterOptions"
      />
      <BaseSelect
        v-model="stateFilter"
        label="State"
        size="sm"
        class="w-44"
        :options="stateOptions"
      />
      <template #trailing>
        <span class="text-label-sm text-outline">{{ filtered.length }} runs</span>
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
            label="Runs"
            :value="String(filtered.length)"
            icon="receipt_long"
            hint="The runs that match the filters"
          />
          <StatTile
            label="Employees paid"
            :value="String(employeesShown)"
            icon="groups"
            hint="Across the runs that match the filters"
          />
          <StatTile
            label="Gross"
            :value="formatMoney(grossShown, currency)"
            icon="trending_up"
            hint="The gross of the runs that match the filters"
          />
          <StatTile
            label="Net payable"
            :value="formatMoney(netShown, currency)"
            icon="account_balance_wallet"
            hint="The net of the runs that match the filters"
          />
        </div>

        <BaseCard
          class="mt-space-md"
          title="Payroll register"
          description="A run is calculated from a draft, approved from a calculated run and posted from an approved run"
          padded
        >
          <DataTable
            :columns="columns"
            :rows="filtered"
            row-key="id"
            empty-title="No payroll run yet"
            empty-description="Raise a run for a period to begin paying salary."
          >
            <template #cell:number="{ row }">
              <button
                type="button"
                class="num font-semibold text-primary hover:underline"
                @click.stop="openDetail(row)"
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
            <template #cell:netPay="{ row }">
              <span class="num font-semibold text-on-surface">{{ formatMoney(row.netPay, currency) }}</span>
            </template>
            <template #cell:state="{ row }">
              <BaseBadge :tone="runStateTone(row.state)" size="xs">
                {{ RUN_STATE_LABEL[row.state] }}
              </BaseBadge>
            </template>
            <template #cell:actions="{ row }">
              <div class="flex items-center justify-end gap-1" @click.stop>
                <BaseButton
                  v-if="row.state === 'draft'"
                  size="xs"
                  variant="tonal"
                  icon="calculate"
                  :disabled="busy"
                  @click="calculate(row)"
                >
                  Calculate
                </BaseButton>
                <BaseButton
                  v-if="row.state === 'calculated'"
                  size="xs"
                  variant="tonal"
                  icon="task_alt"
                  :disabled="busy"
                  @click="approve(row)"
                >
                  Approve
                </BaseButton>
                <BaseButton
                  v-if="row.state === 'approved'"
                  size="xs"
                  variant="primary"
                  icon="send"
                  :disabled="busy"
                  @click="post(row)"
                >
                  Post
                </BaseButton>
                <BaseButton
                  v-if="['draft', 'calculated', 'approved'].includes(row.state)"
                  size="xs"
                  variant="text"
                  icon="block"
                  :disabled="busy"
                  @click="cancel(row)"
                >
                  Cancel
                </BaseButton>
                <BaseButton
                  size="xs"
                  variant="text"
                  icon="chevron_right"
                  @click="openDetail(row)"
                >
                  Open
                </BaseButton>
              </div>
            </template>
          </DataTable>
        </BaseCard>

        <BaseEmptyState
          v-if="!filtered.length && !runs.length"
          class="mt-space-md"
          :icon="EmptyIcon"
          title="No payroll run yet"
          description="Raise a run for the period you are paying, then calculate it from the salary structures and the attendance."
        >
          <BaseButton size="sm" variant="primary" icon="add" @click="openNewRun">New run</BaseButton>
        </BaseEmptyState>
      </template>
    </div>

    <PayrollPostDialog
      :open="postOpen"
      :journal="postRun.journal.value"
      :reason="postRun.reason.value"
      :posting="postRun.posting.value"
      @close="postOpen = false"
      @post="confirmPost(postingRow!)"
    />

    <BaseModal
      :open="newRunOpen"
      title="New payroll run"
      description="A run starts as a draft and is calculated from the salary structures"
      size="md"
      @close="newRunOpen = false"
    >
      <div class="space-y-space-md">
        <BaseSelect
          v-model="newRunPeriod"
          label="Period"
          :options="periodOptions(availablePeriods)"
          required
        />
        <BaseInput
          v-model="newRunPaymentDate"
          label="Payment date"
          type="date"
          required
          hint="The date the salary is paid on. The statutory rules in force on this date are the ones the run uses."
        />
        <div v-if="newRunError" class="rounded-sm bg-error-container p-space-sm">
          <p class="text-label-sm text-on-error-container">{{ newRunError }}</p>
        </div>
      </div>

      <template #footer>
        <BaseButton variant="text" @click="newRunOpen = false">Cancel</BaseButton>
        <BaseButton variant="primary" icon="add" :loading="busy" @click="createRun">
          Raise the run
        </BaseButton>
      </template>
    </BaseModal>
  </div>
</template>
