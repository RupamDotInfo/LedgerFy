<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseEmptyState from '@/components/ui/BaseEmptyState.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import DataTable from '@/components/ui/DataTable.vue'
import type { TableColumn } from '@/components/ui/DataTable.vue'
import FilterBar from '@/components/ui/FilterBar.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import StatTile from '@/components/ui/StatTile.vue'
import type { CostCentre, Voucher } from '@/domain/types'
import { formatDate } from '@/lib/datetime'
import { useSessionStore } from '@/stores/session'
import { useToastStore } from '@/stores/toast'

const session = useSessionStore()
const toast = useToastStore()

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const vouchers = ref<Voucher[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const search = ref('')

const period = computed(() => session.activePeriod)

async function load() {
  const companyId = session.activeCompanyId
  if (!companyId) {
    vouchers.value = []
    loading.value = false
    return
  }
  loading.value = true
  error.value = null
  try {
    vouchers.value = await session.repository.listVouchers(companyId, {
      from: period.value.from,
      to: period.value.to,
      status: 'posted',
    })
  } catch (cause) {
    error.value =
      cause instanceof Error ? cause.message : 'The cost centre list could not be loaded.'
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  if (!session.ready && !session.loading) await session.bootstrap()
  await load()
})
watch(() => [session.activeCompanyId, session.activeYearId], load)

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

type CostCentreRow = {
  id: string
  name: string
  parentName: string
  entryCount: number
  isActive: boolean
}

const costCentreRows = computed<CostCentreRow[]>(() =>
  session.costCentres.map((costCentre) => {
    let entryCount = 0
    for (const voucher of vouchers.value) {
      for (const entry of voucher.entries) {
        if (entry.costCentreId === costCentre.id) entryCount += 1
      }
    }
    const parent = session.costCentres.find((candidate) => candidate.id === costCentre.parentId)
    return {
      id: costCentre.id,
      name: costCentre.name,
      parentName: parent?.name ?? '',
      entryCount,
      isActive: costCentre.isActive,
    }
  }),
)

const visibleRows = computed(() => {
  const needle = search.value.trim().toLowerCase()
  if (!needle) return costCentreRows.value
  return costCentreRows.value.filter(
    (row) =>
      row.name.toLowerCase().includes(needle) || row.parentName.toLowerCase().includes(needle),
  )
})

const allocatedCount = computed(
  () => costCentreRows.value.filter((row) => row.entryCount > 0).length,
)

const totalEntries = computed(() =>
  costCentreRows.value.reduce((sum, row) => sum + row.entryCount, 0),
)

const columns: TableColumn[] = [
  { key: 'name', label: 'Cost centre', sortable: true },
  { key: 'parentName', label: 'Under', sortable: true },
  { key: 'entryCount', label: 'Voucher entries', align: 'right', numeric: true, sortable: true },
  { key: 'isActive', label: 'State', align: 'center' },
]

// ---------------------------------------------------------------------------
// New cost centre
// ---------------------------------------------------------------------------
//
// The cost centre is written through saveCostCentre and the list is refreshed
// from the repository.

const createOpen = ref(false)
const saving = ref(false)
const formError = ref<string | null>(null)
const fieldErrors = ref<Record<string, string>>({})
const form = ref({ name: '', parentId: '' })

/** True in the browser preview, where the workspace is held in memory only. */
const isPreviewWorkspace = computed(() => session.repository.info.kind === 'demo')

/** Where the saved record goes, stated plainly for the current runtime. */
const storageNotice = computed(() =>
  isPreviewWorkspace.value
    ? 'This is a browser preview. The cost centre is held in the in-memory sample workspace only and is lost when the window closes.'
    : 'The cost centre is written to the local database on this computer. It becomes part of the company master and survives a restart.',
)

const parentOptions = computed(() => [
  { value: '', label: 'No parent' },
  ...session.costCentres.map((costCentre) => ({ value: costCentre.id, label: costCentre.name })),
])

function openCreate() {
  form.value = { name: '', parentId: '' }
  fieldErrors.value = {}
  formError.value = null
  createOpen.value = true
}

function validateForm(): boolean {
  const errors: Record<string, string> = {}
  const name = form.value.name.trim()
  if (!name) errors.name = 'A name is required.'
  else if (
    session.costCentres.some(
      (costCentre) => costCentre.name.trim().toLowerCase() === name.toLowerCase(),
    )
  ) {
    errors.name = 'A cost centre with this name already exists.'
  }
  fieldErrors.value = errors
  return Object.keys(errors).length === 0
}

async function saveCostCentre() {
  const companyId = session.activeCompanyId
  if (!companyId) {
    formError.value = 'Open a company before adding a cost centre.'
    return
  }
  if (!validateForm()) return

  saving.value = true
  formError.value = null
  try {
    const name = form.value.name.trim()
    const costCentre: CostCentre = {
      id: `cost-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      companyId,
      name,
      parentId: form.value.parentId || null,
      isActive: true,
    }

    await session.repository.saveCostCentre(costCentre)
    await session.loadMasters(companyId)
    createOpen.value = false
    toast.success(
      'Cost centre created',
      isPreviewWorkspace.value
        ? `"${name}" was added to the sample workspace in memory only. It is lost when the window closes.`
        : `"${name}" was written to the local database and survives a restart.`,
    )
  } catch (cause) {
    formError.value =
      cause instanceof Error ? cause.message : 'The cost centre could not be saved. Try again.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      title="Cost centres"
      subtitle="Divisions that voucher entries can be allocated to"
      icon="account_tree"
    >
      <template #actions>
        <BaseButton size="sm" variant="primary" icon="add" @click="openCreate">
          New cost centre
        </BaseButton>
      </template>
    </PageHeader>

    <FilterBar>
      <BaseInput
        v-model="search"
        label="Search"
        placeholder="Search cost centre"
        type="search"
        size="sm"
        class="w-64"
      />
      <template #trailing>
        <span class="text-label-sm text-outline">
          {{ visibleRows.length }} of {{ costCentreRows.length }} cost centres ·
          {{ formatDate(period.from) }} to {{ formatDate(period.to) }}
        </span>
      </template>
    </FilterBar>

    <div class="min-h-0 flex-1 overflow-auto p-space-lg">
      <div v-if="loading" class="space-y-space-md">
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-3">
          <BaseSkeleton v-for="index in 3" :key="index" class="h-24" />
        </div>
        <BaseSkeleton class="h-64" />
      </div>

      <div
        v-else-if="error"
        class="rounded-md border-l-4 border-l-error bg-error-container p-space-md text-body-md text-on-error-container"
        role="alert"
      >
        <p class="font-semibold">The cost centre list could not be loaded</p>
        <p class="mt-0.5">{{ error }}</p>
      </div>

      <template v-else>
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-3">
          <StatTile
            label="Cost centres"
            :value="String(costCentreRows.length)"
            icon="account_tree"
            hint="Divisions available for allocation"
          />
          <StatTile
            label="With allocation in period"
            :value="String(allocatedCount)"
            icon="call_split"
            tone="info"
            hint="Cost centres carrying at least one voucher entry"
          />
          <StatTile
            label="Allocated entries"
            :value="String(totalEntries)"
            icon="receipt_long"
            hint="Posted voucher entries tagged with a cost centre"
          />
        </div>

        <section class="mt-space-md overflow-hidden rounded-md bg-surface-container-lowest shadow-sm">
          <header class="flex flex-wrap items-center justify-between gap-3 px-space-md py-space-sm">
            <div class="flex items-center gap-space-sm">
              <MaterialIcon name="table_view" :size="20" class="text-primary" />
              <h2 class="text-headline-sm text-on-surface">Cost centre list</h2>
            </div>
            <span class="text-label-xs text-outline">
              Allocation is counted over posted vouchers of the active period
            </span>
          </header>

          <DataTable
            v-if="visibleRows.length"
            :columns="columns"
            :rows="visibleRows"
            row-key="id"
            empty-title="No cost centres match"
            empty-description="Change the search term."
          >
            <template #cell:name="{ row }">
              <span class="font-medium text-on-surface">{{ row.name }}</span>
            </template>
            <template #cell:parentName="{ row }">
              <span class="text-on-surface-variant">{{ row.parentName || 'Top level' }}</span>
            </template>
            <template #cell:entryCount="{ row }">
              <span :class="row.entryCount ? 'font-semibold text-on-surface' : 'text-outline'">
                {{ row.entryCount }}
              </span>
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
            title="No cost centres match"
            description="Change the search term."
            :icon="MaterialIcon"
          />

          <footer
            class="border-t border-surface-container bg-surface-container-low/60 px-space-md py-space-sm text-label-xs text-outline"
          >
            Every voucher entry that carries a cost centre is counted, including both the debit and
            the credit leg. Draft and cancelled vouchers are excluded.
          </footer>
        </section>
      </template>
    </div>

    <!-- New cost centre -->
    <BaseModal
      :open="createOpen"
      title="New cost centre"
      description="Add a division that voucher entries can be allocated to."
      size="sm"
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
          label="Cost centre name"
          required
          placeholder="e.g. Chennai Branch"
          :error="fieldErrors.name"
        />
        <BaseSelect v-model="form.parentId" label="Under" :options="parentOptions" />
      </div>

      <template #footer>
        <BaseButton size="sm" variant="text" @click="createOpen = false">Close</BaseButton>
        <BaseButton
          size="sm"
          variant="primary"
          icon="save"
          :loading="saving"
          @click="saveCostCentre"
        >
          Save cost centre
        </BaseButton>
      </template>
    </BaseModal>
  </div>
</template>
