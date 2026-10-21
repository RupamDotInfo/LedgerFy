<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseEmptyState from '@/components/ui/BaseEmptyState.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import BasePagination from '@/components/ui/BasePagination.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import DataTable from '@/components/ui/DataTable.vue'
import FilterBar from '@/components/ui/FilterBar.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import StatTile from '@/components/ui/StatTile.vue'
import { maskIdentifier } from '@/domain/payroll'
import type { Employee } from '@/domain/types'
import { todayIso } from '@/lib/datetime'
import { formatMoney, toMinor, type Money } from '@/lib/money'
import { useSessionStore } from '@/stores/session'
import { useToastStore } from '@/stores/toast'

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

type EmployeeRow = {
  id: string
  code: string
  name: string
  department: string
  designation: string
  dateOfJoining: string
  monthlyGross: Money
  isActive: boolean
  costCentre: string
  taxRegime: string
  providentFund: boolean
  stateInsurance: boolean
  professionalTax: string
  pan: string
  bankAccount: string
}

const columns: TableColumnSpec[] = [
  { key: 'code', label: 'Code', sortable: true },
  { key: 'name', label: 'Name', sortable: true },
  { key: 'department', label: 'Department', sortable: true },
  { key: 'designation', label: 'Designation' },
  { key: 'contributions', label: 'Contributions' },
  { key: 'pan', label: 'Tax number' },
  { key: 'bankAccount', label: 'Bank account' },
  { key: 'monthlyGross', label: 'Monthly gross', align: 'right', numeric: true, sortable: true },
  { key: 'status', label: 'State' },
  { key: 'actions', label: '', width: '96px' },
]

const EmptyIcon = () => h(MaterialIcon, { name: 'person_search', size: 19 })

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

const search = ref('')
const department = ref('all')
const page = ref(1)
const pageSize = ref(25)
const modalOpen = ref(false)
const saving = ref(false)
const editingId = ref<string | null>(null)

const company = computed(() => session.activeCompany)
const currency = computed(() => company.value?.baseCurrency ?? 'INR')

/** The employees the repository holds for this company. */
const employees = computed<Employee[]>(() => session.employees)

const costCentreName = (id: string | null | undefined): string => {
  if (!id) return 'Not recorded'
  return session.costCentres.find((centre) => centre.id === id)?.name ?? 'Not recorded'
}

const departments = computed(() => {
  const names = new Set<string>()
  for (const employee of employees.value) {
    if (employee.department.trim()) names.add(employee.department.trim())
  }
  return [...names].sort((left, right) => left.localeCompare(right))
})

const departmentOptions = computed(() => [
  { value: 'all', label: 'All departments' },
  ...departments.value.map((name) => ({ value: name, label: name })),
])

const costCentreOptions = computed(() => [
  { value: '', label: 'Not recorded' },
  ...session.costCentres.map((centre) => ({ value: centre.id, label: centre.name })),
])

const taxRegimeOptions = [
  { value: 'new', label: 'New regime' },
  { value: 'old', label: 'Old regime' },
]

const filtered = computed<EmployeeRow[]>(() => {
  const term = search.value.trim().toLowerCase()
  const rows = employees.value.map((employee) => ({
    id: employee.id,
    code: employee.code,
    name: employee.name,
    department: employee.department || 'Not recorded',
    designation: employee.designation || 'Not recorded',
    dateOfJoining: employee.dateOfJoining,
    monthlyGross: employee.monthlyGross,
    isActive: employee.isActive,
    costCentre: costCentreName(employee.costCentreId),
    taxRegime: employee.taxRegime === 'old' ? 'Old regime' : 'New regime',
    providentFund: employee.isProvidentFundMember,
    stateInsurance: employee.isStateInsuranceMember,
    professionalTax: employee.professionalTaxJurisdiction ?? 'Not applicable',
    // The tax number and the account number are never shown in full.
    pan: maskIdentifier(employee.pan),
    bankAccount: maskIdentifier(employee.bankAccountNumber),
  }))
  return rows.filter((row) => {
    if (department.value !== 'all' && row.department !== department.value) return false
    if (!term) return true
    const haystack = `${row.code} ${row.name} ${row.department} ${row.designation}`.toLowerCase()
    return haystack.includes(term)
  })
})

const pagedRows = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})

const activeEmployees = computed(() => employees.value.filter((employee) => employee.isActive))

const monthlyGrossTotal = computed(() =>
  activeEmployees.value.reduce((sum, employee) => sum + employee.monthlyGross, 0),
)

/* ------------------------------------------------------------------ *
 * The employee form
 * ------------------------------------------------------------------ */

interface FormState {
  name: string
  code: string
  department: string
  designation: string
  dateOfJoining: string
  monthlyGross: string
  costCentreId: string
  pan: string
  taxRegime: string
  isProvidentFundMember: boolean
  isStateInsuranceMember: boolean
  isPersonWithDisability: boolean
  professionalTaxJurisdiction: string
  bankName: string
  bankAccountNumber: string
  bankIfsc: string
}

const form = ref<FormState>(emptyForm())
const errors = ref<Partial<Record<keyof FormState, string>>>({})

function emptyForm(): FormState {
  return {
    name: '',
    code: '',
    department: '',
    designation: '',
    dateOfJoining: todayIso(),
    monthlyGross: '',
    costCentreId: '',
    pan: '',
    taxRegime: 'new',
    isProvidentFundMember: true,
    isStateInsuranceMember: false,
    isPersonWithDisability: false,
    professionalTaxJurisdiction: '',
    bankName: '',
    bankAccountNumber: '',
    bankIfsc: '',
  }
}

function openCreate() {
  editingId.value = null
  form.value = emptyForm()
  errors.value = {}
  modalOpen.value = true
}

function openEdit(employee: Employee) {
  editingId.value = employee.id
  form.value = {
    name: employee.name,
    code: employee.code,
    department: employee.department,
    designation: employee.designation,
    dateOfJoining: employee.dateOfJoining,
    monthlyGross: String(employee.monthlyGross / 100),
    costCentreId: employee.costCentreId ?? '',
    pan: employee.pan ?? '',
    taxRegime: employee.taxRegime ?? 'new',
    isProvidentFundMember: employee.isProvidentFundMember,
    isStateInsuranceMember: employee.isStateInsuranceMember,
    isPersonWithDisability: employee.isPersonWithDisability,
    professionalTaxJurisdiction: employee.professionalTaxJurisdiction ?? '',
    bankName: employee.bankName ?? '',
    bankAccountNumber: employee.bankAccountNumber ?? '',
    bankIfsc: employee.bankIfsc ?? '',
  }
  errors.value = {}
  modalOpen.value = true
}

function closeModal() {
  modalOpen.value = false
}

function validate(): boolean {
  const next: Partial<Record<keyof FormState, string>> = {}
  if (!form.value.name.trim()) next.name = 'Enter the employee name.'
  else if (form.value.name.trim().length < 2) next.name = 'The name is too short to identify the employee.'

  const code = form.value.code.trim()
  if (!code) next.code = 'Enter an employee code.'
  else if (
    employees.value.some(
      (employee) =>
        employee.id !== editingId.value && employee.code.trim().toLowerCase() === code.toLowerCase(),
    )
  ) {
    next.code = 'This employee code is already in use.'
  }

  const gross = form.value.monthlyGross.trim()
  if (gross && !/^\d+(\.\d{1,2})?$/.test(gross)) {
    next.monthlyGross = 'Enter the monthly gross as a positive amount, for example 28000.'
  }

  const pan = form.value.pan.trim()
  if (pan && !/^[A-Za-z]{5}\d{4}[A-Za-z]$/.test(pan)) {
    next.pan = 'Enter the tax number as five letters, four digits and one letter.'
  }

  const account = form.value.bankAccountNumber.trim()
  if (account && !/^\d{6,18}$/.test(account)) {
    next.bankAccountNumber = 'Enter the account number as digits only.'
  }

  const ifsc = form.value.bankIfsc.trim()
  if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.toUpperCase())) {
    next.bankIfsc = 'Enter the branch identifier as four letters, a zero and six characters.'
  }

  errors.value = next
  return Object.keys(next).length === 0
}

async function save() {
  if (!validate()) return
  const companyId = session.activeCompanyId
  if (!companyId) {
    toast.error('No company is open', 'Open a company before saving an employee.')
    return
  }

  const grossText = form.value.monthlyGross.trim()
  const existing = editingId.value
    ? employees.value.find((employee) => employee.id === editingId.value)
    : undefined

  const employee: Employee = {
    id: existing?.id ?? `emp-${Date.now().toString(36)}`,
    companyId,
    name: form.value.name.trim(),
    code: form.value.code.trim(),
    department: form.value.department.trim(),
    designation: form.value.designation.trim(),
    dateOfJoining: form.value.dateOfJoining || todayIso(),
    monthlyGross: grossText ? toMinor(grossText, 100) : 0,
    isActive: existing?.isActive ?? true,
    costCentreId: form.value.costCentreId || null,
    pan: form.value.pan.trim().toUpperCase() || null,
    taxRegime: form.value.taxRegime === 'old' ? 'old' : 'new',
    isProvidentFundMember: form.value.isProvidentFundMember,
    isStateInsuranceMember: form.value.isStateInsuranceMember,
    isPersonWithDisability: form.value.isPersonWithDisability,
    professionalTaxJurisdiction: form.value.professionalTaxJurisdiction.trim() || null,
    bankName: form.value.bankName.trim() || null,
    bankAccountNumber: form.value.bankAccountNumber.trim() || null,
    bankIfsc: form.value.bankIfsc.trim().toUpperCase() || null,
  }

  saving.value = true
  try {
    await session.repository.saveEmployee(employee)
    await session.loadMasters(companyId)
    modalOpen.value = false
    toast.success(
      existing ? 'Employee saved' : 'Employee added',
      `${employee.name} (${employee.code}) is now part of the employee master.`,
    )
  } catch (cause) {
    toast.error(
      'The employee was not saved',
      cause instanceof Error ? cause.message : 'The repository did not say why.',
    )
  } finally {
    saving.value = false
  }
}

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

onMounted(async () => {
  if (!session.ready && !session.loading) await session.bootstrap()
})

watch(
  () => session.activeCompanyId,
  () => {
    page.value = 1
  },
)

watch([search, department, pageSize], () => {
  page.value = 1
})
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      title="Employees"
      subtitle="The employee master this company keeps"
      icon="groups"
      :breadcrumb="[{ label: 'Payroll' }, { label: 'Employees' }]"
    >
      <template #actions>
        <BaseButton size="sm" variant="primary" icon="person_add" @click="openCreate">
          Add employee
        </BaseButton>
      </template>
    </PageHeader>

    <FilterBar>
      <BaseInput
        v-model="search"
        type="search"
        placeholder="Search by name, code or designation"
        size="sm"
        class="w-72"
        label="Search"
      />
      <BaseSelect
        v-model="department"
        label="Department"
        size="sm"
        class="w-48"
        :options="departmentOptions"
      />
      <template #trailing>
        <span class="text-label-sm text-outline">
          {{ filtered.length }} of {{ employees.length }} employees
        </span>
      </template>
    </FilterBar>

    <div class="min-h-0 flex-1 overflow-auto p-space-lg">
      <div v-if="session.loading && !session.ready" class="space-y-space-md">
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-4">
          <BaseSkeleton v-for="index in 4" :key="index" class="h-24" />
        </div>
        <BaseSkeleton class="h-72" />
      </div>

      <template v-else>
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Employees"
            :value="String(employees.length)"
            icon="groups"
            hint="Held in the employee master"
          />
          <StatTile
            label="Active employees"
            :value="String(activeEmployees.length)"
            icon="person"
            tone="positive"
            hint="Marked active in the master"
          />
          <StatTile
            label="Provident fund members"
            :value="String(activeEmployees.filter((employee) => employee.isProvidentFundMember).length)"
            icon="savings"
            hint="Contribute to the provident fund"
          />
          <StatTile
            label="Monthly gross (active employees)"
            :value="formatMoney(monthlyGrossTotal, currency)"
            icon="payments"
            hint="Sum of the monthly gross on the master"
          />
        </div>

        <BaseCard
          class="mt-space-md"
          title="Employee master"
          description="Every employee held for this company"
          padded
        >
          <DataTable
            :columns="columns"
            :rows="pagedRows"
            row-key="id"
            :clickable="false"
            empty-title="No employee matches"
            empty-description="Adjust the search or department filter to find an employee."
          >
            <template #cell:code="{ row }">
              <span class="num font-semibold text-on-surface">{{ row.code }}</span>
            </template>
            <template #cell:name="{ row }">
              <div class="min-w-0">
                <p class="truncate text-on-surface">{{ row.name }}</p>
                <p class="truncate text-label-xs text-outline">{{ row.costCentre }}</p>
              </div>
            </template>
            <template #cell:contributions="{ row }">
              <div class="flex flex-wrap items-center gap-1">
                <BaseBadge
                  v-if="row.providentFund"
                  tone="info"
                  size="xs"
                  icon="savings"
                >
                  PF
                </BaseBadge>
                <BaseBadge
                  v-if="row.stateInsurance"
                  tone="info"
                  size="xs"
                  icon="health_and_safety"
                >
                  ESI
                </BaseBadge>
                <span class="text-label-xs text-outline">{{ row.taxRegime }}</span>
              </div>
            </template>
            <template #cell:pan="{ row }">
              <span class="num text-on-surface-variant">{{ row.pan || 'Not recorded' }}</span>
            </template>
            <template #cell:bankAccount="{ row }">
              <span class="num text-on-surface-variant">{{ row.bankAccount || 'Not recorded' }}</span>
            </template>
            <template #cell:monthlyGross="{ row }">
              <span class="num text-on-surface">{{ formatMoney(row.monthlyGross, currency) }}</span>
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
            <template #cell:actions="{ row }">
              <BaseButton
                size="xs"
                variant="text"
                icon="edit"
                @click="openEdit(employees.find((employee) => employee.id === row.id)!)"
              >
                Edit
              </BaseButton>
            </template>
          </DataTable>

          <BasePagination
            v-model:page="page"
            v-model:page-size="pageSize"
            :total="filtered.length"
            label="Employees"
          />
        </BaseCard>

        <BaseEmptyState
          v-if="!filtered.length"
          class="mt-space-md"
          :icon="EmptyIcon"
          title="No employee matches"
          description="Adjust the search text or the department filter."
        >
          <BaseButton size="sm" variant="outlined" icon="person_add" @click="openCreate">
            Add employee
          </BaseButton>
        </BaseEmptyState>

        <div class="mt-space-md rounded-sm border-l-4 border-l-primary bg-surface-container-low p-space-md">
          <div class="flex items-start gap-space-sm">
            <MaterialIcon name="lock" :size="18" class="mt-0.5 shrink-0 text-primary" />
            <div class="min-w-0">
              <p class="text-label-md font-bold text-on-surface">
                The tax number and the account number are held, never shown
              </p>
              <p class="mt-0.5 text-body-sm text-on-surface-variant">
                A system that puts a full account number or a tax number on a screen has made it a
                copy that can be left behind. Both are masked here, and they are masked everywhere
                else in the payroll too.
              </p>
            </div>
          </div>
        </div>
      </template>
    </div>

    <BaseModal
      :open="modalOpen"
      :title="editingId ? 'Edit employee' : 'Add employee'"
      description="The employee master this company keeps"
      size="lg"
      @close="closeModal"
    >
      <div class="space-y-space-md">
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2">
          <BaseInput
            v-model="form.name"
            label="Name"
            required
            :error="errors.name"
            placeholder="Full name"
          />
          <BaseInput
            v-model="form.code"
            label="Employee code"
            required
            :error="errors.code"
            placeholder="EMP-010"
          />
        </div>
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2">
          <BaseInput
            v-model="form.department"
            label="Department"
            placeholder="Accounts"
          />
          <BaseInput
            v-model="form.designation"
            label="Designation"
            placeholder="Senior Executive"
          />
        </div>
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2">
          <BaseInput
            v-model="form.dateOfJoining"
            label="Date of joining"
            type="date"
          />
          <BaseInput
            v-model="form.monthlyGross"
            label="Monthly gross"
            type="number"
            align="right"
            :error="errors.monthlyGross"
            hint="Amount in rupees, before any deduction"
            placeholder="28000"
          />
        </div>

        <div class="rounded-sm bg-surface-container-low p-space-sm">
          <p class="section-label mb-space-sm">Payroll</p>
          <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2">
            <BaseSelect
              v-model="form.costCentreId"
              label="Cost centre"
              :options="costCentreOptions"
            />
            <BaseSelect
              v-model="form.taxRegime"
              label="Tax regime"
              :options="taxRegimeOptions"
            />
          </div>
          <div class="mt-space-md grid grid-cols-1 gap-space-md sm:grid-cols-2">
            <BaseInput
              v-model="form.pan"
              label="Tax number"
              :error="errors.pan"
              placeholder="ABCDE1234F"
              hint="Shown masked on every screen"
            />
            <BaseInput
              v-model="form.professionalTaxJurisdiction"
              label="Professional tax jurisdiction"
              placeholder="Leave empty when it does not apply"
              hint="The jurisdiction the professional tax schedule applies in"
            />
          </div>
          <div class="mt-space-md space-y-space-sm">
            <BaseSwitch
              v-model="form.isProvidentFundMember"
              label="Contributes to the provident fund"
              description="The employee and the employer both contribute on the provident fund wages."
            />
            <BaseSwitch
              v-model="form.isStateInsuranceMember"
              label="Contributes to the state insurance"
              description="Only the employees whose wages are within the state insurance ceiling."
            />
            <BaseSwitch
              v-model="form.isPersonWithDisability"
              label="Person with a disability"
              description="The state insurance wage ceiling is higher for such an employee."
            />
          </div>
        </div>

        <div class="rounded-sm bg-surface-container-low p-space-sm">
          <p class="section-label mb-space-sm">Bank details</p>
          <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2">
            <BaseInput v-model="form.bankName" label="Bank" placeholder="HDFC Bank" />
            <BaseInput
              v-model="form.bankIfsc"
              label="Branch identifier"
              :error="errors.bankIfsc"
              placeholder="HDFC0001234"
              hint="Shown masked on every screen"
            />
          </div>
          <div class="mt-space-md grid grid-cols-1 gap-space-md sm:grid-cols-2">
            <BaseInput
              v-model="form.bankAccountNumber"
              label="Account number"
              :error="errors.bankAccountNumber"
              placeholder="50100234567890"
              hint="Shown masked on every screen"
            />
          </div>
        </div>
      </div>

      <template #footer>
        <BaseButton variant="text" @click="closeModal">Cancel</BaseButton>
        <BaseButton
          variant="primary"
          icon="save"
          :loading="saving"
          @click="save"
        >
          {{ editingId ? 'Save employee' : 'Add employee' }}
        </BaseButton>
      </template>
    </BaseModal>
  </div>
</template>
