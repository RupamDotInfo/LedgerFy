<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseEmptyState from '@/components/ui/BaseEmptyState.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import DataTable from '@/components/ui/DataTable.vue'
import type { TableColumn } from '@/components/ui/DataTable.vue'
import FilterBar from '@/components/ui/FilterBar.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import StatTile from '@/components/ui/StatTile.vue'
import { formatQuantity } from '@/domain/quantity'
import type { InventoryAccounts, StockMovement, StockPoolBalance } from '@/domain/types'
import { formatMoney } from '@/lib/money'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const router = useRouter()

const accounts = ref<InventoryAccounts | null>(null)
const movements = ref<StockMovement[]>([])
const pools = ref<StockPoolBalance[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

const search = ref('')
const itemFilter = ref('')
const godownFilter = ref('')
const fromDate = ref('')
const toDate = ref('')

const currency = computed(() => session.activeCompany?.baseCurrency ?? 'INR')
const valuationMethod = computed(() => accounts.value?.valuationMethod ?? 'moving-weighted-average')

async function load() {
  const companyId = session.activeCompanyId
  if (!companyId) {
    movements.value = []
    pools.value = []
    accounts.value = null
    loading.value = false
    return
  }
  loading.value = true
  error.value = null
  try {
    const [loadedAccounts, loadedMovements, loadedPools] = await Promise.all([
      session.repository.getInventoryAccounts(companyId),
      session.repository.listStockMovements(companyId),
      session.repository.listStockPools(companyId),
    ])
    accounts.value = loadedAccounts
    movements.value = loadedMovements
    pools.value = loadedPools
  } catch (cause) {
    error.value =
      cause instanceof Error ? cause.message : 'The stock register could not be loaded.'
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => [session.activeCompanyId, session.activeYearId], load)

// ---------------------------------------------------------------------------
// Masters
// ---------------------------------------------------------------------------

const itemNames = computed(() => {
  const map = new Map<string, string>()
  for (const item of session.items) map.set(item.id, item.name)
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

const itemOptions = computed(() => [
  { value: '', label: 'All items' },
  ...session.items
    .filter((item) => item.isInventory)
    .map((item) => ({ value: item.id, label: item.name })),
])

const godownOptions = computed(() => [
  { value: '', label: 'All locations' },
  ...session.godowns.map((godown) => ({ value: godown.id, label: godown.name })),
])

const MOVEMENT_LABELS: Record<string, string> = {
  opening: 'Opening',
  receipt: 'Receipt',
  issue: 'Issue',
  'return-in': 'Return in',
  'return-out': 'Return out',
  'transfer-in': 'Transfer in',
  'transfer-out': 'Transfer out',
  'adjustment-in': 'Adjustment in',
  'adjustment-out': 'Adjustment out',
}

function movementLabel(type: string): string {
  return MOVEMENT_LABELS[type] ?? type
}

// ---------------------------------------------------------------------------
// The register
// ---------------------------------------------------------------------------

type RegisterRow = {
  id: string
  date: string
  itemId: string
  itemName: string
  unit: string
  voucherId: string
  voucherNumber: string
  movementType: string
  movementLabel: string
  godownId: string | null
  godownName: string
  inward: number
  outward: number
  /** The pool quantity after the movement, taken from the movement record. */
  runningQuantityMilli: number
  value: number
  /** The pool carrying value after the movement, taken from the movement record. */
  runningCarryingValue: number
  isOpening: boolean
}

const registerRows = computed<RegisterRow[]>(() => {
  const term = search.value.trim().toLowerCase()
  const rows: RegisterRow[] = []

  for (const movement of movements.value) {
    if (itemFilter.value && movement.itemId !== itemFilter.value) continue
    if (godownFilter.value && movement.godownId !== godownFilter.value) continue
    if (fromDate.value && movement.date < fromDate.value) continue
    if (toDate.value && movement.date > toDate.value) continue
    const itemName = itemNames.value.get(movement.itemId) ?? 'Unknown item'
    if (
      term &&
      !itemName.toLowerCase().includes(term) &&
      !movement.voucherNumber.toLowerCase().includes(term)
    ) {
      continue
    }
    rows.push({
      id: movement.id,
      date: movement.date,
      itemId: movement.itemId,
      itemName,
      unit: unitNames.value.get(
        session.items.find((item) => item.id === movement.itemId)?.unitId ?? '',
      ) ?? '',
      voucherId: movement.voucherId,
      voucherNumber: movement.voucherNumber,
      movementType: movement.movementType,
      movementLabel: movementLabel(movement.movementType),
      godownId: movement.godownId,
      godownName: movement.godownId ? (godownNames.value.get(movement.godownId) ?? 'Unknown') : '—',
      inward: movement.direction === 'in' ? movement.quantityMilli : 0,
      outward: movement.direction === 'out' ? movement.quantityMilli : 0,
      runningQuantityMilli: movement.resultingQuantityMilli,
      value: movement.value,
      runningCarryingValue: movement.resultingCarryingValue,
      isOpening: movement.movementType === 'opening',
    })
  }

  // The register is chronological, so the running balance reads correctly.
  rows.sort((left, right) => {
    if (left.date !== right.date) return left.date < right.date ? -1 : 1
    return left.id < right.id ? -1 : 1
  })
  return rows
})

const totalInward = computed(() =>
  registerRows.value.reduce((sum, row) => sum + row.inward, 0),
)
const totalOutward = computed(() =>
  registerRows.value.reduce((sum, row) => sum + row.outward, 0),
)
const totalMovementValue = computed(() =>
  registerRows.value.reduce((sum, row) => sum + row.value, 0),
)

/**
 * The closing position, taken from the last movement of every item, compared
 * with the costing pool the repository holds. The two must agree.
 */
const reconciliation = computed(() => {
  const lastByItem = new Map<string, RegisterRow>()
  for (const row of registerRows.value) lastByItem.set(row.itemId, row)

  let movementQuantity = 0
  let movementValue = 0
  let poolQuantity = 0
  let poolValue = 0
  for (const pool of pools.value) {
    if (itemFilter.value && pool.itemId !== itemFilter.value) continue
    poolQuantity += pool.quantityMilli
    poolValue += pool.carryingValue
    const last = lastByItem.get(pool.itemId)
    if (last) {
      movementQuantity += last.runningQuantityMilli
      movementValue += last.runningCarryingValue
    }
  }
  for (const row of lastByItem.values()) {
    if (itemFilter.value && row.itemId !== itemFilter.value) continue
    if (!pools.value.some((pool) => pool.itemId === row.itemId)) {
      movementQuantity += row.runningQuantityMilli
      movementValue += row.runningCarryingValue
    }
  }

  return {
    movementQuantity,
    movementValue,
    poolQuantity,
    poolValue,
    quantityDifference: movementQuantity - poolQuantity,
    valueDifference: movementValue - poolValue,
  }
})

const isReconciled = computed(
  () =>
    reconciliation.value.quantityDifference === 0 && reconciliation.value.valueDifference === 0,
)

const columns: TableColumn[] = [
  { key: 'date', label: 'Date', sortable: true },
  { key: 'voucherNumber', label: 'Source', sortable: true },
  { key: 'itemName', label: 'Item', sortable: true },
  { key: 'movementLabel', label: 'Movement' },
  { key: 'godownName', label: 'Location' },
  { key: 'inward', label: 'In', align: 'right', numeric: true, sortable: true },
  { key: 'outward', label: 'Out', align: 'right', numeric: true, sortable: true },
  { key: 'runningQuantityMilli', label: 'Running qty', align: 'right', numeric: true },
  { key: 'value', label: 'Movement value', align: 'right', numeric: true },
  { key: 'runningCarryingValue', label: 'Running value', align: 'right', numeric: true },
]
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      title="Stock register"
      subtitle="Every movement of stock, in date order, with the balance that followed it"
      icon="receipt_long"
    >
      <template #actions>
        <BaseButton
          size="sm"
          variant="outlined"
          icon="inventory_2"
          @click="router.push('/inventory')"
        >
          Stock summary
        </BaseButton>
        <BaseButton
          size="sm"
          variant="outlined"
          icon="swap_vert"
          @click="router.push('/inventory/movements')"
        >
          Raw ledger
        </BaseButton>
      </template>
    </PageHeader>

    <FilterBar>
      <BaseInput
        v-model="search"
        placeholder="Search item or voucher number"
        size="sm"
        type="search"
        class="w-64"
      />
      <BaseSelect v-model="itemFilter" :options="itemOptions" size="sm" class="w-56" />
      <BaseSelect v-model="godownFilter" :options="godownOptions" size="sm" class="w-48" />
      <BaseInput v-model="fromDate" type="date" size="sm" class="w-40" label="From" />
      <BaseInput v-model="toDate" type="date" size="sm" class="w-40" label="To" />
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
        <p class="font-semibold">Stock register could not be loaded</p>
        <p class="mt-0.5">{{ error }}</p>
      </div>

      <section
        v-else-if="!accounts"
        class="rounded-md bg-surface-container-lowest p-space-lg shadow-sm"
      >
        <BaseEmptyState
          title="Inventory is not activated for this company"
          description="There is no movement ledger to report on yet. Activate inventory to start recording stock movements."
          :icon="MaterialIcon"
        >
          <BaseButton
            variant="primary"
            size="sm"
            icon="rocket_launch"
            @click="router.push('/inventory/activation')"
          >
            Open inventory activation
          </BaseButton>
        </BaseEmptyState>
      </section>

      <template v-else>
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Quantity received"
            :value="formatQuantity(totalInward)"
            icon="south"
            tone="info"
            hint="Stock that came in over the period shown"
          />
          <StatTile
            label="Quantity issued"
            :value="formatQuantity(totalOutward)"
            icon="north"
            tone="warning"
            hint="Stock that went out over the period shown"
          />
          <StatTile
            label="Movement value"
            :value="formatMoney(totalMovementValue, currency)"
            icon="payments"
            hint="Value of the movements shown, at cost"
          />
          <StatTile
            label="Closing carrying value"
            :value="formatMoney(reconciliation.poolValue, currency)"
            icon="inventory_2"
            hint="Carrying value of the stock on hand"
          />
        </div>

        <!-- Reconciliation with the costing pool. -->
        <div
          class="mt-space-md flex flex-wrap items-center gap-space-sm rounded-md px-space-md py-space-sm"
          :class="isReconciled ? 'bg-secondary-container text-on-secondary-container' : 'bg-tertiary-fixed text-on-tertiary-fixed'"
          role="status"
        >
          <MaterialIcon :name="isReconciled ? 'check_circle' : 'warning'" :size="20" />
          <p class="text-body-sm">
            <template v-if="isReconciled">
              The register reconciles with the costing pool: closing quantity
              {{ formatQuantity(reconciliation.poolQuantity) }}, carrying value
              {{ formatMoney(reconciliation.poolValue, currency) }}.
            </template>
            <template v-else>
              The register does not reconcile with the costing pool. Difference in quantity:
              {{ formatQuantity(reconciliation.quantityDifference) }}. Difference in carrying
              value: {{ formatMoney(reconciliation.valueDifference, currency) }}.
            </template>
          </p>
        </div>

        <section
          class="mt-space-md overflow-hidden rounded-md bg-surface-container-lowest shadow-sm"
        >
          <header class="flex flex-wrap items-center justify-between gap-3 px-space-md py-space-sm">
            <div class="flex items-center gap-space-sm">
              <MaterialIcon name="table_view" :size="20" class="text-primary" />
              <h2 class="text-headline-sm text-on-surface">Movements</h2>
            </div>
            <span class="text-label-xs text-outline">{{ registerRows.length }} movements</span>
          </header>

          <DataTable
            v-if="registerRows.length"
            :columns="columns"
            :rows="registerRows"
            row-key="id"
            :clickable="false"
            empty-title="No movement matches the filters"
            empty-description="Change the filters, or widen the date range, to see the movements."
          >
            <template #cell:date="{ row }">
              <span class="text-body-sm tabular">{{ row.date }}</span>
            </template>
            <template #cell:voucherNumber="{ row }">
              <button
                v-if="!row.isOpening"
                type="button"
                class="flex items-center gap-1 text-label-sm font-semibold text-primary hover:underline"
                @click="router.push(`/vouchers/${row.voucherId}`)"
              >
                <MaterialIcon name="open_in_new" :size="14" />
                {{ row.voucherNumber }}
              </button>
              <span v-else class="text-label-sm text-outline">{{ row.voucherNumber }}</span>
            </template>
            <template #cell:itemName="{ row }">
              <span class="text-body-sm">{{ row.itemName }}</span>
            </template>
            <template #cell:movementLabel="{ row }">
              <BaseBadge tone="neutral" size="xs">{{ row.movementLabel }}</BaseBadge>
            </template>
            <template #cell:godownName="{ row }">
              <span class="text-label-sm text-outline">{{ row.godownName }}</span>
            </template>
            <template #cell:inward="{ row }">
              <span v-if="row.inward" class="text-secondary">{{ formatQuantity(row.inward) }}</span>
              <span v-else class="text-outline">—</span>
            </template>
            <template #cell:outward="{ row }">
              <span v-if="row.outward" class="text-tertiary">{{ formatQuantity(row.outward) }}</span>
              <span v-else class="text-outline">—</span>
            </template>
            <template #cell:runningQuantityMilli="{ row }">
              {{ formatQuantity(row.runningQuantityMilli) }}
            </template>
            <template #cell:value="{ row }">
              {{ formatMoney(row.value, currency) }}
            </template>
            <template #cell:runningCarryingValue="{ row }">
              {{ formatMoney(row.runningCarryingValue, currency) }}
            </template>
          </DataTable>

          <BaseEmptyState
            v-else
            title="No movement matches the filters"
            description="Change the filters, or widen the date range, to see the movements."
            :icon="MaterialIcon"
          />

          <footer
            class="border-t border-surface-container bg-surface-container-low/60 px-space-md py-space-sm text-label-xs text-outline"
          >
            Method: {{ valuationMethod }} · The running quantity and the running carrying value
            are the balances recorded on the movement itself, not a figure recomputed on this
            screen.
          </footer>
        </section>
      </template>
    </div>
  </div>
</template>
