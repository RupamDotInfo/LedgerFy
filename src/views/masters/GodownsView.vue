<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import BaseButton from '@/components/ui/BaseButton.vue'
import BaseEmptyState from '@/components/ui/BaseEmptyState.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import DataTable from '@/components/ui/DataTable.vue'
import type { TableColumn } from '@/components/ui/DataTable.vue'
import FilterBar from '@/components/ui/FilterBar.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import StatTile from '@/components/ui/StatTile.vue'
import type { Godown, StockMovement } from '@/domain/types'
import { formatQuantity } from '@/domain/quantity'
import { useSessionStore } from '@/stores/session'
import { useToastStore } from '@/stores/toast'

const session = useSessionStore()
const toast = useToastStore()

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const movements = ref<StockMovement[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const search = ref('')

async function load() {
  const companyId = session.activeCompanyId
  if (!companyId) {
    movements.value = []
    loading.value = false
    return
  }
  loading.value = true
  error.value = null
  try {
    movements.value = await session.repository.listStockMovements(companyId)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'The godown list could not be loaded.'
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

type GodownRow = {
  id: string
  name: string
  location: string
  itemCount: number
  totalQuantity: number
  movementCount: number
}

const godownRows = computed<GodownRow[]>(() =>
  session.godowns.map((godown) => {
    const own = movements.value.filter((movement) => movement.godownId === godown.id)
    const items = new Set(own.map((movement) => movement.itemId))
    return {
      id: godown.id,
      name: godown.name,
      location: godown.location ?? '',
      itemCount: items.size,
      totalQuantity: own.reduce((sum, movement) => sum + movement.quantityMilli, 0),
      movementCount: own.length,
    }
  }),
)

const visibleRows = computed(() => {
  const needle = search.value.trim().toLowerCase()
  if (!needle) return godownRows.value
  return godownRows.value.filter(
    (row) =>
      row.name.toLowerCase().includes(needle) || row.location.toLowerCase().includes(needle),
  )
})

const totalQuantityHeld = computed(() =>
  godownRows.value.reduce((sum, row) => sum + row.totalQuantity, 0),
)

const columns: TableColumn[] = [
  { key: 'name', label: 'Godown', sortable: true },
  { key: 'location', label: 'Location', sortable: true },
  { key: 'itemCount', label: 'Items held', align: 'right', numeric: true, sortable: true },
  { key: 'totalQuantity', label: 'Quantity held', align: 'right', numeric: true, sortable: true },
  { key: 'movementCount', label: 'Movements', align: 'right', numeric: true },
]

// ---------------------------------------------------------------------------
// New godown
// ---------------------------------------------------------------------------
//
// The godown is written through saveGodown and the list is refreshed from the
// repository.

const createOpen = ref(false)
const saving = ref(false)
const formError = ref<string | null>(null)
const fieldErrors = ref<Record<string, string>>({})
const form = ref({ name: '', location: '' })

/** True in the browser preview, where the workspace is held in memory only. */
const isPreviewWorkspace = computed(() => session.repository.info.kind === 'demo')

/** Where the saved record goes, stated plainly for the current runtime. */
const storageNotice = computed(() =>
  isPreviewWorkspace.value
    ? 'This is a browser preview. The godown is held in the in-memory sample workspace only and is lost when the window closes.'
    : 'The godown is written to the local database on this computer. It becomes part of the company master and survives a restart.',
)

function openCreate() {
  form.value = { name: '', location: '' }
  fieldErrors.value = {}
  formError.value = null
  createOpen.value = true
}

function validateForm(): boolean {
  const errors: Record<string, string> = {}
  const name = form.value.name.trim()
  if (!name) errors.name = 'A name is required.'
  else if (
    session.godowns.some((godown) => godown.name.trim().toLowerCase() === name.toLowerCase())
  ) {
    errors.name = 'A godown with this name already exists.'
  }
  fieldErrors.value = errors
  return Object.keys(errors).length === 0
}

async function saveGodown() {
  const companyId = session.activeCompanyId
  if (!companyId) {
    formError.value = 'Open a company before adding a godown.'
    return
  }
  if (!validateForm()) return

  saving.value = true
  formError.value = null
  try {
    const name = form.value.name.trim()
    const godown: Godown = {
      id: `godown-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      companyId,
      name,
      location: form.value.location.trim() || undefined,
    }

    await session.repository.saveGodown(godown)
    await session.loadMasters(companyId)
    createOpen.value = false
    toast.success(
      'Godown created',
      isPreviewWorkspace.value
        ? `"${name}" was added to the sample workspace in memory only. It is lost when the window closes.`
        : `"${name}" was written to the local database and survives a restart.`,
    )
  } catch (cause) {
    formError.value =
      cause instanceof Error ? cause.message : 'The godown could not be saved. Try again.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      title="Godowns"
      subtitle="Warehouses and stock locations, with the quantity held in each"
      icon="warehouse"
    >
      <template #actions>
        <BaseButton size="sm" variant="primary" icon="add" @click="openCreate">
          New godown
        </BaseButton>
      </template>
    </PageHeader>

    <FilterBar>
      <BaseInput
        v-model="search"
        label="Search"
        placeholder="Search godown or location"
        type="search"
        size="sm"
        class="w-64"
      />
      <template #trailing>
        <span class="text-label-sm text-outline">
          {{ visibleRows.length }} of {{ godownRows.length }} godowns
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
        <p class="font-semibold">The godown list could not be loaded</p>
        <p class="mt-0.5">{{ error }}</p>
      </div>

      <template v-else>
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-3">
          <StatTile
            label="Godowns"
            :value="String(godownRows.length)"
            icon="warehouse"
            hint="Stock locations of this company"
          />
          <StatTile
            label="Total quantity held"
            :value="formatQuantity(totalQuantityHeld)"
            icon="deployed_code"
            tone="info"
            hint="Net quantity across every godown"
          />
          <StatTile
            label="Stock movements"
            :value="String(movements.length)"
            icon="swap_vert"
            hint="Posted inward and outward movements"
          />
        </div>

        <section
          class="mt-space-md rounded-md bg-surface-container-lowest p-space-md shadow-sm"
        >
          <div class="flex items-start gap-space-sm">
            <MaterialIcon name="info" :size="20" class="mt-0.5 shrink-0 text-primary" />
            <div>
              <h2 class="text-headline-sm text-on-surface">What a godown does</h2>
              <p class="mt-1 text-body-sm leading-relaxed text-on-surface-variant">
                A godown is a physical place where stock is held. Every stock movement carries the
                godown it happened in, so the quantity sitting in each warehouse is the net of the
                inward and outward movements booked against it.
              </p>
              <p class="mt-2 text-body-sm leading-relaxed text-on-surface-variant">
                Batch numbers and expiry dates are
                <span class="font-semibold text-on-surface">not implemented</span> in this build.
                Item lines keep a free-text batch field, but no batch stock, expiry or FEFO logic
                runs on it, and no batch data is shown here.
              </p>
            </div>
          </div>
        </section>

        <section class="mt-space-md overflow-hidden rounded-md bg-surface-container-lowest shadow-sm">
          <header class="flex flex-wrap items-center justify-between gap-3 px-space-md py-space-sm">
            <div class="flex items-center gap-space-sm">
              <MaterialIcon name="table_view" :size="20" class="text-primary" />
              <h2 class="text-headline-sm text-on-surface">Godown list</h2>
            </div>
            <span class="text-label-xs text-outline">Quantity is the net of posted movements</span>
          </header>

          <DataTable
            v-if="visibleRows.length"
            :columns="columns"
            :rows="visibleRows"
            row-key="id"
            empty-title="No godowns match"
            empty-description="Change the search term."
          >
            <template #cell:name="{ row }">
              <span class="font-medium text-on-surface">{{ row.name }}</span>
            </template>
            <template #cell:location="{ row }">
              <span class="text-on-surface-variant">{{ row.location || '—' }}</span>
            </template>
            <template #cell:itemCount="{ row }">
              {{ row.itemCount }}
            </template>
            <template #cell:totalQuantity="{ row }">
              <span class="font-semibold">{{ formatQuantity(row.totalQuantity) }}</span>
            </template>
          </DataTable>

          <BaseEmptyState
            v-else
            title="No godowns match"
            description="Change the search term."
            :icon="MaterialIcon"
          />

          <footer
            class="border-t border-surface-container bg-surface-container-low/60 px-space-md py-space-sm text-label-xs text-outline"
          >
            Items held counts the distinct items that have moved in or out of the godown. Quantity
            held is the net of those movements, so it can be negative when more was issued than
            received.
          </footer>
        </section>
      </template>
    </div>

    <!-- New godown -->
    <BaseModal
      :open="createOpen"
      title="New godown"
      description="Add a warehouse or stock location."
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
          label="Godown name"
          required
          placeholder="e.g. Chennai Main Warehouse"
          :error="fieldErrors.name"
        />
        <BaseInput v-model="form.location" label="Location" placeholder="Optional" />
      </div>

      <template #footer>
        <BaseButton size="sm" variant="text" @click="createOpen = false">Close</BaseButton>
        <BaseButton
          size="sm"
          variant="primary"
          icon="save"
          :loading="saving"
          @click="saveGodown"
        >
          Save godown
        </BaseButton>
      </template>
    </BaseModal>
  </div>
</template>
