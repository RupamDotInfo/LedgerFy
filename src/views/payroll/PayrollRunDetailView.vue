<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseEmptyState from '@/components/ui/BaseEmptyState.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import DataTable from '@/components/ui/DataTable.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import StatTile from '@/components/ui/StatTile.vue'
import { blockingRules } from '@/domain/payrollRules'
import type {
  PayrollPayment,
  PayrollRuleSet,
  PayrollRun,
  PayrollRunState,
  PayrollSnapshot,
  StatutoryRuleVersion,
} from '@/domain/types'
import { formatDate } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { useSessionStore } from '@/stores/session'
import { useToastStore } from '@/stores/toast'
import { calculateRun } from '@/views/payroll/payrollActions'
import PayrollPostDialog from '@/views/payroll/PayrollPostDialog.vue'
import { usePostRun } from '@/views/payroll/usePostRun'
import {
  periodBounds,
  requiredRuleSets,
  runState,
  runStateTone,
  RUN_STATE_LABEL,
  RULE_SET_LABEL,
  RULE_STATUS_LABEL,
  ruleStatusTone,
} from '@/views/payroll/payrollSupport'

const session = useSessionStore()
const toast = useToastStore()
const route = useRoute()
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

type EmployeeRow = {
  id: string
  name: string
  code: string
  grossEarnings: number
  employeeDeductions: number
  statutoryDeductions: number
  employerContributions: number
  netPay: number
}

const columns: TableColumnSpec[] = [
  { key: 'name', label: 'Employee', sortable: true },
  { key: 'code', label: 'Code' },
  { key: 'grossEarnings', label: 'Gross', align: 'right', numeric: true },
  { key: 'employeeDeductions', label: 'Employee deductions', align: 'right', numeric: true },
  { key: 'statutoryDeductions', label: 'Statutory deductions', align: 'right', numeric: true },
  { key: 'employerContributions', label: "Employer's share", align: 'right', numeric: true },
  { key: 'netPay', label: 'Net pay', align: 'right', numeric: true },
]

const EmptyIcon = () => h(MaterialIcon, { name: 'receipt_long', size: 19 })

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

const loading = ref(true)
const busy = ref(false)
const run = ref<PayrollRun | null>(null)
const snapshots = ref<PayrollSnapshot[]>([])
const payments = ref<PayrollPayment[]>([])
const rules = ref<StatutoryRuleVersion[]>([])

const postOpen = ref(false)
const paymentOpen = ref(false)
const paymentEmployeeId = ref('')
const paymentAmount = ref('')
const paymentDate = ref('')
const paymentError = ref('')

const currency = computed(() => session.activeCompany?.baseCurrency ?? 'INR')
const companyId = computed(() => session.activeCompanyId)
const runId = computed(() => String(route.params.id ?? ''))

const bounds = computed(() =>
  run.value ? periodBounds(run.value.period) : { period: '', start: '', end: '', days: 0 },
)

const state = computed<PayrollRunState>(() =>
  run.value
    ? runState(run.value, snapshots.value.length > 0, payments.value)
    : 'draft',
)

/** The rules that would block this run, and why. */
const blocked = computed(() => {
  if (!run.value) return []
  const employees = session.employees
  return blockingRules(
    rules.value,
    run.value.paymentDate,
    requiredRuleSets(employees),
  )
})

/** The rule versions this run used, with the source of each. */
const usedRules = computed(() => {
  const versions = new Map<PayrollRuleSet, { ruleSet: PayrollRuleSet; versionId: string; source: string }>()
  for (const snapshot of snapshots.value) {
    for (const version of snapshot.snapshot.ruleVersions) {
      versions.set(version.ruleSet, version)
    }
  }
  return [...versions.values()].map((version) => {
    const record = rules.value.find((rule) => rule.id === version.versionId) ?? null
    return {
      ...version,
      status: record?.status ?? 'in-force',
      effectiveFrom: record?.effectiveFrom ?? '',
      effectiveTo: record?.effectiveTo ?? null,
      summary: record?.summary ?? '',
    }
  })
})

const rows = computed<EmployeeRow[]>(() =>
  snapshots.value.map((snapshot) => {
    const employee = session.employees.find((entry) => entry.id === snapshot.employeeId)
    const calculation = snapshot.snapshot
    return {
      id: snapshot.employeeId,
      name: employee?.name ?? 'Unknown employee',
      code: employee?.code ?? '—',
      grossEarnings: calculation.grossEarnings,
      employeeDeductions: calculation.employeeDeductionTotal,
      statutoryDeductions: calculation.statutoryDeductionTotal,
      employerContributions: calculation.employerContributionTotal,
      netPay: calculation.netPay,
    }
  }),
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
    const [detail, ruleList] = await Promise.all([
      session.repository.getPayrollRun(id, runId.value),
      session.repository.listStatutoryRules(id),
    ])
    rules.value = ruleList
    if (!detail) {
      run.value = null
      snapshots.value = []
      payments.value = []
      return
    }
    run.value = detail.run
    snapshots.value = detail.snapshots
    payments.value = await session.repository.listPayrollPayments(id, detail.run.id)
  } catch (cause) {
    toast.error(
      'The payroll run could not be read',
      cause instanceof Error ? cause.message : 'The repository did not say why.',
    )
  } finally {
    loading.value = false
  }
}

/* ------------------------------------------------------------------ *
 * The actions
 * ------------------------------------------------------------------ */

async function calculate() {
  const id = companyId.value
  if (!id || !run.value) return
  busy.value = true
  try {
    const year = session.activeFinancialYear
    const calculation = await calculateRun(
      session.repository,
      id,
      run.value,
      session.employees,
      year?.start ?? `${run.value.period.slice(0, 4)}-04-01`,
      year?.end ?? `${Number(run.value.period.slice(0, 4)) + 1}-03-31`,
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
      `${calculation.run.employeeCount} employees and ${formatMoney(calculation.run.netPay, currency.value)} of net pay.`,
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

async function approve() {
  const id = companyId.value
  if (!id || !run.value) return
  busy.value = true
  try {
    await session.repository.savePayrollRun({ ...run.value, status: 'approved' })
    toast.success('Payroll approved', `${run.value.number} is approved and may now be posted.`)
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

async function openPost() {
  if (!run.value) return
  busy.value = true
  try {
    const prepared = await postRun.prepare(run.value, snapshots.value)
    if (!prepared) {
      toast.error('The run was not posted', postRun.reason.value)
      return
    }
    postOpen.value = true
  } finally {
    busy.value = false
  }
}

async function post() {
  if (!run.value) return
  busy.value = true
  try {
    const posted = await postRun.post(run.value)
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

async function cancel() {
  const id = companyId.value
  if (!id || !run.value) return
  busy.value = true
  try {
    await session.repository.savePayrollRun({ ...run.value, status: 'cancelled' })
    toast.success('Payroll cancelled', `${run.value.number} has been cancelled.`)
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

async function remove() {
  const id = companyId.value
  if (!id || !run.value) return
  busy.value = true
  try {
    await session.repository.deletePayrollRun(id, run.value.id)
    toast.success('Payroll run deleted', `${run.value.number} has been removed.`)
    await router.push('/payroll/pay-runs')
  } catch (cause) {
    toast.error(
      'The run was not deleted',
      cause instanceof Error ? cause.message : 'The repository did not say why.',
    )
  } finally {
    busy.value = false
  }
}

function openPayment() {
  paymentEmployeeId.value = snapshots.value[0]?.employeeId ?? ''
  paymentAmount.value = ''
  paymentDate.value = run.value?.paymentDate ?? ''
  paymentError.value = ''
  paymentOpen.value = true
}

async function recordPayment() {
  const id = companyId.value
  if (!id || !run.value) return
  const amount = Number(paymentAmount.value)
  if (!paymentEmployeeId.value) {
    paymentError.value = 'Choose the employee the payment was made to.'
    return
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    paymentError.value = 'Enter the amount paid as a positive number of rupees.'
    return
  }
  if (!paymentDate.value) {
    paymentError.value = 'Choose the date the payment was made on.'
    return
  }

  busy.value = true
  try {
    const payment: PayrollPayment = {
      id: `pay-${Date.now().toString(36)}`,
      companyId: id,
      runId: run.value.id,
      employeeId: paymentEmployeeId.value,
      amount: Math.round(amount * 100),
      paymentVoucherId: null,
      paidOn: paymentDate.value,
      createdAt: new Date().toISOString(),
    }
    await session.repository.savePayrollPayment(payment)
    paymentOpen.value = false
    toast.success('Payment recorded', `${formatMoney(payment.amount, currency.value)} was recorded against ${run.value.number}.`)
    await load()
  } catch (cause) {
    paymentError.value =
      cause instanceof Error ? cause.message : 'The payment was not saved and the repository did not say why.'
  } finally {
    busy.value = false
  }
}

function openBreakdown(employeeId: string) {
  void router.push(`/payroll/pay-runs/${runId.value}/employees/${employeeId}`)
}

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

onMounted(async () => {
  if (!session.ready && !session.loading) await session.bootstrap()
  await load()
})

watch(
  () => [session.activeCompanyId, runId.value],
  () => {
    void load()
  },
)
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      :title="run?.number ?? 'Payroll run'"
      :subtitle="run ? `${bounds.start} — paid on ${formatDate(run.paymentDate)}` : 'The payroll run'"
      icon="receipt_long"
      :breadcrumb="[
        { label: 'Payroll' },
        { label: 'Pay runs', to: '/payroll/pay-runs' },
        { label: run?.number ?? 'Run' },
      ]"
    >
      <template #title-meta>
        <BaseBadge v-if="run" :tone="runStateTone(state)" size="xs">
          {{ RUN_STATE_LABEL[state] }}
        </BaseBadge>
      </template>
      <template #actions>
        <BaseButton
          v-if="state === 'draft'"
          size="sm"
          variant="primary"
          icon="calculate"
          :disabled="busy"
          @click="calculate"
        >
          Calculate
        </BaseButton>
        <BaseButton
          v-if="state === 'calculated'"
          size="sm"
          variant="primary"
          icon="task_alt"
          :disabled="busy"
          @click="approve"
        >
          Approve
        </BaseButton>
        <BaseButton
          v-if="state === 'approved'"
          size="sm"
          variant="primary"
          icon="send"
          :disabled="busy"
          @click="openPost"
        >
          Post
        </BaseButton>
        <BaseButton
          v-if="['draft', 'calculated', 'approved'].includes(state)"
          size="sm"
          variant="outlined"
          icon="block"
          :disabled="busy"
          @click="cancel"
        >
          Cancel
        </BaseButton>
        <BaseButton
          v-if="state === 'posted' || state === 'paid'"
          size="sm"
          variant="tonal"
          icon="payments"
          :disabled="busy"
          @click="openPayment"
        >
          Record payment
        </BaseButton>
        <BaseButton
          v-if="state === 'draft' && !snapshots.length"
          size="sm"
          variant="text"
          icon="delete"
          :disabled="busy"
          @click="remove"
        >
          Delete
        </BaseButton>
      </template>
    </PageHeader>

    <div class="min-h-0 flex-1 overflow-auto p-space-lg">
      <div v-if="loading" class="space-y-space-md">
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-3 lg:grid-cols-6">
          <BaseSkeleton v-for="index in 6" :key="index" class="h-24" />
        </div>
        <BaseSkeleton class="h-72" />
      </div>

      <template v-else-if="!run">
        <BaseEmptyState
          :icon="EmptyIcon"
          title="This payroll run is not here"
          description="It may have been deleted, or it belongs to another company."
        >
          <BaseButton size="sm" variant="outlined" icon="arrow_back" @click="router.push('/payroll/pay-runs')">
            Back to the register
          </BaseButton>
        </BaseEmptyState>
      </template>

      <template v-else>
        <div
          v-if="blocked.length"
          class="rounded-sm border-l-4 border-l-error bg-error-container p-space-md"
        >
          <div class="flex items-start gap-space-sm">
            <MaterialIcon name="gpp_bad" :size="18" class="mt-0.5 shrink-0 text-on-error-container" />
            <div class="min-w-0">
              <p class="text-label-md font-bold text-on-error-container">
                This run is blocked by a rule that is not in force
              </p>
              <ul class="mt-1 space-y-1">
                <li
                  v-for="entry in blocked"
                  :key="entry.ruleSet"
                  class="text-body-sm text-on-error-container"
                >
                  <span class="font-semibold">{{ RULE_SET_LABEL[entry.ruleSet] ?? entry.ruleSet }}</span>
                  — {{ entry.reason }}
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div class="mt-space-md grid grid-cols-1 gap-space-md sm:grid-cols-3 lg:grid-cols-6">
          <StatTile label="Employees" :value="String(run.employeeCount)" icon="groups" />
          <StatTile label="Gross" :value="formatMoney(run.grossEarnings, currency)" icon="trending_up" />
          <StatTile
            label="Employee deductions"
            :value="formatMoney(run.employeeDeductions, currency)"
            icon="remove_circle_outline"
          />
          <StatTile
            label="Statutory deductions"
            :value="formatMoney(run.statutoryDeductions, currency)"
            icon="account_balance"
          />
          <StatTile
            label="Employer's share"
            :value="formatMoney(run.employerContributions, currency)"
            icon="handshake"
          />
          <StatTile
            label="Net payable"
            :value="formatMoney(run.netPay, currency)"
            icon="account_balance_wallet"
            tone="info"
          />
        </div>

        <div class="mt-space-md grid grid-cols-1 gap-space-md lg:grid-cols-2">
          <BaseCard
            title="The rules this run used"
            description="Every rule that was applied, with the source it comes from"
          >
            <div v-if="!usedRules.length" class="text-body-sm text-on-surface-variant">
              The run has not been calculated yet, so no rule has been applied.
            </div>
            <ul v-else class="space-y-space-sm">
              <li
                v-for="version in usedRules"
                :key="version.ruleSet"
                class="rounded-sm bg-surface-container-low p-space-sm"
              >
                <div class="flex items-center justify-between gap-2">
                  <p class="text-label-md font-bold text-on-surface">
                    {{ RULE_SET_LABEL[version.ruleSet] ?? version.ruleSet }}
                  </p>
                  <BaseBadge :tone="ruleStatusTone(version.status)" size="xs">
                    {{ RULE_STATUS_LABEL[version.status] ?? version.status }}
                  </BaseBadge>
                </div>
                <p class="mt-0.5 text-label-xs text-outline">
                  In force from {{ formatDate(version.effectiveFrom) }}
                  <template v-if="version.effectiveTo">
                    to {{ formatDate(version.effectiveTo) }}
                  </template>
                </p>
                <p v-if="version.summary" class="mt-1 text-body-sm text-on-surface-variant">
                  {{ version.summary }}
                </p>
                <p class="mt-1 text-label-xs text-outline">{{ version.source }}</p>
              </li>
            </ul>
          </BaseCard>

          <BaseCard
            title="Payments"
            description="What has been paid against this run"
          >
            <div v-if="!payments.length" class="text-body-sm text-on-surface-variant">
              Nothing has been paid against this run yet.
            </div>
            <ul v-else class="space-y-space-sm">
              <li
                v-for="payment in payments"
                :key="payment.id"
                class="flex items-center justify-between gap-2 rounded-sm bg-surface-container-low p-space-sm"
              >
                <div class="min-w-0">
                  <p class="text-body-md text-on-surface">
                    {{
                      session.employees.find((employee) => employee.id === payment.employeeId)?.name ??
                      'Unknown employee'
                    }}
                  </p>
                  <p class="text-label-xs text-outline">{{ formatDate(payment.paidOn) }}</p>
                </div>
                <span class="num text-body-md text-on-surface">
                  {{ formatMoney(payment.amount, currency) }}
                </span>
              </li>
            </ul>
          </BaseCard>
        </div>

        <BaseCard
          class="mt-space-md"
          title="The employees in this run"
          description="Each employee's pay, as it was calculated"
          padded
        >
          <DataTable
            :columns="columns"
            :rows="rows"
            row-key="id"
            empty-title="No employee in this run"
            empty-description="Calculate the run and the employees it covers will be listed here."
          >
            <template #cell:name="{ row }">
              <button
                type="button"
                class="text-on-surface hover:text-primary hover:underline"
                @click="openBreakdown(row.id)"
              >
                {{ row.name }}
              </button>
            </template>
            <template #cell:code="{ row }">
              <span class="num text-on-surface-variant">{{ row.code }}</span>
            </template>
            <template #cell:grossEarnings="{ row }">
              <span class="num text-on-surface">{{ formatMoney(row.grossEarnings, currency) }}</span>
            </template>
            <template #cell:employeeDeductions="{ row }">
              <span class="num text-on-surface">{{ formatMoney(row.employeeDeductions, currency) }}</span>
            </template>
            <template #cell:statutoryDeductions="{ row }">
              <span class="num text-on-surface">{{ formatMoney(row.statutoryDeductions, currency) }}</span>
            </template>
            <template #cell:employerContributions="{ row }">
              <span class="num text-on-surface">{{ formatMoney(row.employerContributions, currency) }}</span>
            </template>
            <template #cell:netPay="{ row }">
              <span class="num font-semibold text-on-surface">{{ formatMoney(row.netPay, currency) }}</span>
            </template>
          </DataTable>
        </BaseCard>
      </template>
    </div>

    <PayrollPostDialog
      :open="postOpen"
      :journal="postRun.journal.value"
      :reason="postRun.reason.value"
      :posting="postRun.posting.value"
      @close="postOpen = false"
      @post="post"
    />

    <BaseModal
      :open="paymentOpen"
      title="Record a payment"
      description="A payment of salary made against this run"
      size="md"
      @close="paymentOpen = false"
    >
      <div class="space-y-space-md">
        <BaseSelect
          v-model="paymentEmployeeId"
          label="Employee"
          required
          :options="
            snapshots.map((snapshot) => ({
              value: snapshot.employeeId,
              label:
                session.employees.find((employee) => employee.id === snapshot.employeeId)?.name ??
                'Unknown employee',
            }))
          "
        />
        <BaseInput
          v-model="paymentAmount"
          label="Amount paid"
          type="number"
          align="right"
          required
          placeholder="25000"
          hint="Amount in rupees"
        />
        <BaseInput v-model="paymentDate" label="Paid on" type="date" required />
        <div v-if="paymentError" class="rounded-sm bg-error-container p-space-sm">
          <p class="text-label-sm text-on-error-container">{{ paymentError }}</p>
        </div>
      </div>

      <template #footer>
        <BaseButton variant="text" @click="paymentOpen = false">Cancel</BaseButton>
        <BaseButton variant="primary" icon="save" :loading="busy" @click="recordPayment">
          Record the payment
        </BaseButton>
      </template>
    </BaseModal>
  </div>
</template>
