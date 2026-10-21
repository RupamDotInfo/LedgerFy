<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseEmptyState from '@/components/ui/BaseEmptyState.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import BaseTabs from '@/components/ui/BaseTabs.vue'
import DataTable from '@/components/ui/DataTable.vue'
import FilterBar from '@/components/ui/FilterBar.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import StatTile from '@/components/ui/StatTile.vue'
import type {
  PayrollAccounts,
  PayrollAttendance,
  SalaryStructure,
  StatutoryRuleVersion,
} from '@/domain/types'
import { formatDate } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { useSessionStore } from '@/stores/session'
import { useToastStore } from '@/stores/toast'
import {
  periodBounds,
  periodOptions,
  RULE_SET_LABEL,
  RULE_STATUS_LABEL,
  ruleStatusTone,
} from '@/views/payroll/payrollSupport'

const session = useSessionStore()
const toast = useToastStore()

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

const attendanceColumns: TableColumnSpec[] = [
  { key: 'name', label: 'Employee', sortable: true },
  { key: 'code', label: 'Code' },
  { key: 'payableDays', label: 'Payable days', align: 'right', numeric: true },
  { key: 'lopDays', label: 'Loss of pay', align: 'right', numeric: true },
  { key: 'extraDays', label: 'Extra days', align: 'right', numeric: true },
  { key: 'otherDeductions', label: 'Other deductions', align: 'right', numeric: true },
  { key: 'actions', label: '', width: '96px' },
]

const EmptyIcon = () => h(MaterialIcon, { name: 'settings', size: 19 })

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

const tab = ref('accounts')
const loading = ref(true)
const busy = ref(false)

const accounts = ref<PayrollAccounts | null>(null)
const structures = ref<SalaryStructure[]>([])
const attendance = ref<PayrollAttendance[]>([])
const rules = ref<StatutoryRuleVersion[]>([])

const period = ref('')
const attendanceForm = ref<PayrollAttendance | null>(null)
const attendanceOpen = ref(false)
const attendanceError = ref('')

const accountsOpen = ref(false)
const accountsForm = ref<Record<string, string>>({})
const accountsError = ref('')

const currency = computed(() => session.activeCompany?.baseCurrency ?? 'INR')
const companyId = computed(() => session.activeCompanyId)

const tabs = computed(() => [
  { value: 'accounts', label: 'Accounts', icon: 'account_balance' },
  { value: 'structures', label: 'Salary structures', icon: 'account_tree' },
  { value: 'attendance', label: 'Attendance', icon: 'event_available' },
  { value: 'rules', label: 'Statutory rules', icon: 'gavel' },
])

/** The ledger groups a voucher may post to. */
const POSTING_GROUPS = ['assets', 'liabilities', 'equity', 'income', 'expenses']

/** The ledgers a payroll account may point at. */
const ledgerOptions = computed(() => [
  { value: '', label: 'Not mapped' },
  ...session.ledgers
    .filter((ledger) => POSTING_GROUPS.includes(ledger.group))
    .map((ledger) => ({ value: ledger.id, label: ledger.name })),
])

const ACCOUNT_FIELDS: Array<{ key: keyof PayrollAccounts; label: string; hint: string }> = [
  {
    key: 'salaryExpenseLedgerId',
    label: 'Salary and wages',
    hint: 'The cost of employment is debited here.',
  },
  {
    key: 'netSalaryPayableLedgerId',
    label: 'Net salary payable',
    hint: 'What the employees are owed after the deductions.',
  },
  {
    key: 'employeeDeductionsPayableLedgerId',
    label: 'Employee deductions payable',
    hint: 'What the employees contribute themselves.',
  },
  {
    key: 'statutoryDeductionsPayableLedgerId',
    label: 'Statutory deductions payable',
    hint: 'The tax deducted at source and the professional tax.',
  },
  {
    key: 'employerContributionsPayableLedgerId',
    label: "Employer's contributions payable",
    hint: "What the employer owes on the employees' behalf.",
  },
]

const accountRows = computed(() =>
  ACCOUNT_FIELDS.map((field) => ({
    key: field.key as string,
    label: field.label,
    hint: field.hint,
    ledger: ledgerName(accounts.value?.[field.key] ?? null),
  })),
)

function ledgerName(id: string | null | undefined): string {
  if (!id) return 'Not mapped'
  return session.ledgers.find((ledger) => ledger.id === id)?.name ?? 'Unknown ledger'
}

const attendanceRows = computed(() =>
  attendance.value.map((record) => {
    const employee = session.employees.find((entry) => entry.id === record.employeeId)
    return {
      id: record.id,
      employeeId: record.employeeId,
      name: employee?.name ?? 'Unknown employee',
      code: employee?.code ?? '—',
      payableDays: record.payableDays,
      lopDays: record.lopDays,
      extraDays: record.extraDays,
      otherDeductions: record.otherDeductions,
      note: record.note,
    }
  }),
)

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
  for (const record of attendance.value) {
    if (!periods.includes(record.period)) periods.push(record.period)
  }
  return periods.sort().reverse()
})

const attendancePeriodOptions = computed(() => periodOptions(availablePeriods.value))

/* ------------------------------------------------------------------ *
 * Loading
 * ------------------------------------------------------------------ */

async function load() {
  const id = companyId.value
  if (!id) {
    loading.value = false
    return
  }
  loading.value = true
  try {
    const [mapped, structureList, ruleList] = await Promise.all([
      session.repository.getPayrollAccounts(id),
      session.repository.listSalaryStructures(id),
      session.repository.listStatutoryRules(id),
    ])
    accounts.value = mapped
    structures.value = structureList
    rules.value = ruleList

    if (!period.value) {
      const year = session.activeFinancialYear
      period.value = year ? year.start.slice(0, 7) : new Date().toISOString().slice(0, 7)
    }
    attendance.value = await session.repository.listAttendance(id, period.value)
  } catch (cause) {
    toast.error(
      'The payroll settings could not be read',
      cause instanceof Error ? cause.message : 'The repository did not say why.',
    )
  } finally {
    loading.value = false
  }
}

async function loadAttendance() {
  const id = companyId.value
  if (!id) return
  attendance.value = await session.repository.listAttendance(id, period.value)
}

/* ------------------------------------------------------------------ *
 * The account mapping
 * ------------------------------------------------------------------ */

function openAccounts() {
  accountsForm.value = {
    salaryExpenseLedgerId: accounts.value?.salaryExpenseLedgerId ?? '',
    netSalaryPayableLedgerId: accounts.value?.netSalaryPayableLedgerId ?? '',
    employeeDeductionsPayableLedgerId: accounts.value?.employeeDeductionsPayableLedgerId ?? '',
    statutoryDeductionsPayableLedgerId: accounts.value?.statutoryDeductionsPayableLedgerId ?? '',
    employerContributionsPayableLedgerId:
      accounts.value?.employerContributionsPayableLedgerId ?? '',
  }
  accountsError.value = ''
  accountsOpen.value = true
}

async function saveAccounts() {
  const id = companyId.value
  if (!id) return
  const missing = Object.values(accountsForm.value).filter((value) => !value)
  if (missing.length) {
    accountsError.value = 'Every payroll account must point at a ledger before a run can be posted.'
    return
  }
  busy.value = true
  try {
    const mapped: PayrollAccounts = {
      id: accounts.value?.id ?? `pac-${Date.now().toString(36)}`,
      companyId: id,
      salaryExpenseLedgerId: accountsForm.value.salaryExpenseLedgerId!,
      netSalaryPayableLedgerId: accountsForm.value.netSalaryPayableLedgerId!,
      employeeDeductionsPayableLedgerId: accountsForm.value.employeeDeductionsPayableLedgerId!,
      statutoryDeductionsPayableLedgerId: accountsForm.value.statutoryDeductionsPayableLedgerId!,
      employerContributionsPayableLedgerId:
        accountsForm.value.employerContributionsPayableLedgerId!,
      createdAt: accounts.value?.createdAt ?? new Date().toISOString(),
    }
    await session.repository.savePayrollAccounts(mapped)
    accounts.value = mapped
    accountsOpen.value = false
    toast.success('Payroll accounts saved', 'A payroll run can now be posted.')
  } catch (cause) {
    accountsError.value =
      cause instanceof Error ? cause.message : 'The accounts were not saved and the repository did not say why.'
  } finally {
    busy.value = false
  }
}

/* ------------------------------------------------------------------ *
 * The attendance
 * ------------------------------------------------------------------ */

function editAttendance(row: { employeeId: string; id: string }) {
  const record = attendance.value.find((entry) => entry.id === row.id)
  if (!record) return
  attendanceForm.value = { ...record }
  attendanceError.value = ''
  attendanceOpen.value = true
}

async function saveAttendance() {
  const id = companyId.value
  const record = attendanceForm.value
  if (!id || !record) return
  if (record.payableDays < 0 || record.lopDays < 0 || record.extraDays < 0) {
    attendanceError.value = 'The days cannot be negative.'
    return
  }
  busy.value = true
  try {
    await session.repository.saveAttendance(record)
    attendanceOpen.value = false
    toast.success('Attendance saved', `The attendance for ${record.period} was saved.`)
    await loadAttendance()
  } catch (cause) {
    attendanceError.value =
      cause instanceof Error ? cause.message : 'The attendance was not saved and the repository did not say why.'
  } finally {
    busy.value = false
  }
}

async function addAttendance() {
  const id = companyId.value
  if (!id) return
  const employee = session.employees.find((entry) => entry.isActive)
  if (!employee) {
    toast.error('No employee to record', 'Add an employee to the master first.')
    return
  }
  const bounds = periodBounds(period.value)
  const record: PayrollAttendance = {
    id: `att-${Date.now().toString(36)}`,
    companyId: id,
    employeeId: employee.id,
    period: period.value,
    payableDays: bounds.days,
    lopDays: 0,
    extraDays: 0,
    otherDeductions: 0,
    note: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  attendanceForm.value = record
  attendanceError.value = ''
  attendanceOpen.value = true
}

/* ------------------------------------------------------------------ *
 * The rules
 * ------------------------------------------------------------------ */

async function acknowledge(rule: StatutoryRuleVersion) {
  const id = companyId.value
  if (!id) return
  busy.value = true
  try {
    await session.repository.saveStatutoryRule({
      ...rule,
      acknowledged: true,
      acknowledgedBy: 'rupam.admin',
      acknowledgedAt: new Date().toISOString(),
    })
    toast.success(
      'Rule acknowledged',
      `${RULE_SET_LABEL[rule.ruleSet]} will no longer block a run.`,
    )
    await load()
  } catch (cause) {
    toast.error(
      'The rule was not acknowledged',
      cause instanceof Error ? cause.message : 'The repository did not say why.',
    )
  } finally {
    busy.value = false
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

watch(period, () => {
  void loadAttendance()
})
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      title="Payroll settings"
      subtitle="The accounts, the salary structures, the attendance and the statutory rules"
      icon="settings"
      :breadcrumb="[{ label: 'Payroll' }, { label: 'Settings' }]"
    />

    <div class="shrink-0 border-b border-surface-container bg-surface-container-lowest px-space-lg">
      <BaseTabs v-model="tab" :tabs="tabs" />
    </div>

    <div class="min-h-0 flex-1 overflow-auto p-space-lg">
      <div v-if="loading" class="space-y-space-md">
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-3">
          <BaseSkeleton v-for="index in 3" :key="index" class="h-24" />
        </div>
        <BaseSkeleton class="h-72" />
      </div>

      <template v-else>
        <!-- The accounts ---------------------------------------------------->
        <template v-if="tab === 'accounts'">
          <div v-if="!accounts" class="rounded-md border border-outline-variant p-space-lg">
            <BaseEmptyState
              :icon="EmptyIcon"
              title="This company has no payroll accounts"
              description="A payroll run cannot be posted until the five payroll accounts point at ledgers. No ledger is ever chosen for you."
            >
              <BaseButton size="sm" variant="primary" icon="account_balance" @click="openAccounts">
                Map the payroll accounts
              </BaseButton>
            </BaseEmptyState>
          </div>

          <template v-else>
            <div class="grid grid-cols-1 gap-space-md sm:grid-cols-3">
              <StatTile
                label="Payroll accounts"
                :value="String(accountRows.length)"
                icon="account_balance"
                hint="The ledgers a payroll run posts to"
              />
              <StatTile
                label="Salary structures"
                :value="String(structures.length)"
                icon="account_tree"
                hint="One row per version"
              />
              <StatTile
                label="Statutory rules"
                :value="String(rules.length)"
                icon="gavel"
                hint="Every version the company holds"
              />
            </div>

            <BaseCard
              class="mt-space-md"
              title="The payroll accounts"
              description="The five ledgers a payroll run posts to"
            >
              <ul class="space-y-space-sm">
                <li
                  v-for="row in accountRows"
                  :key="row.key"
                  class="flex flex-wrap items-center justify-between gap-2 rounded-sm bg-surface-container-low p-space-sm"
                >
                  <div class="min-w-0">
                    <p class="text-body-md text-on-surface">{{ row.label }}</p>
                    <p class="text-label-xs text-outline">{{ row.hint }}</p>
                  </div>
                  <p class="num text-body-md text-on-surface">{{ row.ledger }}</p>
                </li>
              </ul>
              <template #actions>
                <BaseButton size="sm" variant="outlined" icon="edit" @click="openAccounts">
                  Change the mapping
                </BaseButton>
              </template>
            </BaseCard>
          </template>
        </template>

        <!-- The structures -------------------------------------------------->
        <template v-else-if="tab === 'structures'">
          <BaseCard
            title="The salary structures"
            description="A structure is versioned. A version that has been used is never edited; a change is a new version."
          >
            <div v-if="!structures.length" class="text-body-sm text-on-surface-variant">
              This company has no salary structure yet, so a run cannot be calculated.
            </div>
            <ul v-else class="space-y-space-md">
              <li
                v-for="structure in structures"
                :key="structure.id"
                class="rounded-sm bg-surface-container-low p-space-sm"
              >
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <p class="text-label-md font-bold text-on-surface">
                    {{ structure.name }}
                    <span class="ml-1 font-normal text-outline">version {{ structure.version }}</span>
                  </p>
                  <div class="flex items-center gap-2">
                    <span class="num text-label-xs text-outline">
                      From {{ formatDate(structure.effectiveFrom) }}
                      <template v-if="structure.effectiveTo">
                        to {{ formatDate(structure.effectiveTo) }}
                      </template>
                    </span>
                    <BaseBadge :tone="structure.isActive ? 'positive' : 'neutral'" size="xs">
                      {{ structure.isActive ? 'Current' : 'Superseded' }}
                    </BaseBadge>
                  </div>
                </div>
              </li>
            </ul>
          </BaseCard>
        </template>

        <!-- The attendance -------------------------------------------------->
        <template v-else-if="tab === 'attendance'">
          <FilterBar>
            <BaseSelect
              v-model="period"
              label="Period"
              size="sm"
              class="w-56"
              :options="attendancePeriodOptions"
            />
            <template #trailing>
              <BaseButton size="sm" variant="outlined" icon="add" @click="addAttendance">
                Add attendance
              </BaseButton>
            </template>
          </FilterBar>

          <BaseCard
            class="mt-space-md"
            title="The attendance for the period"
            description="The days each employee is paid for"
            padded
          >
            <DataTable
              :columns="attendanceColumns"
              :rows="attendanceRows"
              row-key="id"
              empty-title="No attendance recorded"
              empty-description="Record the attendance for this period before the run is calculated."
            >
              <template #cell:name="{ row }">
                <span class="text-on-surface">{{ row.name }}</span>
              </template>
              <template #cell:code="{ row }">
                <span class="num text-on-surface-variant">{{ row.code }}</span>
              </template>
              <template #cell:payableDays="{ row }">
                <span class="num text-on-surface">{{ row.payableDays }}</span>
              </template>
              <template #cell:lopDays="{ row }">
                <span class="num text-on-surface">{{ row.lopDays }}</span>
              </template>
              <template #cell:extraDays="{ row }">
                <span class="num text-on-surface">{{ row.extraDays }}</span>
              </template>
              <template #cell:otherDeductions="{ row }">
                <span class="num text-on-surface">
                  {{ formatMoney(row.otherDeductions, currency) }}
                </span>
              </template>
              <template #cell:actions="{ row }">
                <BaseButton size="xs" variant="text" icon="edit" @click="editAttendance(row)">
                  Edit
                </BaseButton>
              </template>
            </DataTable>
          </BaseCard>
        </template>

        <!-- The rules ------------------------------------------------------->
        <template v-else>
          <BaseCard
            title="The statutory rules"
            description="Every version the company holds, with its status and the source it comes from"
          >
            <ul class="space-y-space-md">
              <li
                v-for="rule in rules"
                :key="rule.id"
                class="rounded-sm bg-surface-container-low p-space-sm"
              >
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <p class="text-label-md font-bold text-on-surface">
                    {{ RULE_SET_LABEL[rule.ruleSet] }}
                  </p>
                  <div class="flex items-center gap-2">
                    <BaseBadge :tone="ruleStatusTone(rule.status)" size="xs">
                      {{ RULE_STATUS_LABEL[rule.status] }}
                    </BaseBadge>
                    <BaseBadge v-if="rule.acknowledged" tone="neutral" size="xs" icon="verified">
                      Acknowledged
                    </BaseBadge>
                  </div>
                </div>
                <p class="mt-0.5 text-label-xs text-outline">
                  In force from {{ formatDate(rule.effectiveFrom) }}
                  <template v-if="rule.effectiveTo"> to {{ formatDate(rule.effectiveTo) }}</template>
                </p>
                <p class="mt-1 text-body-sm text-on-surface-variant">{{ rule.summary }}</p>
                <p class="mt-1 text-label-xs text-outline">{{ rule.source }}</p>
                <div
                  v-if="rule.status !== 'in-force' && !rule.acknowledged"
                  class="mt-2 rounded-sm bg-tertiary-fixed p-space-sm"
                >
                  <p class="text-label-sm text-on-tertiary-fixed">
                    This rule is not in force, so it is not applied and it blocks a run. Acknowledge
                    it only if it applies to this company.
                  </p>
                  <BaseButton
                    size="xs"
                    variant="tonal"
                    icon="verified"
                    class="mt-space-sm"
                    :disabled="busy"
                    @click="acknowledge(rule)"
                  >
                    Acknowledge the rule
                  </BaseButton>
                </div>
              </li>
            </ul>
          </BaseCard>
        </template>
      </template>
    </div>

    <BaseModal
      :open="accountsOpen"
      title="The payroll accounts"
      description="The five ledgers a payroll run posts to"
      size="md"
      @close="accountsOpen = false"
    >
      <div class="space-y-space-md">
        <div v-for="field in ACCOUNT_FIELDS" :key="field.key">
          <BaseSelect
            v-model="accountsForm[field.key as string]"
            :label="field.label"
            :options="ledgerOptions"
            :hint="field.hint"
          />
        </div>
        <div v-if="accountsError" class="rounded-sm bg-error-container p-space-sm">
          <p class="text-label-sm text-on-error-container">{{ accountsError }}</p>
        </div>
      </div>

      <template #footer>
        <BaseButton variant="text" @click="accountsOpen = false">Cancel</BaseButton>
        <BaseButton variant="primary" icon="save" :loading="busy" @click="saveAccounts">
          Save the mapping
        </BaseButton>
      </template>
    </BaseModal>

    <BaseModal
      :open="attendanceOpen"
      title="The attendance"
      :description="attendanceForm ? `For ${attendanceForm.period}` : ''"
      size="md"
      @close="attendanceOpen = false"
    >
      <div v-if="attendanceForm" class="space-y-space-md">
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-3">
          <BaseInput
            v-model="attendanceForm.payableDays"
            label="Payable days"
            type="number"
            align="right"
            required
          />
          <BaseInput
            v-model="attendanceForm.lopDays"
            label="Loss of pay days"
            type="number"
            align="right"
            required
          />
          <BaseInput
            v-model="attendanceForm.extraDays"
            label="Extra days"
            type="number"
            align="right"
            required
          />
        </div>
        <BaseInput
          v-model="attendanceForm.otherDeductions"
          label="Other deductions"
          type="number"
          align="right"
          hint="Amount in rupees, recovered from the employee"
        />
        <BaseInput v-model="attendanceForm.note" label="Note" placeholder="Unpaid leave" />
        <div v-if="attendanceError" class="rounded-sm bg-error-container p-space-sm">
          <p class="text-label-sm text-on-error-container">{{ attendanceError }}</p>
        </div>
      </div>

      <template #footer>
        <BaseButton variant="text" @click="attendanceOpen = false">Cancel</BaseButton>
        <BaseButton variant="primary" icon="save" :loading="busy" @click="saveAttendance">
          Save the attendance
        </BaseButton>
      </template>
    </BaseModal>
  </div>
</template>
