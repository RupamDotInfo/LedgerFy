<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseEmptyState from '@/components/ui/BaseEmptyState.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import DataTable from '@/components/ui/DataTable.vue'
import FilterBar from '@/components/ui/FilterBar.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import StatTile from '@/components/ui/StatTile.vue'
import { useSessionStore } from '@/stores/session'
import { formatMoney, type Money } from '@/lib/money'
import { formatPeriod } from '@/lib/datetime'

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

type TaxPeriod = {
  value: string
  label: string
  from: string
  to: string
}

type ParticipantRow = {
  id: string
  code: string
  name: string
  department: string
  dateOfJoining: string
  monthlyGross: Money
}

const columns: TableColumnSpec[] = [
  { key: 'code', label: 'Code', sortable: true },
  { key: 'name', label: 'Employee', sortable: true },
  { key: 'department', label: 'Department' },
  { key: 'dateOfJoining', label: 'Date of joining', sortable: true },
  { key: 'monthlyGross', label: 'Monthly gross', align: 'right', numeric: true, sortable: true },
]

const EmptyIcon = () => h(MaterialIcon, { name: 'payments', size: 19 })

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

const selectedPeriod = ref('')

const company = computed(() => session.activeCompany)
const currency = computed(() => company.value?.baseCurrency ?? 'INR')

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

/* ------------------------------------------------------------------ *
 * Derived figures
 * ------------------------------------------------------------------ */

const activeEmployees = computed(() => session.employees.filter((employee) => employee.isActive))

/** Monthly gross exposure taken straight from the employee master. */
const monthlyGrossExposure = computed(() =>
  activeEmployees.value.reduce((sum, employee) => sum + employee.monthlyGross, 0),
)

/**
 * The employees a run for the selected period would cover: active on the
 * master, and already joined on or before the period end.
 */
const participants = computed<ParticipantRow[]>(() =>
  activeEmployees.value
    .filter((employee) => {
      const period = activePeriod.value
      if (!period) return true
      return !employee.dateOfJoining || employee.dateOfJoining <= period.to
    })
    .map((employee) => ({
      id: employee.id,
      code: employee.code,
      name: employee.name,
      department: employee.department || 'Not recorded',
      dateOfJoining: employee.dateOfJoining,
      monthlyGross: employee.monthlyGross,
    }))
    .sort((left, right) => left.code.localeCompare(right.code)),
)

const participantsGross = computed(() =>
  participants.value.reduce((sum, row) => sum + row.monthlyGross, 0),
)

/* ------------------------------------------------------------------ *
 * Readiness
 * ------------------------------------------------------------------ */

const readiness = [
  {
    title: 'Attendance and leave input',
    detail:
      'A run needs the days actually worked, leave taken and overtime for each employee. No attendance register exists in this build.',
    state: 'Not implemented',
  },
  {
    title: 'An earnings and deductions structure',
    detail:
      'Basic pay, allowances, overtime and bonus on one side; provident fund, professional tax, TDS on salary and loan recovery on the other. Only a single monthly gross figure is held per employee.',
    state: 'Not implemented',
  },
  {
    title: 'Payroll accounting entries',
    detail:
      'A run would post a salary debit, credits to the statutory payable accounts and a net amount payable to each employee. There is no payroll voucher type, so no payroll voucher can be generated in this build.',
    state: 'Not implemented',
  },
  {
    title: 'Statutory contributions and their rates',
    detail:
      'Provident fund, ESI, professional tax and TDS on salary need wage ceilings and slab rates. No statutory rate is assumed anywhere in this build.',
    state: 'Not implemented',
  },
  {
    title: 'A locked run record and payslips',
    detail:
      'A processed run would be locked against later edits and would produce the payslips on the payslip screen. No run can be processed, so no payslip can exist.',
    state: 'Not implemented',
  },
  {
    title: 'Payment of net salary',
    detail:
      'The net amount would be paid out through an ordinary payment voucher once a run exists. A payment voucher can be raised by hand today, but it is not driven by a run.',
    state: 'Available by hand',
  },
]

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

onMounted(async () => {
  if (!session.ready && !session.loading) await session.bootstrap()
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
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      title="Pay runs"
      subtitle="A pay run has not been processed in this build"
      icon="payments"
      :breadcrumb="[{ label: 'Payroll' }, { label: 'Pay runs' }]"
    >
      <template #title-meta>
        <BaseBadge tone="neutral" size="xs" icon="block">Not implemented</BaseBadge>
      </template>
    </PageHeader>

    <FilterBar>
      <BaseSelect
        v-model="selectedPeriod"
        label="Pay period"
        size="sm"
        class="w-48"
        :options="periodOptions"
        :disabled="!periodOptions.length"
      />
      <template #trailing>
        <span class="text-label-sm text-outline">
          {{ activePeriod ? `${activePeriod.from} to ${activePeriod.to}` : 'No period' }}
        </span>
      </template>
    </FilterBar>

    <div class="min-h-0 flex-1 overflow-auto p-space-lg">
      <div v-if="session.loading && !session.ready" class="space-y-space-md">
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-4">
          <BaseSkeleton v-for="index in 4" :key="index" class="h-24" />
        </div>
        <BaseSkeleton class="h-64" />
      </div>

      <template v-else>
        <div class="rounded-sm border-l-4 border-l-tertiary bg-surface-container-low p-space-md">
          <div class="flex items-start gap-space-sm">
            <MaterialIcon name="info" :size="18" class="mt-0.5 shrink-0 text-tertiary" />
            <div class="min-w-0">
              <p class="text-label-md font-bold text-on-surface">
                Pay runs are not implemented yet, and no payroll voucher can be generated in this
                build.
              </p>
              <p class="mt-0.5 text-body-sm text-on-surface-variant">
                There is no pay-run record in the repository, no payroll voucher type, and no
                button on this screen that posts salary to the books. The workspace below is
                deliberately empty: it shows what a run would cover and what it would still need,
                and nothing else.
              </p>
            </div>
          </div>
        </div>

        <div class="mt-space-md grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Monthly gross exposure (from the employee master)"
            :value="formatMoney(monthlyGrossExposure, currency)"
            icon="payments"
            tone="info"
            :hint="`${activeEmployees.length} active employees`"
          />
          <StatTile
            label="Pay runs processed"
            value="0"
            icon="history"
            tone="warning"
            hint="No run has been processed in this build"
          />
          <StatTile
            label="Employees in this period"
            :value="String(participants.length)"
            icon="groups"
            :hint="`Joined on or before ${activePeriod?.to ?? 'the period end'}`"
          />
          <StatTile
            label="Gross for this period"
            :value="formatMoney(participantsGross, currency)"
            icon="receipt_long"
            hint="Sum of the monthly gross of those employees"
          />
        </div>

        <BaseCard
          class="mt-space-md"
          title="Pay runs"
          description="Processed runs appear here once a run can be processed"
        >
          <BaseEmptyState
            :icon="EmptyIcon"
            title="No pay run has been processed"
            description="Pay runs cannot be created in this build, so there is no run, no processed amount and no net pay to show. The figures above come from the employee master only."
          />
        </BaseCard>

        <BaseCard
          class="mt-space-md"
          title="Who would be in this run"
          description="Active employees who had joined on or before the end of the selected period"
        >
          <DataTable
            :columns="columns"
            :rows="participants"
            row-key="id"
            :clickable="false"
            empty-title="No employee in this period"
            empty-description="No active employee had joined on or before the end of the selected period."
          >
            <template #cell:code="{ row }">
              <span class="num font-semibold text-on-surface">{{ row.code }}</span>
            </template>
            <template #cell:dateOfJoining="{ row }">
              <span class="num text-on-surface-variant">{{ row.dateOfJoining }}</span>
            </template>
            <template #cell:monthlyGross="{ row }">
              <span class="num text-on-surface">{{ formatMoney(row.monthlyGross, currency) }}</span>
            </template>
          </DataTable>

          <p class="mt-space-sm text-label-xs text-outline">
            This is the population a run would cover, taken from the employee master. It is not a
            run, it produces no voucher, and the monthly gross shown is the master figure before
            any attendance, earnings or deduction is applied.
          </p>
        </BaseCard>

        <BaseCard
          class="mt-space-md"
          title="Readiness checklist"
          description="What a pay run would still need before it could be processed"
        >
          <ul class="space-y-space-sm">
            <li
              v-for="item in readiness"
              :key="item.title"
              class="flex items-start gap-space-sm rounded-sm bg-surface-container-low p-space-sm"
            >
              <MaterialIcon
                :name="item.state === 'Available by hand' ? 'check_circle' : 'radio_button_unchecked'"
                :size="18"
                class="mt-0.5 shrink-0"
                :class="item.state === 'Available by hand' ? 'text-secondary' : 'text-outline'"
              />
              <div class="min-w-0">
                <p class="text-label-md font-bold text-on-surface">
                  {{ item.title }}
                  <span class="ml-1 font-normal text-label-xs text-outline">{{ item.state }}</span>
                </p>
                <p class="mt-0.5 text-body-sm text-on-surface-variant">{{ item.detail }}</p>
              </div>
            </li>
          </ul>
        </BaseCard>
      </template>
    </div>
  </div>
</template>
