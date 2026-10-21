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
import StatTile from '@/components/ui/StatTile.vue'
import { wageBase } from '@/domain/payrollRules'
import type {
  Employee,
  PayrollRun,
  PayrollSnapshot,
  SalaryComponent,
  WageBasis,
} from '@/domain/types'
import { formatPeriod } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { useSessionStore } from '@/stores/session'
import { useToastStore } from '@/stores/toast'

const session = useSessionStore()
const toast = useToastStore()
const route = useRoute()
const router = useRouter()

const EmptyIcon = () => h(MaterialIcon, { name: 'person_search', size: 19 })

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

const loading = ref(true)
const run = ref<PayrollRun | null>(null)
const snapshot = ref<PayrollSnapshot | null>(null)
const components = ref<SalaryComponent[]>([])

const currency = computed(() => session.activeCompany?.baseCurrency ?? 'INR')
const companyId = computed(() => session.activeCompanyId)
const runId = computed(() => String(route.params.id ?? ''))
const employeeId = computed(() => String(route.params.employeeId ?? ''))

const employee = computed<Employee | null>(
  () => session.employees.find((entry) => entry.id === employeeId.value) ?? null,
)

const calculation = computed(() => snapshot.value?.snapshot ?? null)

/** The bases a component of the structure counts towards, by its code. */
const basesByCode = computed(() => {
  const map = new Map<string, WageBasis[]>()
  for (const component of components.value) map.set(component.code, component.bases)
  return map
})

/** Every component, with what it was computed to and what it was rounded to. */
const componentRows = computed(() => {
  const entries = calculation.value?.components ?? []
  return entries.map((entry) => ({
    code: entry.code,
    name: entry.name,
    kind: entry.kind,
    amount: entry.amount,
    exactAmount: entry.exactAmount,
    bases: basesByCode.value.get(entry.code) ?? [],
    rounding: entry.amount - entry.exactAmount,
  }))
})

/** The wage base of each basis the rules use. */
const wageBases = computed(() => {
  const entries = calculation.value?.components ?? []
  const amounts = entries.map((entry) => ({
    bases: basesByCode.value.get(entry.code) ?? [],
    amount: entry.amount,
  }))
  const bases: WageBasis[] = [
    'gross-earnings',
    'epf-wages',
    'esic-wages',
    'professional-tax-wages',
    'salary-tds-wages',
  ]
  return bases.map((basis) => ({ basis, amount: wageBase(amounts, basis) }))
})

const BASIS_LABEL: Record<WageBasis, string> = {
  'gross-earnings': 'Gross earnings',
  'epf-wages': 'Provident fund wages',
  'esic-wages': 'State insurance wages',
  'professional-tax-wages': 'Professional tax wages',
  'salary-tds-wages': 'Tax deducted at source wages',
}

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
    const found = detail.snapshots.find((entry) => entry.employeeId === employeeId.value) ?? null
    snapshot.value = found
    if (found) {
      const structure = await session.repository.getSalaryStructure(
        id,
        found.snapshot.structureId,
      )
      components.value = structure?.components ?? []
    } else {
      components.value = []
    }
  } catch (cause) {
    toast.error(
      'The breakdown could not be read',
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
      :title="employee ? employee.name : 'Employee breakdown'"
      :subtitle="
        employee
          ? `${employee.code} — ${run?.number ?? ''} — ${calculation ? formatPeriod(calculation.period) : ''}`
          : 'How the pay of one employee was worked out'
      "
      icon="calculate"
      :breadcrumb="[
        { label: 'Payroll' },
        { label: 'Pay runs', to: '/payroll/pay-runs' },
        { label: run?.number ?? 'Run', to: `/payroll/pay-runs/${runId}` },
        { label: employee?.code ?? 'Employee' },
      ]"
    >
      <template #actions>
        <BaseButton
          size="sm"
          variant="outlined"
          icon="arrow_back"
          @click="router.push(`/payroll/pay-runs/${runId}`)"
        >
          Back to the run
        </BaseButton>
        <BaseButton
          v-if="run && calculation"
          size="sm"
          variant="text"
          icon="receipt"
          @click="router.push(`/payroll/payslips/${runId}/${employeeId}`)"
        >
          Payslip
        </BaseButton>
      </template>
    </PageHeader>

    <div class="min-h-0 flex-1 overflow-auto p-space-lg">
      <div v-if="loading" class="space-y-space-md">
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-4">
          <BaseSkeleton v-for="index in 4" :key="index" class="h-24" />
        </div>
        <BaseSkeleton class="h-72" />
      </div>

      <template v-else-if="!calculation">
        <BaseEmptyState
          :icon="EmptyIcon"
          title="This breakdown is not here"
          description="The employee is not part of this run, or the run has not been calculated."
        >
          <BaseButton
            size="sm"
            variant="outlined"
            icon="arrow_back"
            @click="router.push(`/payroll/pay-runs/${runId}`)"
          >
            Back to the run
          </BaseButton>
        </BaseEmptyState>
      </template>

      <template v-else>
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Gross earnings"
            :value="formatMoney(calculation.grossEarnings, currency)"
            icon="trending_up"
          />
          <StatTile
            label="Employee deductions"
            :value="formatMoney(calculation.employeeDeductionTotal, currency)"
            icon="remove_circle_outline"
          />
          <StatTile
            label="Statutory deductions"
            :value="formatMoney(calculation.statutoryDeductionTotal, currency)"
            icon="account_balance"
          />
          <StatTile
            label="Net pay"
            :value="formatMoney(calculation.netPay, currency)"
            icon="account_balance_wallet"
            tone="info"
          />
        </div>

        <BaseCard
          class="mt-space-md"
          title="The earnings"
          description="Every component, what it was computed to and what it was rounded to"
          padded
        >
          <div class="overflow-hidden rounded-sm border border-surface-container">
            <table class="w-full border-collapse text-body-sm">
              <thead class="bg-surface-container-low text-outline">
                <tr>
                  <th
                    scope="col"
                    class="px-space-md py-2 text-left text-label-xs uppercase tracking-wider"
                  >
                    Component
                  </th>
                  <th
                    scope="col"
                    class="px-space-md py-2 text-left text-label-xs uppercase tracking-wider"
                  >
                    Kind
                  </th>
                  <th
                    scope="col"
                    class="px-space-md py-2 text-right text-label-xs uppercase tracking-wider tabular"
                  >
                    Computed
                  </th>
                  <th
                    scope="col"
                    class="px-space-md py-2 text-right text-label-xs uppercase tracking-wider tabular"
                  >
                    Rounded
                  </th>
                  <th
                    scope="col"
                    class="px-space-md py-2 text-right text-label-xs uppercase tracking-wider tabular"
                  >
                    Difference
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-surface-container-low">
                <tr v-for="row in componentRows" :key="row.code">
                  <td class="px-space-md py-1.5">
                    <p class="text-on-surface">{{ row.name }}</p>
                    <p class="text-label-xs text-outline">{{ row.code }}</p>
                  </td>
                  <td class="px-space-md py-1.5 text-on-surface-variant">
                    {{ row.kind }}
                  </td>
                  <td class="px-space-md py-1.5 text-right text-on-surface tabular">
                    {{ formatMoney(row.exactAmount, currency, { decimals: 4 }) }}
                  </td>
                  <td class="px-space-md py-1.5 text-right font-semibold text-on-surface tabular">
                    {{ formatMoney(row.amount, currency) }}
                  </td>
                  <td class="px-space-md py-1.5 text-right text-on-surface-variant tabular">
                    {{ row.rounding === 0 ? '—' : formatMoney(row.rounding, currency, { decimals: 4 }) }}
                  </td>
                </tr>
                <tr class="bg-surface-container-low">
                  <td class="px-space-md py-1.5 text-label-md font-bold text-on-surface" colspan="2">
                    Gross earnings
                  </td>
                  <td class="px-space-md py-1.5 text-right text-on-surface tabular">
                    {{ formatMoney(calculation.grossEarnings, currency, { decimals: 4 }) }}
                  </td>
                  <td class="px-space-md py-1.5 text-right font-bold text-on-surface tabular">
                    {{ formatMoney(calculation.grossEarnings, currency) }}
                  </td>
                  <td class="px-space-md py-1.5" />
                </tr>
              </tbody>
            </table>
          </div>
        </BaseCard>

        <div class="mt-space-md grid grid-cols-1 gap-space-md lg:grid-cols-2">
          <BaseCard
            title="The wage bases"
            description="What each statutory rule was computed on"
            padded
          >
            <div class="overflow-hidden rounded-sm border border-surface-container">
              <table class="w-full border-collapse text-body-sm">
                <thead class="bg-surface-container-low text-outline">
                  <tr>
                    <th
                      scope="col"
                      class="px-space-md py-2 text-left text-label-xs uppercase tracking-wider"
                    >
                      Basis
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
                  <tr v-for="entry in wageBases" :key="entry.basis">
                    <td class="px-space-md py-1.5 text-on-surface">
                      {{ BASIS_LABEL[entry.basis] }}
                    </td>
                    <td class="px-space-md py-1.5 text-right text-on-surface tabular">
                      {{ formatMoney(entry.amount, currency) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </BaseCard>

          <BaseCard title="The deductions" description="What was taken from the employee's pay">
            <div v-if="!calculation.employeeDeductions.length && !calculation.statutoryDeductions.length">
              <p class="text-body-sm text-on-surface-variant">
                Nothing was deducted from this employee's pay.
              </p>
            </div>
            <ul v-else class="space-y-space-sm">
              <li
                v-for="entry in [...calculation.employeeDeductions, ...calculation.statutoryDeductions]"
                :key="`${entry.code}-${entry.name}`"
                class="flex items-center justify-between gap-2 rounded-sm bg-surface-container-low p-space-sm"
              >
                <div class="min-w-0">
                  <p class="text-body-md text-on-surface">{{ entry.name }}</p>
                  <p class="text-label-xs text-outline">{{ entry.code }}</p>
                </div>
                <span class="num text-body-md text-on-surface">
                  {{ formatMoney(entry.amount, currency) }}
                </span>
              </li>
            </ul>
          </BaseCard>
        </div>

        <BaseCard
          class="mt-space-md"
          title="The employer's contributions"
          description="What the employer owes on this employee's behalf"
        >
          <div v-if="!calculation.employerContributions.length">
            <p class="text-body-sm text-on-surface-variant">
              The employer owes nothing on this employee's behalf.
            </p>
          </div>
          <ul v-else class="space-y-space-sm">
            <li
              v-for="entry in calculation.employerContributions"
              :key="`${entry.code}-${entry.name}`"
              class="flex items-center justify-between gap-2 rounded-sm bg-surface-container-low p-space-sm"
            >
              <div class="min-w-0">
                <p class="text-body-md text-on-surface">{{ entry.name }}</p>
                <p class="text-label-xs text-outline">{{ entry.code }}</p>
              </div>
              <span class="num text-body-md text-on-surface">
                {{ formatMoney(entry.amount, currency) }}
              </span>
            </li>
          </ul>
        </BaseCard>

        <div class="mt-space-md rounded-md bg-inverse-surface p-space-md text-inverse-on-surface">
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p class="section-label">Net pay</p>
              <p class="text-headline-lg num">{{ formatMoney(calculation.netPay, currency) }}</p>
            </div>
            <div>
              <p class="section-label">The liability this employee creates</p>
              <p class="text-headline-md num">
                {{ formatMoney(calculation.liability, currency) }}
              </p>
            </div>
            <BaseBadge tone="positive" size="sm" icon="check_circle">
              Worked out by the payroll engine
            </BaseBadge>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
