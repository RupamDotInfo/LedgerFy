<script setup lang="ts">
import { computed, ref } from 'vue'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseEmptyState from '@/components/ui/BaseEmptyState.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import DataTable from '@/components/ui/DataTable.vue'
import type { TableColumn } from '@/components/ui/DataTable.vue'
import FilterBar from '@/components/ui/FilterBar.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import StatTile from '@/components/ui/StatTile.vue'
import type { Ledger, TaxCategory, TaxType } from '@/domain/types'
import { useSessionStore } from '@/stores/session'
import { useToastStore } from '@/stores/toast'

const session = useSessionStore()
const toast = useToastStore()

const search = ref('')
const typeFilter = ref('all')

const TAX_TYPE_LABELS: Record<TaxType, string> = {
  cgst: 'CGST',
  sgst: 'SGST',
  igst: 'IGST',
  cess: 'Cess',
  tds: 'TDS',
  tcs: 'TCS',
}

type TaxRow = {
  id: string
  name: string
  type: TaxType
  typeLabel: string
  rate: number
  hsn: string
  ledgerId: string | null
  ledgerName: string
  inputLedgerId: string | null
  inputLedgerName: string
  side: 'output' | 'input' | 'both' | 'unknown'
  isActive: boolean
}

function sideOf(category: TaxCategory): 'output' | 'input' | 'both' | 'unknown' {
  const output = category.ledgerId
    ? session.ledgers.find((candidate) => candidate.id === category.ledgerId)
    : undefined
  const input = category.inputLedgerId
    ? session.ledgers.find((candidate) => candidate.id === category.inputLedgerId)
    : undefined
  const hasOutput = Boolean(output)
  const hasInput = Boolean(input) && input?.id !== output?.id
  if (hasOutput && hasInput) return 'both'
  if (hasOutput) return 'output'
  if (hasInput) return 'input'
  return 'unknown'
}

const taxRows = computed<TaxRow[]>(() =>
  session.taxCategories.map((category) => {
    const output = category.ledgerId
      ? session.ledgers.find((candidate) => candidate.id === category.ledgerId)
      : undefined
    const input = category.inputLedgerId
      ? session.ledgers.find((candidate) => candidate.id === category.inputLedgerId)
      : undefined
    return {
      id: category.id,
      name: category.name,
      type: category.type,
      typeLabel: TAX_TYPE_LABELS[category.type] ?? category.type,
      rate: category.rate,
      hsn: category.hsn ?? '',
      ledgerId: category.ledgerId,
      ledgerName: output?.name ?? 'No output ledger',
      inputLedgerId: category.inputLedgerId,
      inputLedgerName: input?.name ?? 'No input ledger',
      side: sideOf(category),
      isActive: category.isActive,
    }
  }),
)

const typeOptions = [
  { value: 'all', label: 'All types' },
  ...(Object.keys(TAX_TYPE_LABELS) as TaxType[]).map((type) => ({
    value: type,
    label: TAX_TYPE_LABELS[type],
  })),
]

const visibleRows = computed(() => {
  const needle = search.value.trim().toLowerCase()
  return taxRows.value.filter((row) => {
    if (typeFilter.value !== 'all' && row.type !== typeFilter.value) return false
    if (!needle) return true
    return (
      row.name.toLowerCase().includes(needle) ||
      row.ledgerName.toLowerCase().includes(needle) ||
      row.inputLedgerName.toLowerCase().includes(needle) ||
      row.hsn.toLowerCase().includes(needle)
    )
  })
})

const activeCount = computed(() => taxRows.value.filter((row) => row.isActive).length)

const outputCategories = computed(() =>
  taxRows.value.filter((row) => {
    if (!row.isActive) return false
    const ledger = session.ledgers.find((candidate) => candidate.id === row.ledgerId)
    if (ledger) return ledger.group === 'liabilities'
    return row.side === 'output' || row.side === 'both'
  }),
)

const inputCategories = computed(() =>
  taxRows.value.filter((row) => {
    if (!row.isActive) return false
    const ledger = session.ledgers.find((candidate) => candidate.id === row.inputLedgerId)
    if (ledger) return ledger.group === 'assets'
    return row.side === 'input' || row.side === 'both'
  }),
)

const highestOutputRate = computed(() => {
  const rates = outputCategories.value.map((row) => row.rate)
  return rates.length ? Math.max(...rates) : 0
})
const highestInputRate = computed(() => {
  const rates = inputCategories.value.map((row) => row.rate)
  return rates.length ? Math.max(...rates) : 0
})

const columns: TableColumn[] = [
  { key: 'name', label: 'Tax category', sortable: true },
  { key: 'typeLabel', label: 'Type', sortable: true },
  { key: 'rate', label: 'Rate', align: 'right', numeric: true, sortable: true },
  { key: 'hsn', label: 'HSN / SAC' },
  { key: 'ledgerName', label: 'Output ledger' },
  { key: 'inputLedgerName', label: 'Input ledger' },
  { key: 'side', label: 'Applies to', align: 'center' },
  { key: 'isActive', label: 'State', align: 'center' },
]

// ---------------------------------------------------------------------------
// New tax category
// ---------------------------------------------------------------------------
//
// The tax ledger and the category that points at it are both written: the
// ledger first through saveLedger, then the category through saveTaxCategory.

const createOpen = ref(false)
const saving = ref(false)
const formError = ref<string | null>(null)
const fieldErrors = ref<Record<string, string>>({})

/** True in the browser preview, where the workspace is held in memory only. */
const isPreviewWorkspace = computed(() => session.repository.info.kind === 'demo')

/** Where the saved records go, stated plainly for the current runtime. */
const storageNotice = computed(() =>
  isPreviewWorkspace.value
    ? 'This is a browser preview. The tax category and its ledger are held in the in-memory sample workspace only and are lost when the window closes.'
    : 'The tax category and its ledger are written to the local database on this computer. They become part of the company master and survive a restart.',
)

const form = ref({
  name: '',
  type: 'cgst' as TaxType,
  side: 'output' as 'output' | 'input',
  rate: '',
  hsn: '',
})

const taxTypeOptions = (Object.keys(TAX_TYPE_LABELS) as TaxType[]).map((type) => ({
  value: type,
  label: TAX_TYPE_LABELS[type],
}))

function resetForm() {
  form.value = { name: '', type: 'cgst', side: 'output', rate: '', hsn: '' }
  fieldErrors.value = {}
  formError.value = null
}

function openCreate() {
  resetForm()
  createOpen.value = true
}

function validateForm(): boolean {
  const errors: Record<string, string> = {}
  const name = form.value.name.trim()
  if (!name) errors.name = 'A name is required.'
  else if (
    session.ledgers.some((ledger) => ledger.name.trim().toLowerCase() === name.toLowerCase())
  ) {
    errors.name = 'A ledger with this name already exists.'
  }
  const rate = Number(form.value.rate)
  if (!form.value.rate.trim()) errors.rate = 'Enter the rate.'
  else if (!Number.isFinite(rate) || rate <= 0 || rate > 100) {
    errors.rate = 'Enter a rate between 0 and 100.'
  }
  fieldErrors.value = errors
  return Object.keys(errors).length === 0
}

async function submitTaxCategory() {
  const companyId = session.activeCompanyId
  if (!companyId) {
    formError.value = 'Open a company before adding a tax category.'
    return
  }
  if (!validateForm()) return

  saving.value = true
  formError.value = null

  const name = form.value.name.trim()
  const ledger: Ledger = {
    id: `led-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    companyId,
    name,
    group: form.value.side === 'output' ? 'liabilities' : 'assets',
    type: 'tax',
    parentId: null,
    openingBalance: 0,
    openingDate: session.activeFinancialYear?.start ?? '',
    partyKind: null,
    currency: session.activeCompany?.baseCurrency ?? 'INR',
    isSystem: false,
    isActive: true,
    createdAt: new Date().toISOString(),
  }
  const category: TaxCategory = {
    id: `tax-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    companyId,
    name,
    rate: Number(form.value.rate),
    type: form.value.type,
    hsn: form.value.hsn.trim() || undefined,
    ledgerId: form.value.side === 'output' ? ledger.id : null,
    inputLedgerId: form.value.side === 'input' ? ledger.id : null,
    isActive: true,
  }

  let ledgerSaved = false
  try {
    await session.repository.saveLedger(ledger)
    ledgerSaved = true
    await session.repository.saveTaxCategory(category)
    await session.loadMasters(companyId)
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : 'The write did not complete.'
    formError.value = ledgerSaved
      ? `The tax ledger "${name}" was saved, but the tax category was not: ${detail} The ledger is in the chart of accounts; the category is not stored.`
      : `Nothing was saved: ${detail}`
    toast.error(
      'Tax category not saved',
      ledgerSaved
        ? `The tax ledger "${name}" was created, but the category was not stored.`
        : 'The tax category and its ledger were not saved.',
    )
    return
  } finally {
    saving.value = false
  }

  createOpen.value = false
  toast.success(
    'Tax category created',
    isPreviewWorkspace.value
      ? `"${name}" and its tax ledger were added to the sample workspace in memory only. They are lost when the window closes.`
      : `"${name}" and its tax ledger were written to the local database and survive a restart.`,
  )
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      title="Taxes"
      subtitle="Tax categories, their rates and the ledger each one posts to"
      icon="percent"
    >
      <template #actions>
        <BaseButton size="sm" variant="primary" icon="add" @click="openCreate">
          New tax category
        </BaseButton>
      </template>
    </PageHeader>

    <FilterBar>
      <BaseInput
        v-model="search"
        label="Search"
        placeholder="Search category, ledger or HSN"
        type="search"
        size="sm"
        class="w-64"
      />
      <BaseSelect
        v-model="typeFilter"
        label="Type"
        :options="typeOptions"
        size="sm"
        class="w-40"
      />
      <template #trailing>
        <span class="text-label-sm text-outline">
          {{ visibleRows.length }} of {{ taxRows.length }} categories
        </span>
      </template>
    </FilterBar>

    <div class="min-h-0 flex-1 overflow-auto p-space-lg">
      <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-3">
        <StatTile
          label="Active categories"
          :value="String(activeCount)"
          icon="check_circle"
          hint="Tax categories available for voucher entry"
        />
        <StatTile
          label="Highest output rate"
          :value="`${highestOutputRate}%`"
          icon="north_east"
          tone="warning"
          hint="Highest active rate on an output tax ledger"
        />
        <StatTile
          label="Highest input rate"
          :value="`${highestInputRate}%`"
          icon="south_west"
          tone="info"
          hint="Highest active rate on an input tax ledger"
        />
      </div>

      <div
        class="mt-space-md flex items-start gap-space-sm rounded-md border-l-4 border-l-tertiary bg-tertiary-fixed p-space-md text-body-sm text-on-tertiary-fixed"
      >
        <MaterialIcon name="gavel" :size="18" class="mt-0.5 shrink-0" />
        <p>
          Rates on this screen are the rates configured in this LedgerFy company. They are not
          fetched from any government source. Confirm the rate, the HSN and the applicability of
          each category against the current GST, TDS and TCS rules before you file a return.
        </p>
      </div>

      <section class="mt-space-md overflow-hidden rounded-md bg-surface-container-lowest shadow-sm">
        <header class="flex flex-wrap items-center justify-between gap-3 px-space-md py-space-sm">
          <div class="flex items-center gap-space-sm">
            <MaterialIcon name="table_view" :size="20" class="text-primary" />
            <h2 class="text-headline-sm text-on-surface">Tax categories</h2>
          </div>
          <span class="text-label-xs text-outline">
            Output and input are decided by the ledger each category is linked to
          </span>
        </header>

        <DataTable
          v-if="visibleRows.length"
          :columns="columns"
          :rows="visibleRows"
          row-key="id"
          empty-title="No tax categories match"
          empty-description="Change the search term or the type filter."
        >
          <template #cell:name="{ row }">
            <span class="block font-medium text-on-surface">{{ row.name }}</span>
          </template>
          <template #cell:rate="{ row }">
            <span class="font-semibold">{{ row.rate }}%</span>
          </template>
          <template #cell:hsn="{ row }">
            <span class="num text-numeric-sm text-on-surface-variant">{{ row.hsn || '—' }}</span>
          </template>
          <template #cell:ledgerName="{ row }">
            <span :class="row.ledgerId ? 'text-on-surface-variant' : 'text-outline'">
              {{ row.ledgerName }}
            </span>
          </template>
          <template #cell:inputLedgerName="{ row }">
            <span :class="row.inputLedgerId ? 'text-on-surface-variant' : 'text-outline'">
              {{ row.inputLedgerName }}
            </span>
          </template>
          <template #cell:side="{ row }">
            <BaseBadge
              v-if="row.side === 'both'"
              tone="violet"
              size="xs"
              icon="swap_horiz"
            >
              Output and input
            </BaseBadge>
            <BaseBadge
              v-else-if="row.side === 'output'"
              tone="warning"
              size="xs"
              icon="north_east"
            >
              Output
            </BaseBadge>
            <BaseBadge v-else-if="row.side === 'input'" tone="info" size="xs" icon="south_west">
              Input
            </BaseBadge>
            <span v-else class="text-label-xs text-outline">Unlinked</span>
          </template>
          <template #cell:isActive="{ row }">
            <BaseBadge
              :tone="row.isActive ? 'positive' : 'warning'"
              size="xs"
              :icon="row.isActive ? 'check_circle' : 'pause_circle'"
            >
              {{ row.isActive ? 'Active' : 'Inactive' }}
            </BaseBadge>
          </template>
        </DataTable>

        <BaseEmptyState
          v-else
          title="No tax categories match"
          description="Change the search term or the type filter."
          :icon="MaterialIcon"
        />

        <footer
          class="border-t border-surface-container bg-surface-container-low/60 px-space-md py-space-sm text-label-xs text-outline"
        >
          Tax entries are posted against the output or input ledger of the category, never against
          a generic tax row. A category without a ledger is shown as unlinked and cannot post a tax
          entry.
        </footer>
      </section>
    </div>

    <!-- New tax category -->
    <BaseModal
      :open="createOpen"
      title="New tax category"
      description="Creates the tax category and the tax ledger it posts to."
      size="md"
      @close="createOpen = false"
    >
      <div class="space-y-space-md pt-space-xs">
        <div
          v-if="formError"
          class="rounded-sm border-l-4 border-l-error bg-error-container p-space-sm text-body-sm text-on-error-container"
          role="alert"
        >
          {{ formError }}
        </div>

        <div
          class="flex items-start gap-space-sm rounded-sm border-l-4 border-l-tertiary bg-tertiary-fixed p-space-sm text-body-sm text-on-tertiary-fixed"
          role="status"
        >
          <MaterialIcon name="info" :size="18" class="mt-0.5 shrink-0" />
          <p>{{ storageNotice }}</p>
        </div>

        <BaseInput
          v-model="form.name"
          label="Tax ledger name"
          required
          placeholder="e.g. Output CGST 9%"
          :error="fieldErrors.name"
        />

        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2">
          <BaseSelect
            v-model="form.type"
            label="Tax type"
            required
            :options="taxTypeOptions"
          />
          <BaseSelect
            v-model="form.side"
            label="Side"
            :options="[
              { value: 'output', label: 'Output tax (collected)' },
              { value: 'input', label: 'Input tax (paid)' },
            ]"
          />
        </div>

        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2">
          <BaseInput
            v-model="form.rate"
            label="Rate %"
            required
            type="number"
            placeholder="18"
            :error="fieldErrors.rate"
          />
          <BaseInput v-model="form.hsn" label="HSN / SAC" placeholder="Optional" />
        </div>
      </div>

      <template #footer>
        <BaseButton size="sm" variant="text" @click="createOpen = false">Close</BaseButton>
        <BaseButton
          size="sm"
          variant="primary"
          icon="save"
          :loading="saving"
          @click="submitTaxCategory"
        >
          Save tax category
        </BaseButton>
      </template>
    </BaseModal>
  </div>
</template>
