<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseEmptyState from '@/components/ui/BaseEmptyState.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import { maskIdentifier } from '@/domain/payroll'
import type { PayrollRun, PayrollSnapshot } from '@/domain/types'
import { formatDate, formatPeriod } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { useSessionStore } from '@/stores/session'
import { useToastStore } from '@/stores/toast'

const session = useSessionStore()
const toast = useToastStore()
const route = useRoute()
const router = useRouter()

const EmptyIcon = () => h(MaterialIcon, { name: 'receipt', size: 19 })

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

const loading = ref(true)
const run = ref<PayrollRun | null>(null)
const snapshot = ref<PayrollSnapshot | null>(null)

const currency = computed(() => session.activeCompany?.baseCurrency ?? 'INR')
const companyId = computed(() => session.activeCompanyId)
const runId = computed(() => String(route.params.runId ?? ''))
const employeeId = computed(() => String(route.params.employeeId ?? ''))

const employee = computed(
  () => session.employees.find((entry) => entry.id === employeeId.value) ?? null,
)

const calculation = computed(() => snapshot.value?.snapshot ?? null)

const earnings = computed(() =>
  (calculation.value?.components ?? []).filter(
    (entry) => entry.kind === 'earning' || entry.kind === 'reimbursement',
  ),
)

/* ------------------------------------------------------------------ *
 * Loading
 * ------------------------------------------------------------------ */

async function load() {
  const id = companyId.value
  if (!id || !runId.value) {
    loading.value = false
    return
  }
  loading.value = true
  try {
    const detail = await session.repository.getPayrollRun(id, runId.value)
    if (!detail) {
      run.value = null
      snapshot.value = null
      return
    }
    run.value = detail.run
    snapshot.value =
      detail.snapshots.find((entry) => entry.employeeId === employeeId.value) ?? null
  } catch (cause) {
    toast.error(
      'The payslip could not be read',
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
  () => [session.activeCompanyId, runId.value, employeeId.value],
  () => {
    void load()
  },
)
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      :title="employee ? `Payslip — ${employee.name}` : 'Payslip'"
      :subtitle="run ? `${run.number} — ${formatPeriod(run.periodStart)}` : 'The payslip'"
      icon="receipt"
      :breadcrumb="[
        { label: 'Payroll' },
        { label: 'Payslips', to: '/payroll/payslips' },
        { label: employee?.code ?? 'Payslip' },
      ]"
    >
      <template #actions>
        <BaseButton
          size="sm"
          variant="outlined"
          icon="arrow_back"
          @click="router.push('/payroll/payslips')"
        >
          Back to the payslips
        </BaseButton>
        <BaseButton
          v-if="run && employee"
          size="sm"
          variant="text"
          icon="calculate"
          @click="router.push(`/payroll/pay-runs/${runId}/employees/${employeeId}`)"
        >
          Breakdown
        </BaseButton>
      </template>
    </PageHeader>

    <div class="min-h-0 flex-1 overflow-auto p-space-lg">
      <div v-if="loading" class="space-y-space-md">
        <BaseSkeleton class="h-72" />
      </div>

      <template v-else-if="!calculation || !run">
        <BaseEmptyState
          :icon="EmptyIcon"
          title="This payslip is not here"
          description="The employee is not part of this run, or the run has not been calculated."
        >
          <BaseButton size="sm" variant="outlined" icon="arrow_back" @click="router.push('/payroll/payslips')">
            Back to the payslips
          </BaseButton>
        </BaseEmptyState>
      </template>

      <template v-else>
        <div class="mx-auto max-w-3xl space-y-space-md">
          <div class="rounded-md bg-surface-container-lowest p-space-lg shadow-sm">
            <div class="flex flex-wrap items-start justify-between gap-4 border-b border-surface-container pb-space-md">
              <div class="min-w-0">
                <p class="text-headline-sm text-on-surface">
                  {{ session.activeCompany?.name ?? 'The company' }}
                </p>
                <p class="text-label-sm text-on-surface-variant">
                  {{ session.activeCompany?.address ?? '' }}
                </p>
              </div>
              <div class="text-right">
                <p class="text-label-xs uppercase tracking-wider text-outline">Payslip</p>
                <p class="num text-body-md text-on-surface">{{ run.number }}</p>
                <p class="text-label-sm text-on-surface-variant">
                  {{ formatPeriod(run.periodStart) }} · paid {{ formatDate(run.paymentDate) }}
                </p>
              </div>
            </div>

            <div class="grid grid-cols-1 gap-space-md py-space-md sm:grid-cols-2">
              <div>
                <p class="section-label mb-1">Employee</p>
                <p class="text-body-md text-on-surface">{{ employee?.name ?? '—' }}</p>
                <p class="text-label-sm text-on-surface-variant">
                  {{ employee?.code ?? '' }}
                  <template v-if="employee?.designation"> · {{ employee.designation }}</template>
                </p>
                <p v-if="employee?.department" class="text-label-sm text-on-surface-variant">
                  {{ employee.department }}
                </p>
              </div>
              <div class="sm:text-right">
                <p class="section-label mb-1">Identifiers</p>
                <p class="text-label-sm text-on-surface-variant">
                  Tax number {{ maskIdentifier(employee?.pan) || 'not recorded' }}
                </p>
                <p class="text-label-sm text-on-surface-variant">
                  Account {{ maskIdentifier(employee?.bankAccountNumber) || 'not recorded' }}
                </p>
                <p class="text-label-sm text-on-surface-variant">
                  Joined {{ employee ? formatDate(employee.dateOfJoining) : '—' }}
                </p>
              </div>
            </div>

            <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2">
              <div class="overflow-hidden rounded-sm border border-surface-container">
                <table class="w-full border-collapse text-body-sm">
                  <thead class="bg-surface-container-low text-outline">
                    <tr>
                      <th
                        scope="col"
                        class="px-space-md py-2 text-left text-label-xs uppercase tracking-wider"
                      >
                        Earnings
                      </th>
                      <th
                        scope="col"
                        class="px-space-md py-2 text-right text-label-xs uppercase tracking-wider tabular"
                      >
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-surface-container-low">
                    <tr v-for="entry in earnings" :key="entry.code">
                      <td class="px-space-md py-1.5 text-on-surface">{{ entry.name }}</td>
                      <td class="px-space-md py-1.5 text-right text-on-surface tabular">
                        {{ formatMoney(entry.amount, currency) }}
                      </td>
                    </tr>
                    <tr class="bg-surface-container-low">
                      <td class="px-space-md py-1.5 text-label-md font-bold text-on-surface">
                        Gross earnings
                      </td>
                      <td class="px-space-md py-1.5 text-right font-bold text-on-surface tabular">
                        {{ formatMoney(calculation.grossEarnings, currency) }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div class="overflow-hidden rounded-sm border border-surface-container">
                <table class="w-full border-collapse text-body-sm">
                  <thead class="bg-surface-container-low text-outline">
                    <tr>
                      <th
                        scope="col"
                        class="px-space-md py-2 text-left text-label-xs uppercase tracking-wider"
                      >
                        Deductions
                      </th>
                      <th
                        scope="col"
                        class="px-space-md py-2 text-right text-label-xs uppercase tracking-wider tabular"
                      >
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-surface-container-low">
                    <tr
                      v-for="entry in [
                        ...calculation.employeeDeductions,
                        ...calculation.statutoryDeductions,
                      ]"
                      :key="`${entry.code}-${entry.name}`"
                    >
                      <td class="px-space-md py-1.5 text-on-surface">{{ entry.name }}</td>
                      <td class="px-space-md py-1.5 text-right text-on-surface tabular">
                        {{ formatMoney(entry.amount, currency) }}
                      </td>
                    </tr>
                    <tr v-if="!calculation.employeeDeductions.length && !calculation.statutoryDeductions.length">
                      <td class="px-space-md py-1.5 text-on-surface-variant" colspan="2">
                        Nothing was deducted.
                      </td>
                    </tr>
                    <tr class="bg-surface-container-low">
                      <td class="px-space-md py-1.5 text-label-md font-bold text-on-surface">
                        Total deductions
                      </td>
                      <td class="px-space-md py-1.5 text-right font-bold text-on-surface tabular">
                        {{
                          formatMoney(
                            calculation.employeeDeductionTotal + calculation.statutoryDeductionTotal,
                            currency,
                          )
                        }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div class="mt-space-md overflow-hidden rounded-sm border border-surface-container">
              <table class="w-full border-collapse text-body-sm">
                <thead class="bg-surface-container-low text-outline">
                  <tr>
                    <th
                      scope="col"
                      class="px-space-md py-2 text-left text-label-xs uppercase tracking-wider"
                    >
                      The employer's contributions
                    </th>
                    <th
                      scope="col"
                      class="px-space-md py-2 text-right text-label-xs uppercase tracking-wider tabular"
                    >
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-surface-container-low">
                  <tr v-for="entry in calculation.employerContributions" :key="entry.code">
                    <td class="px-space-md py-1.5 text-on-surface">{{ entry.name }}</td>
                    <td class="px-space-md py-1.5 text-right text-on-surface tabular">
                      {{ formatMoney(entry.amount, currency) }}
                    </td>
                  </tr>
                  <tr v-if="!calculation.employerContributions.length">
                    <td class="px-space-md py-1.5 text-on-surface-variant" colspan="2">
                      The employer owes nothing on this employee's behalf.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="mt-space-md flex flex-wrap items-center justify-between gap-4 rounded-sm bg-inverse-surface p-space-md text-inverse-on-surface">
              <div>
                <p class="section-label">Net pay</p>
                <p class="text-headline-lg num">{{ formatMoney(calculation.netPay, currency) }}</p>
              </div>
              <div class="text-right">
                <p class="section-label">The liability this employee creates</p>
                <p class="text-headline-md num">
                  {{ formatMoney(calculation.liability, currency) }}
                </p>
              </div>
            </div>
          </div>

          <BaseCard
            title="The rules this payslip was worked out with"
            description="The payslip is rendered from the stored snapshot and is never recomputed"
          >
            <ul class="space-y-space-sm">
              <li
                v-for="version in calculation.ruleVersions"
                :key="version.ruleSet"
                class="rounded-sm bg-surface-container-low p-space-sm"
              >
                <div class="flex items-center justify-between gap-2">
                  <p class="text-label-md font-bold text-on-surface">
                    {{ version.ruleSet }}
                  </p>
                  <BaseBadge tone="info" size="xs" icon="gavel">Applied</BaseBadge>
                </div>
                <p class="mt-0.5 text-label-xs text-outline">{{ version.source }}</p>
              </li>
              <li v-if="!calculation.ruleVersions.length" class="text-body-sm text-on-surface-variant">
                No rule was recorded against this snapshot.
              </li>
            </ul>
          </BaseCard>
        </div>
      </template>
    </div>
  </div>
</template>
