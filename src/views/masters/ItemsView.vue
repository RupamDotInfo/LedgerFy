<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseDrawer from '@/components/ui/BaseDrawer.vue'
import BaseEmptyState from '@/components/ui/BaseEmptyState.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseNumberInput from '@/components/ui/BaseNumberInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import DataTable from '@/components/ui/DataTable.vue'
import type { TableColumn } from '@/components/ui/DataTable.vue'
import FilterBar from '@/components/ui/FilterBar.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import StatTile from '@/components/ui/StatTile.vue'
import type { Item, StockMovement } from '@/domain/types'
import { formatQuantity, fromQuantity, toQuantity } from '@/domain/quantity'
import { formatDate } from '@/lib/datetime'
import { formatMoney, toMinor } from '@/lib/money'
import { useSessionStore } from '@/stores/session'
import { useToastStore } from '@/stores/toast'

const session = useSessionStore()
const toast = useToastStore()

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const movementsByItem = ref<Record<string, StockMovement[]>>({})
const loading = ref(true)
const error = ref<string | null>(null)

const search = ref('')
const kindFilter = ref('all')

const currency = computed(() => session.activeCompany?.baseCurrency ?? 'INR')

async function load() {
  const companyId = session.activeCompanyId
  if (!companyId) {
    movementsByItem.value = {}
    loading.value = false
    return
  }
  loading.value = true
  error.value = null
  try {
    const entries = await Promise.all(
      session.items.map(async (item) => {
        const movements = await session.repository.listStockMovements(companyId, {
          itemId: item.id,
        })
        return [item.id, movements] as const
      }),
    )
    movementsByItem.value = Object.fromEntries(entries)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'The item list could not be loaded.'
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

type ItemRow = {
  id: string
  name: string
  groupName: string
  unitName: string
  unitDecimals: number
  hsn: string
  taxName: string
  isInventory: boolean
  isService: boolean
  purchasePrice: number
  salesPrice: number
  closingQuantity: number
  closingValue: number
  reorderLevel: number
  isActive: boolean
  lowStock: boolean
}

function movementsFor(itemId: string): StockMovement[] {
  return movementsByItem.value[itemId] ?? []
}

const itemRows = computed<ItemRow[]>(() =>
  session.items.map((item) => {
    const movements = movementsFor(item.id)
    const movementQuantity = movements.reduce((sum, movement) => sum + movement.quantityMilli, 0)
    const movementValue = movements.reduce((sum, movement) => sum + movement.value, 0)
    const closingQuantity = item.openingQuantityMilli + movementQuantity
    const closingValue = item.openingValue + movementValue
    const group = session.stockGroups.find((candidate) => candidate.id === item.stockGroupId)
    const unit = session.units.find((candidate) => candidate.id === item.unitId)
    const tax = session.taxCategories.find((candidate) => candidate.id === item.taxCategoryId)

    return {
      id: item.id,
      name: item.name,
      groupName: group?.name ?? 'Ungrouped',
      unitName: unit?.name ?? '—',
      unitDecimals: unit?.decimalPlaces ?? 0,
      hsn: item.hsn ?? '',
      taxName: tax?.name ?? '—',
      isInventory: item.isInventory,
      isService: item.isService,
      purchasePrice: item.purchasePrice,
      salesPrice: item.salesPrice,
      closingQuantity,
      closingValue,
      reorderLevel: item.reorderLevelMilli,
      isActive: item.isActive,
      lowStock:
        item.isInventory &&
        item.reorderLevelMilli > 0 &&
        closingQuantity <= item.reorderLevelMilli,
    }
  }),
)

const kindOptions = [
  { value: 'all', label: 'All items' },
  { value: 'inventory', label: 'Inventory items' },
  { value: 'service', label: 'Services' },
]

const visibleRows = computed(() => {
  const needle = search.value.trim().toLowerCase()
  return itemRows.value.filter((row) => {
    if (kindFilter.value === 'inventory' && !row.isInventory) return false
    if (kindFilter.value === 'service' && !row.isService) return false
    if (!needle) return true
    return (
      row.name.toLowerCase().includes(needle) ||
      row.groupName.toLowerCase().includes(needle) ||
      row.hsn.toLowerCase().includes(needle)
    )
  })
})

const inventoryCount = computed(() => itemRows.value.filter((row) => row.isInventory).length)
const serviceCount = computed(() => itemRows.value.filter((row) => row.isService).length)
const lowStockCount = computed(() => itemRows.value.filter((row) => row.lowStock).length)
const totalStockValue = computed(() =>
  itemRows.value.reduce((sum, row) => sum + (row.isInventory ? row.closingValue : 0), 0),
)

function formatRowQuantity(row: ItemRow, quantity: number): string {
  return fromQuantity(quantity).toFixed(row.unitDecimals)
}

const columns: TableColumn[] = [
  { key: 'name', label: 'Item', sortable: true },
  { key: 'groupName', label: 'Stock group', sortable: true },
  { key: 'unitName', label: 'Unit' },
  { key: 'hsn', label: 'HSN' },
  { key: 'purchasePrice', label: 'Purchase', align: 'right', numeric: true },
  { key: 'salesPrice', label: 'Sales', align: 'right', numeric: true },
  { key: 'closingQuantity', label: 'Closing qty', align: 'right', numeric: true, sortable: true },
  { key: 'closingValue', label: 'Closing value', align: 'right', numeric: true, sortable: true },
  { key: 'reorderLevel', label: 'Reorder at', align: 'right', numeric: true },
  { key: 'lowStock', label: 'Stock', align: 'center' },
  { key: 'isActive', label: 'State', align: 'center' },
]

// ---------------------------------------------------------------------------
// Movement drawer
// ---------------------------------------------------------------------------

const selectedItem = ref<Item | null>(null)
const drawerOpen = ref(false)

const movementRows = computed(() => {
  const item = selectedItem.value
  if (!item) return []
  return [...movementsFor(item.id)].sort((left, right) =>
    left.date === right.date
      ? left.voucherNumber.localeCompare(right.voucherNumber)
      : left.date < right.date
        ? -1
        : 1,
  )
})

const selectedItemRow = computed(
  () => itemRows.value.find((row) => row.id === selectedItem.value?.id) ?? null,
)

function openItem(row: ItemRow) {
  selectedItem.value = session.items.find((item) => item.id === row.id) ?? null
  drawerOpen.value = true
}

// ---------------------------------------------------------------------------
// New item
// ---------------------------------------------------------------------------

const createOpen = ref(false)
const saving = ref(false)
const formError = ref<string | null>(null)
const fieldErrors = ref<Record<string, string>>({})

const form = ref({
  name: '',
  stockGroupId: '',
  unitId: '',
  kind: 'inventory' as 'inventory' | 'service',
  hsn: '',
  taxCategoryId: '',
  purchasePrice: '',
  salesPrice: '',
  openingQuantity: '',
  openingValue: '',
  reorderLevel: '',
})

const groupOptions = computed(() =>
  session.stockGroups.map((group) => ({ value: group.id, label: group.name })),
)

const unitOptions = computed(() =>
  session.units.map((unit) => ({ value: unit.id, label: unit.name })),
)

const taxOptions = computed(() => [
  { value: '', label: 'No tax category' },
  ...session.taxCategories.map((category) => ({
    value: category.id,
    label: `${category.name} (${category.rate}%)`,
  })),
])

function resetForm() {
  form.value = {
    name: '',
    stockGroupId: session.stockGroups[0]?.id ?? '',
    unitId: session.units[0]?.id ?? '',
    kind: 'inventory',
    hsn: '',
    taxCategoryId: session.taxCategories[0]?.id ?? '',
    purchasePrice: '',
    salesPrice: '',
    openingQuantity: '',
    openingValue: '',
    reorderLevel: '',
  }
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
  if (!name) errors.name = 'An item name is required.'
  else if (session.items.some((item) => item.name.trim().toLowerCase() === name.toLowerCase())) {
    errors.name = 'An item with this name already exists.'
  }
  if (!form.value.stockGroupId) errors.stockGroupId = 'Choose a stock group.'
  if (!form.value.unitId) errors.unitId = 'Choose a unit.'
  if (form.value.kind === 'inventory') {
    const quantity = Number(form.value.openingQuantity || '0')
    if (!Number.isFinite(quantity) || quantity < 0) {
      errors.openingQuantity = 'Enter a quantity of zero or more.'
    }
  }
  fieldErrors.value = errors
  return Object.keys(errors).length === 0
}

async function saveItem() {
  const companyId = session.activeCompanyId
  if (!companyId) return
  if (!validateForm()) return

  saving.value = true
  formError.value = null
  try {
    const isService = form.value.kind === 'service'
    const item: Item = {
      id: `itm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      companyId,
      name: form.value.name.trim(),
      stockGroupId: form.value.stockGroupId,
      unitId: form.value.unitId,
      isInventory: !isService,
      isService,
      purchasePrice: toMinor(form.value.purchasePrice || '0'),
      salesPrice: toMinor(form.value.salesPrice || '0'),
      hsn: form.value.hsn.trim() || undefined,
      taxCategoryId: form.value.taxCategoryId || null,
      openingQuantityMilli: isService ? 0 : toQuantity(Number(form.value.openingQuantity || '0')),
      openingValue: isService ? 0 : toMinor(form.value.openingValue || '0'),
      reorderLevelMilli: isService ? 0 : toQuantity(Number(form.value.reorderLevel || '0')),
      isActive: true,
      createdAt: new Date().toISOString(),
    }

    await session.repository.saveItem(item)
    await session.loadMasters(companyId)
    await load()
    createOpen.value = false
    toast.success('Item created', `${item.name} was added to the item master.`)
  } catch (cause) {
    formError.value =
      cause instanceof Error ? cause.message : 'The item could not be saved. Try again.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      title="Items"
      subtitle="Stock and service masters with rates, quantity and stock value"
      icon="inventory_2"
    >
      <template #actions>
        <BaseButton size="sm" variant="primary" icon="add" @click="openCreate">New item</BaseButton>
      </template>
    </PageHeader>

    <FilterBar>
      <BaseInput
        v-model="search"
        label="Search"
        placeholder="Search items, group or HSN"
        type="search"
        size="sm"
        class="w-64"
      />
      <BaseSelect
        v-model="kindFilter"
        label="Kind"
        :options="kindOptions"
        size="sm"
        class="w-44"
      />
      <template #trailing>
        <span class="text-label-sm text-outline">
          {{ visibleRows.length }} of {{ itemRows.length }} items
        </span>
      </template>
    </FilterBar>

    <div class="min-h-0 flex-1 overflow-auto p-space-lg">
      <div v-if="loading" class="space-y-space-md">
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-4">
          <BaseSkeleton v-for="index in 4" :key="index" class="h-24" />
        </div>
        <BaseSkeleton class="h-72" />
      </div>

      <div
        v-else-if="error"
        class="rounded-md border-l-4 border-l-error bg-error-container p-space-md text-body-md text-on-error-container"
        role="alert"
      >
        <p class="font-semibold">The item list could not be loaded</p>
        <p class="mt-0.5">{{ error }}</p>
      </div>

      <template v-else>
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Items"
            :value="String(itemRows.length)"
            icon="inventory_2"
            hint="Stock and service masters"
          />
          <StatTile
            label="Inventory vs services"
            :value="`${inventoryCount} / ${serviceCount}`"
            icon="category"
            hint="Tracked in quantity / invoiced without stock"
          />
          <StatTile
            label="Below reorder level"
            :value="String(lowStockCount)"
            icon="warning"
            :tone="lowStockCount ? 'warning' : 'default'"
            hint="Closing quantity at or below the reorder level"
          />
          <StatTile
            label="Total stock value"
            :value="formatMoney(totalStockValue, currency)"
            icon="savings"
            tone="info"
            hint="Closing value of inventory items"
          />
        </div>

        <section
          class="mt-space-md overflow-hidden rounded-md bg-surface-container-lowest shadow-sm"
        >
          <header class="flex flex-wrap items-center justify-between gap-3 px-space-md py-space-sm">
            <div class="flex items-center gap-space-sm">
              <MaterialIcon name="table_view" :size="20" class="text-primary" />
              <h2 class="text-headline-sm text-on-surface">Item list</h2>
            </div>
            <span class="text-label-xs text-outline">Click a row to open the movement history</span>
          </header>

          <DataTable
            v-if="visibleRows.length"
            :columns="columns"
            :rows="visibleRows"
            row-key="id"
            empty-title="No items match"
            empty-description="Change the search term or the kind filter."
            @row-click="openItem"
          >
            <template #cell:name="{ row }">
              <span class="block font-medium text-on-surface">{{ row.name }}</span>
              <span class="block text-label-xs text-outline">{{ row.taxName }}</span>
            </template>
            <template #cell:hsn="{ row }">
              <span class="num text-numeric-sm text-on-surface-variant">{{ row.hsn || '—' }}</span>
            </template>
            <template #cell:purchasePrice="{ row }">
              {{ formatMoney(row.purchasePrice, currency) }}
            </template>
            <template #cell:salesPrice="{ row }">
              {{ formatMoney(row.salesPrice, currency) }}
            </template>
            <template #cell:closingQuantity="{ row }">
              <span class="font-semibold">
                {{ formatRowQuantity(row, row.closingQuantity) }}
              </span>
              <span class="ml-1 text-label-xs text-outline">{{ row.unitName }}</span>
            </template>
            <template #cell:closingValue="{ row }">
              {{ formatMoney(row.closingValue, currency) }}
            </template>
            <template #cell:reorderLevel="{ row }">
              {{ formatRowQuantity(row, row.reorderLevel) }}
            </template>
            <template #cell:lowStock="{ row }">
              <BaseBadge v-if="row.lowStock" tone="warning" size="xs" icon="warning">
                Low stock
              </BaseBadge>
              <span v-else-if="row.isService" class="text-label-xs text-outline">Service</span>
              <span v-else class="text-label-xs text-outline">—</span>
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
            title="No items match"
            description="Change the search term or the kind filter, or create a new item."
            :icon="MaterialIcon"
          >
            <BaseButton size="sm" variant="primary" icon="add" @click="openCreate">
              New item
            </BaseButton>
          </BaseEmptyState>

          <footer
            class="border-t border-surface-container bg-surface-container-low/60 px-space-md py-space-sm text-label-xs text-outline"
          >
            Valuation method: movement rate (each inward and outward movement is valued at its own
            rate, signed for outward movements). Weighted average and FIFO valuation are not
            implemented in this build. Closing quantity is the opening quantity plus every posted
            stock movement.
          </footer>
        </section>
      </template>
    </div>

    <!-- Movement drawer -->
    <BaseDrawer
      :open="drawerOpen"
      :title="selectedItem?.name ?? 'Item'"
      :description="
        selectedItemRow
          ? `${selectedItemRow.groupName} · ${selectedItemRow.unitName}`
          : ''
      "
      width="600px"
      @close="drawerOpen = false"
    >
      <div v-if="movementRows.length" class="space-y-space-sm">
        <table class="w-full text-left text-body-sm">
          <thead class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline">
            <tr>
              <th scope="col" class="px-space-sm py-2">Date</th>
              <th scope="col" class="px-space-sm py-2">Voucher</th>
              <th scope="col" class="px-space-sm py-2 text-right">Quantity</th>
              <th scope="col" class="px-space-sm py-2 text-right">Rate</th>
              <th scope="col" class="px-space-sm py-2 text-right">Value</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-surface-container-low">
            <tr v-for="movement in movementRows" :key="movement.id">
              <td class="whitespace-nowrap px-space-sm py-1.5 text-numeric-sm tabular text-outline">
                {{ formatDate(movement.date) }}
              </td>
              <td class="px-space-sm py-1.5 text-numeric-sm font-semibold text-on-surface">
                {{ movement.voucherNumber }}
              </td>
              <td
                class="px-space-sm py-1.5 text-right text-numeric-sm font-semibold tabular"
                :class="movement.direction === 'out' ? 'text-tertiary' : 'text-secondary'"
              >
                {{ movement.direction === 'in' ? '+' : '−' }}{{ formatQuantity(movement.quantityMilli) }}
              </td>
              <td class="px-space-sm py-1.5 text-right text-numeric-sm tabular text-on-surface-variant">
                {{ formatMoney(movement.rate, currency) }}
              </td>
              <td class="px-space-sm py-1.5 text-right text-numeric-sm tabular text-on-surface">
                {{ formatMoney(movement.value, currency) }}
              </td>
            </tr>
          </tbody>
          <tfoot class="bg-surface-container-low/60">
            <tr class="text-numeric-sm font-bold">
              <td class="px-space-sm py-2 text-on-surface" colspan="2">Closing</td>
              <td class="px-space-sm py-2 text-right tabular text-on-surface">
                {{ selectedItemRow ? formatRowQuantity(selectedItemRow, selectedItemRow.closingQuantity) : '—' }}
              </td>
              <td class="px-space-sm py-2 text-right tabular text-on-surface-variant">—</td>
              <td class="px-space-sm py-2 text-right tabular text-on-surface">
                {{ selectedItemRow ? formatMoney(selectedItemRow.closingValue, currency) : '—' }}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <BaseEmptyState
        v-else
        size="sm"
        title="No stock movements"
        description="No posted voucher has moved this item yet."
        :icon="MaterialIcon"
      />
    </BaseDrawer>

    <!-- New item -->
    <BaseModal
      :open="createOpen"
      title="New item"
      description="An item is either tracked in quantity or invoiced as a service."
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

        <BaseInput
          v-model="form.name"
          label="Item name"
          required
          placeholder="e.g. Steel Bolt M8"
          :error="fieldErrors.name"
        />

        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2">
          <BaseSelect
            v-model="form.stockGroupId"
            label="Stock group"
            required
            :options="groupOptions"
            :error="fieldErrors.stockGroupId"
          />
          <BaseSelect
            v-model="form.unitId"
            label="Unit"
            required
            :options="unitOptions"
            :error="fieldErrors.unitId"
          />
        </div>

        <BaseSelect
          v-model="form.kind"
          label="Kind"
          :options="[
            { value: 'inventory', label: 'Inventory item (tracked in quantity)' },
            { value: 'service', label: 'Service (no stock)' },
          ]"
        />

        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2">
          <BaseInput v-model="form.hsn" label="HSN / SAC" placeholder="Optional" />
          <BaseSelect
            v-model="form.taxCategoryId"
            label="Tax category"
            :options="taxOptions"
          />
        </div>

        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2">
          <BaseNumberInput
            v-model="form.purchasePrice"
            label="Purchase price"
            :currency="currency"
            placeholder="0.00"
          />
          <BaseNumberInput
            v-model="form.salesPrice"
            label="Sales price"
            :currency="currency"
            placeholder="0.00"
          />
        </div>

        <template v-if="form.kind === 'inventory'">
          <div class="grid grid-cols-1 gap-space-md sm:grid-cols-3">
            <BaseInput
              v-model="form.openingQuantity"
              label="Opening quantity"
              type="number"
              placeholder="0"
              :error="fieldErrors.openingQuantity"
            />
            <BaseNumberInput
              v-model="form.openingValue"
              label="Opening value"
              :currency="currency"
              placeholder="0.00"
            />
            <BaseInput
              v-model="form.reorderLevel"
              label="Reorder level"
              type="number"
              placeholder="0"
            />
          </div>
        </template>
      </div>

      <template #footer>
        <BaseButton size="sm" variant="text" @click="createOpen = false">Cancel</BaseButton>
        <BaseButton size="sm" variant="primary" icon="save" :loading="saving" @click="saveItem">
          Save item
        </BaseButton>
      </template>
    </BaseModal>
  </div>
</template>
