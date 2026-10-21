<script setup lang="ts">
import { computed, h, onMounted } from 'vue'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseEmptyState from '@/components/ui/BaseEmptyState.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import StatTile from '@/components/ui/StatTile.vue'
import { useSessionStore } from '@/stores/session'
import { formatMoney } from '@/lib/money'

const session = useSessionStore()

const EmptyIcon = () => h(MaterialIcon, { name: 'receipt_long', size: 19 })

const company = computed(() => session.activeCompany)
const currency = computed(() => company.value?.baseCurrency ?? 'INR')

const employees = computed(() => session.employees)
const activeEmployees = computed(() => employees.value.filter((employee) => employee.isActive))

/** Monthly gross exposure taken straight from the employee master. */
const monthlyGrossExposure = computed(() =>
  activeEmployees.value.reduce((sum, employee) => sum + employee.monthlyGross, 0),
)

/** What a payslip would carry once a run exists. */
const payslipContents = [
  { label: 'Earnings', detail: 'Basic pay, allowances, overtime and bonus for the period' },
  { label: 'Deductions', detail: 'Provident fund, professional tax, TDS on salary and recoveries' },
  { label: 'Employer contributions', detail: 'The employer share of each statutory contribution' },
  { label: 'Net pay', detail: 'The amount payable to the employee for the period' },
  { label: 'Period and run reference', detail: 'The pay period and the run that produced it' },
]

onMounted(async () => {
  if (!session.ready && !session.loading) await session.bootstrap()
})
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      title="Payslips"
      subtitle="Payslips become available once a pay run is processed"
      icon="receipt_long"
      :breadcrumb="[{ label: 'Payroll' }, { label: 'Payslips' }]"
    >
      <template #title-meta>
        <BaseBadge tone="neutral" size="xs" icon="block">No runs processed</BaseBadge>
      </template>
    </PageHeader>

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
                No pay run has been processed in this build, so no payslip exists.
              </p>
              <p class="mt-0.5 text-body-sm text-on-surface-variant">
                A payslip is produced by a processed pay run. Pay runs cannot be processed in this
                build, so no payslip row, net pay figure or statutory deduction is shown here —
                none of it would be real.
              </p>
            </div>
          </div>
        </div>

        <div class="mt-space-md grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Employees on the master"
            :value="String(employees.length)"
            icon="groups"
            :hint="`${activeEmployees.length} active`"
          />
          <StatTile
            label="Monthly gross exposure (from the employee master)"
            :value="formatMoney(monthlyGrossExposure, currency)"
            icon="payments"
            tone="info"
            hint="Sum of the monthly gross on the master"
          />
          <StatTile
            label="Pay runs processed"
            value="0"
            icon="history"
            tone="warning"
            hint="No run has been processed in this build"
          />
          <StatTile
            label="Payslips issued"
            value="0"
            icon="receipt_long"
            hint="Payslips follow a processed run"
          />
        </div>

        <div class="mt-space-md grid grid-cols-1 items-start gap-space-md lg:grid-cols-3">
          <BaseCard class="lg:col-span-2" title="Payslips" description="Issued payslips appear here">
            <BaseEmptyState
              :icon="EmptyIcon"
              title="No payslip to show"
              description="No pay run has been processed, and pay runs cannot be processed in this build. Payslips become available here once a run is processed and locked."
            />
          </BaseCard>

          <BaseCard title="What a payslip would carry" description="Set by the pay run, not here">
            <ul class="space-y-space-sm">
              <li
                v-for="item in payslipContents"
                :key="item.label"
                class="rounded-sm bg-surface-container-low p-space-sm"
              >
                <p class="text-label-md font-semibold text-on-surface">{{ item.label }}</p>
                <p class="mt-0.5 text-label-sm text-on-surface-variant">{{ item.detail }}</p>
              </li>
            </ul>
            <p class="mt-space-sm text-label-xs text-outline">
              None of these figures exists yet, so none is shown.
            </p>
          </BaseCard>
        </div>
      </template>
    </div>
  </div>
</template>
