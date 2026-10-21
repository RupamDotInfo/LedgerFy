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
import DataTable from '@/components/ui/DataTable.vue'
import FilterBar from '@/components/ui/FilterBar.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import StatTile from '@/components/ui/StatTile.vue'
import { useToastStore } from '@/stores/toast'
import { useSessionStore } from '@/stores/session'
import type { Employee } from '@/domain/types'
import { formatMoney, toMinor, type Money } from '@/lib/money'
import { formatDate, todayIso } from '@/lib/datetime'

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
  source: 'master' | 'session'
}

const columns: TableColumnSpec[] = [
  { key: 'code', label: 'Code', sortable: true },
  { key: 'name', label: 'Name', sortable: true },
  { key: 'department', label: 'Department', sortable: true },
  { key: 'designation', label: 'Designation' },
  { key: 'dateOfJoining', label: 'Date of joining', sortable: true },
  { key: 'monthlyGross', label: 'Monthly gross', align: 'right', numeric: true, sortable: true },
  { key: 'status', label: 'State' },
  { key: 'source', label: 'Source' },
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

/**
 * Employees added from this screen. The repository has no employee save
 * method, so these are held in the session only and are never written to
 * the books.
 */
const sessionEmployees = ref<Employee[]>([])

const company = computed(() => session.activeCompany)
const currency = computed(() => company.value?.baseCurrency ?? 'INR')

const employees = computed<Employee[]>(() => [...session.employees, ...sessionEmployees.value])

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
    source: sessionEmployees.value.some((candidate) => candidate.id === employee.id)
      ? ('session' as const)
      : ('master' as const),
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
 * Add-employee form
 * ------------------------------------------------------------------ */

interface FormState {
  name: string
  code: string
  department: string
  designation: string
  dateOfJoining: string
  monthlyGross: string
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
  }
}

function openModal() {
  form.value = emptyForm()
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
      (employee) => employee.code.trim().toLowerCase() === code.toLowerCase(),
    )
  ) {
    next.code = 'This employee code is already in use.'
  }

  const gross = form.value.monthlyGross.trim()
  if (gross && !/^\d+(\.\d{1,2})?$/.test(gross)) {
    next.monthlyGross = 'Enter the monthly gross as a positive amount, for example 28000.'
  }

  errors.value = next
  return Object.keys(next).length === 0
}

function save() {
  if (!validate()) return
  const grossText = form.value.monthlyGross.trim()
  const employee: Employee = {
    id: `emp-session-${Date.now()}`,
    companyId: session.activeCompanyId ?? '',
    name: form.value.name.trim(),
    code: form.value.code.trim(),
    department: form.value.department.trim(),
    designation: form.value.designation.trim(),
    dateOfJoining: form.value.dateOfJoining || todayIso(),
    monthlyGross: grossText ? toMinor(grossText, 100) : 0,
    isActive: true,
  }
  sessionEmployees.value = [...sessionEmployees.value, employee]
  modalOpen.value = false
  toast.success(
    'Employee added to this session',
    `${employee.name} (${employee.code}) is held in this screen only. Nothing was written to the repository.`,
  )
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
    sessionEmployees.value = []
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
        <BaseButton size="sm" variant="primary" icon="person_add" @click="openModal">
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
        <div class="rounded-sm border-l-4 border-l-tertiary bg-surface-container-low p-space-md">
          <div class="flex items-start gap-space-sm">
            <MaterialIcon name="info" :size="18" class="mt-0.5 shrink-0 text-tertiary" />
            <div class="min-w-0">
              <p class="text-label-md font-bold text-on-surface">
                Employees added here are held in this session only.
              </p>
              <p class="mt-0.5 text-body-sm text-on-surface-variant">
                The repository has no method to save an employee, so a new record is kept in this
                screen and nothing is written to the books. It is marked “Session only” in the
                table and is lost when the application closes. The master rows come from the
                repository.
              </p>
            </div>
          </div>
        </div>

        <div class="mt-space-md grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Employees"
            :value="String(employees.length)"
            icon="groups"
            :hint="`${sessionEmployees.length} added in this session`"
          />
          <StatTile
            label="Active employees"
            :value="String(activeEmployees.length)"
            icon="person"
            tone="positive"
            hint="Marked active in the master"
          />
          <StatTile
            label="Departments"
            :value="String(departments.length)"
            icon="domain"
            hint="Distinct departments in the master"
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
              <span class="text-on-surface">{{ row.name }}</span>
            </template>
            <template #cell:dateOfJoining="{ row }">
              <span class="num text-on-surface-variant">{{ formatDate(row.dateOfJoining) }}</span>
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
            <template #cell:source="{ row }">
              <BaseBadge
                :tone="row.source === 'session' ? 'warning' : 'neutral'"
                size="xs"
                :icon="row.source === 'session' ? 'schedule' : 'database'"
              >
                {{ row.source === 'session' ? 'Session only' : 'Master' }}
              </BaseBadge>
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
          <BaseButton size="sm" variant="outlined" icon="person_add" @click="openModal">
            Add employee
          </BaseButton>
        </BaseEmptyState>

        <div class="mt-space-md grid grid-cols-1 gap-space-md lg:grid-cols-2">
          <div class="rounded-sm border-l-4 border-l-tertiary bg-surface-container-low p-space-md">
            <div class="flex items-start gap-space-sm">
              <MaterialIcon name="percent" :size="18" class="mt-0.5 shrink-0 text-tertiary" />
              <div class="min-w-0">
                <p class="text-label-md font-bold text-on-surface">
                  Statutory payroll contributions are not implemented
                </p>
                <p class="mt-0.5 text-body-sm text-on-surface-variant">
                  Provident fund, ESI, professional tax and TDS on salary are not computed anywhere
                  in this build, and no statutory rate, wage ceiling or contribution threshold is
                  assumed. The monthly gross shown above is the figure stored on the master record
                  and nothing more.
                </p>
              </div>
            </div>
          </div>

          <div class="rounded-sm border-l-4 border-l-tertiary bg-surface-container-low p-space-md">
            <div class="flex items-start gap-space-sm">
              <MaterialIcon name="database" :size="18" class="mt-0.5 shrink-0 text-tertiary" />
              <div class="min-w-0">
                <p class="text-label-md font-bold text-on-surface">Where these records live</p>
                <p class="mt-0.5 text-body-sm text-on-surface-variant">
                  Rows marked “Master” are read from the repository with the rest of the company
                  masters. Rows marked “Session only” were added on this screen and exist in
                  memory only — they are not in the repository, will not appear in reports, and
                  cannot be relied on after a restart.
                </p>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>

    <BaseModal
      :open="modalOpen"
      title="Add employee"
      description="Held in this session only — the repository has no employee save method"
      size="md"
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

        <div class="rounded-sm border-l-4 border-l-tertiary bg-surface-container-low p-space-sm">
          <p class="text-label-sm text-on-surface-variant">
            Saving adds this employee to the list on this screen only. Nothing is written to the
            repository and the record is lost when the application closes.
          </p>
        </div>
      </div>

      <template #footer>
        <BaseButton variant="text" @click="closeModal">Cancel</BaseButton>
        <BaseButton variant="primary" icon="person_add" @click="save">Add employee</BaseButton>
      </template>
    </BaseModal>
  </div>
</template>
