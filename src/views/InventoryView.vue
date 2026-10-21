<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseEmptyState from '@/components/ui/BaseEmptyState.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import DataTable from '@/components/ui/DataTable.vue'
import type { TableColumn } from '@/components/ui/DataTable.vue'
import FilterBar from '@/components/ui/FilterBar.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import StatTile from '@/components/ui/StatTile.vue'
import { averageCost, formatQuantity, lineValue } from '@/domain/quantity'
import type { InventoryAccounts, StockLocationBalance, StockPoolBalance } from '@/domain/types'
import { todayIso } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const router = useRouter()

const accounts = ref<InventoryAccounts | null>(null)
const pools = ref<StockPoolBalance[]>([])
const balances = ref<StockLocationBalance[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
/** Empty means the whole company. */
const godownFilter = ref('')

const currency = computed(() => session.activeCompany?.baseCurrency ?? 'INR')
const reportingDate = computed(() => todayIso())
const isActivated = computed(() => accounts.value !== null)
const valuationMethod = computed(() => accounts.value?.valuationMethod ?? 'moving-weighted-average')

async function load() {
  const companyId = session.activeCompanyId
  if (!companyId) {
    accounts.value = null
    pools.value = []
    balances.value = []
    loading.value = false
    return
  }
  loading.value = true
  error.value = null
  try {
    const [loadedAccounts, loadedPools, loadedBalances] = await Promise.all([
      session.repository.getInventoryAccounts(companyId),
      session.repository.listStockPools(companyId),
      session.repository.listStockBalances(companyId),
    ])
    accounts.value = loadedAccounts
    pools.value = loadedPools
    balances.value = loadedBalances
  } catch (cause) {
    error.value =
      cause instanceof Error ? cause.message : 'The stock summary could not be loaded.'
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => [session.activeCompanyId, session.activeYearId], load)

// ---------------------------------------------------------------------------
// Masters
// ---------------------------------------------------------------------------

const groupNames = computed(() => {
  const map = new Map<string, string>()
  for (const group of session.stockGroups) map.set(group.id, group.name)
  return map
})

const unitNames = computed(() => {
  const map = new Map<string, string>()
  for (const unit of session.units) map.set(unit.id, unit.name)
  return map
})

const godownNames = computed(() => {
  const map = new Map<string, string>()
  for (const godown of session.godowns) map.set(godown.id, godown.name)
  return map
})

const godownOptions = computed(() => [
  { value: '', label: 'All locations' },
  ...session.godowns.map((godown) => ({ value: godown.id, label: godown.name })),
])

// ---------------------------------------------------------------------------
// Stock position
// ---------------------------------------------------------------------------

type StockStatus = 'out' | 'low' | 'ok'

type ItemRow = {
  id: string
  name: string
  group: string
  unit: string
  /** The quantity in the selected scope. */
  quantityMilli: number
  /** The quantity the whole company holds, whatever the scope. */
  companyQuantityMilli: number
  /** The weighted-average unit cost of the company pool. */
  unitCost: number
  /** The carrying value of the quantity in the selected scope. */
  carryingValue: number
  reorderLevelMilli: number
  status: StockStatus
}

const itemRows = computed<ItemRow[]>(() => {
  const poolByItem = new Map(pools.value.map((pool) => [pool.itemId, pool]))
  const godownId = godownFilter.value

  const rows: ItemRow[] = session.items
    .filter((item) => item.isActive && item.isInventory)
    .map((item) => {
      const pool = poolByItem.get(item.id)
      const companyQuantityMilli = pool?.quantityMilli ?? 0
      const companyCarryingValue = pool?.carryingValue ?? 0
      // The costing pool is shared by the company, so the unit cost is the same
      // wherever the stock is held.
      const unitCost = averageCost(companyCarryingValue, companyQuantityMilli)

      let quantityMilli = companyQuantityMilli
      let carryingValue = companyCarryingValue
      if (godownId) {
        const location = balances.value.find(
          (candidate) => candidate.itemId === item.id && candidate.godownId === godownId,
        )
        quantityMilli = location?.quantityMilli ?? 0
        carryingValue = lineValue(quantityMilli, unitCost)
      }

      const status: StockStatus =
        companyQuantityMilli <= 0
          ? 'out'
          : companyQuantityMilli <= item.reorderLevelMilli
            ? 'low'
            : 'ok'

      return {
        id: item.id,
        name: item.name,
        group: groupNames.value.get(item.stockGroupId) ?? 'Ungrouped',
        unit: unitNames.value.get(item.unitId) ?? '',
        quantityMilli,
        companyQuantityMilli,
        unitCost,
        carryingValue,
        reorderLevelMilli: item.reorderLevelMilli,
        status,
      }
    })

  rows.sort((left, right) => left.name.localeCompare(right.name))
  return rows
})

const totalCarryingValue = computed(() =>
  itemRows.value.reduce((sum, row) => sum + row.carryingValue, 0),
)

const lowStockRows = computed(() =>
  itemRows.value
    .filter((row) => row.status !== 'ok')
    .map((row) => ({
      ...row,
      deficit: Math.max(0, row.reorderLevelMilli - row.companyQuantityMilli),
    }))
    .sort((left, right) => right.deficit - left.deficit),
)

const activeItemCount = computed(
  () => session.items.filter((item) => item.isActive && item.isInventory).length,
)

const scopeLabel = computed(() =>
  godownFilter.value
    ? (godownNames.value.get(godownFilter.value) ?? 'Selected location')
    : 'All locations',
)

const columns: TableColumn[] = [
  { key: 'name', label: 'Item', sortable: true },
  { key: 'group', label: 'Group', sortable: true },
  { key: 'quantityMilli', label: 'On hand', align: 'right', numeric: true, sortable: true },
  { key: 'unit', label: 'Unit' },
  { key: 'unitCost', label: 'Average cost', align: 'right', numeric: true, sortable: true },
  { key: 'carryingValue', label: 'Carrying value', align: 'right', numeric: true, sortable: true },
  { key: 'reorderLevelMilli', label: 'Reorder at', align: 'right', numeric: true },
  { key: 'status', label: 'Stock status', align: 'center' },
]
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      title="Stock summary"
      subtitle="Quantity and carrying value of every stock-tracked item"
      icon="inventory_2"
    >
      <template #actions>
        <BaseButton
          size="sm"
          variant="outlined"
          icon="history"
          @click="router.push('/inventory/register')"
        >
          Stock register
        </BaseButton>
        <BaseButton
          size="sm"
          variant="outlined"
          icon="swap_vert"
          @click="router.push('/inventory/movements')"
        >
          Movements
        </BaseButton>
        <BaseButton
          size="sm"
          variant="primary"
          icon="query_stats"
          @click="router.push('/inventory/valuation')"
        >
          Valuation
        </BaseButton>
      </template>
    </PageHeader>

    <FilterBar>
      <BaseSelect
        v-model="godownFilter"
        :options="godownOptions"
        size="sm"
        class="w-64"
        label="Location"
      />
      <span class="text-label-sm text-outline">
        Valuation as at {{ reportingDate }} · {{ valuationMethod }}
      </span>
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
        <p class="font-semibold">Stock summary could not be loaded</p>
        <p class="mt-0.5">{{ error }}</p>
      </div>

      <!-- Inventory has not been activated for this company. -->
      <section
        v-else-if="!isActivated"
        class="rounded-md bg-surface-container-lowest p-space-lg shadow-sm"
      >
        <BaseEmptyState
          title="Inventory is not activated for this company"
          description="Until inventory is activated, vouchers are posted without recording a stock movement, so there is no quantity and no carrying value to report. Activate inventory to start tracking stock from a cutover date."
          :icon="MaterialIcon"
        >
          <template #default>
            <BaseButton
              variant="primary"
              size="sm"
              icon="rocket_launch"
              @click="router.push('/inventory/activation')"
            >
              Open inventory activation
            </BaseButton>
          </template>
        </BaseEmptyState>
      </section>

      <template v-else>
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Total carrying value"
            :value="formatMoney(totalCarryingValue, currency)"
            icon="query_stats"
            tone="info"
            :hint="`${scopeLabel} · valued at the company weighted-average cost`"
          />
          <StatTile
            label="Stock-tracked items"
            :value="String(activeItemCount)"
            icon="category"
            hint="Items that carry a quantity"
          />
          <StatTile
            label="Below reorder level"
            :value="String(lowStockRows.length)"
            icon="warning"
            :tone="lowStockRows.length ? 'warning' : 'default'"
            hint="At or below the reorder level of the item"
          />
          <StatTile
            label="Locations"
            :value="String(session.godowns.length)"
            icon="warehouse"
            hint="Places where stock is held"
          />
        </div>

        <div class="mt-space-md grid grid-cols-1 items-start gap-space-md xl:grid-cols-12">
          <!-- Stock by item -->
          <section
            class="overflow-hidden rounded-md bg-surface-container-lowest shadow-sm xl:col-span-8"
          >
            <header class="flex flex-wrap items-center justify-between gap-3 px-space-md py-space-sm">
              <div class="flex items-center gap-space-sm">
                <MaterialIcon name="table_view" :size="20" class="text-primary" />
                <h2 class="text-headline-sm text-on-surface">Stock by item</h2>
              </div>
              <span class="text-label-xs text-outline">{{ itemRows.length }} items</span>
            </header>

            <DataTable
              v-if="itemRows.length"
              :columns="columns"
              :rows="itemRows"
              row-key="id"
              :clickable="false"
              empty-title="No stock-tracked items"
              empty-description="This company has no active inventory items."
            >
              <template #cell:name="{ row }">
                <span class="font-medium text-on-surface">{{ row.name }}</span>
              </template>
              <template #cell:unit="{ row }">
                <span class="text-label-sm text-outline">{{ row.unit }}</span>
              </template>
              <template #cell:quantityMilli="{ row }">
                <span class="font-bold">{{ formatQuantity(row.quantityMilli) }}</span>
              </template>
              <template #cell:unitCost="{ row }">
                {{ formatMoney(row.unitCost, currency) }}
              </template>
              <template #cell:carryingValue="{ row }">
                {{ formatMoney(row.carryingValue, currency) }}
              </template>
              <template #cell:reorderLevelMilli="{ row }">
                {{ formatQuantity(row.reorderLevelMilli) }}
              </template>
              <template #cell:status="{ row }">
                <BaseBadge
                  v-if="row.status === 'out'"
                  tone="danger"
                  size="xs"
                  icon="error"
                >
                  Out of stock
                </BaseBadge>
                <BaseBadge v-else-if="row.status === 'low'" tone="warning" size="xs" icon="warning">
                  Below reorder level
                </BaseBadge>
                <BaseBadge v-else tone="positive" size="xs" icon="check_circle">
                  Above reorder level
                </BaseBadge>
              </template>
            </DataTable>

            <BaseEmptyState
              v-else
              title="No stock-tracked items"
              description="This company has no active inventory items to summarise."
              :icon="MaterialIcon"
            />

            <footer
              class="border-t border-surface-container bg-surface-container-low/60 px-space-md py-space-sm text-label-xs text-outline"
            >
              <p>
                Method: {{ valuationMethod }} · Reporting date: {{ reportingDate }} · Scope:
                {{ scopeLabel }}
              </p>
              <p v-if="godownFilter" class="mt-1">
                The costing pool is shared by the company, so a location is valued at the company
                weighted-average cost. The reorder level belongs to the item, so the stock status
                is assessed against the quantity the whole company holds.
              </p>
            </footer>
          </section>

          <!-- Critical stock -->
          <section
            class="overflow-hidden rounded-md bg-surface-container-lowest shadow-sm xl:col-span-4"
          >
            <header class="flex items-center justify-between gap-3 px-space-md py-space-sm">
              <div class="flex items-center gap-space-sm">
                <MaterialIcon name="warning" :size="20" class="text-tertiary" />
                <h2 class="text-headline-sm text-on-surface">Critical stock</h2>
              </div>
              <BaseBadge :tone="lowStockRows.length ? 'warning' : 'neutral'" size="xs">
                {{ lowStockRows.length }} low
              </BaseBadge>
            </header>

            <div
              v-if="lowStockRows.length"
              class="max-h-[26rem] divide-y divide-surface-container-low overflow-auto"
            >
              <article
                v-for="row in lowStockRows"
                :key="row.id"
                class="flex items-center justify-between gap-2 px-space-md py-space-sm"
              >
                <div class="min-w-0">
                  <span class="block truncate text-label-md font-semibold text-on-surface">
                    {{ row.name }}
                  </span>
                  <span class="num block text-numeric-sm tabular text-outline">
                    {{ formatQuantity(row.companyQuantityMilli) }} {{ row.unit }} on hand · reorder
                    at {{ formatQuantity(row.reorderLevelMilli) }} {{ row.unit }}
                  </span>
                </div>
                <span
                  class="num shrink-0 rounded-sm bg-tertiary-fixed px-2 py-0.5 text-numeric-sm font-bold text-on-tertiary-fixed"
                >
                  Short {{ formatQuantity(row.deficit) }}
                </span>
              </article>
            </div>

            <BaseEmptyState
              v-else
              size="sm"
              title="Every item is above its reorder level"
              description="No purchase is needed to keep stock above the safety buffer."
              :icon="MaterialIcon"
            />

            <footer class="border-t border-surface-container bg-surface-container-low/60 p-space-sm">
              <BaseButton
                variant="primary"
                size="sm"
                block
                icon="add_shopping_cart"
                @click="router.push('/vouchers/new/purchase-order')"
              >
                Raise a purchase order
              </BaseButton>
            </footer>
          </section>
        </div>
      </template>
    </div>
  </div>
</template>
