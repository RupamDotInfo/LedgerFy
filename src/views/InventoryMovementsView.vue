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
import type { InventoryAccounts, StockMovement } from '@/domain/types'
import { formatMoney } from '@/lib/money'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const router = useRouter()

const accounts = ref<InventoryAccounts | null>(null)
const movements = ref<StockMovement[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

const search = ref('')
const itemFilter = ref('')
const godownFilter = ref('')
const typeFilter = ref('')
const fromDate = ref('')
const toDate = ref('')

const currency = computed(() => session.activeCompany?.baseCurrency ?? 'INR')

async function load() {
  const companyId = session.activeCompanyId
  if (!companyId) {
    movements.value = []
    accounts.value = null
    loading.value = false
    return
  }
  loading.value = true
  error.value = null
  try {
    const [loadedAccounts, loadedMovements] = await Promise.all([
      session.repository.getInventoryAccounts(companyId),
      session.repository.listStockMovements(companyId),
    ])
    accounts.value = loadedAccounts
    movements.value = loadedMovements
  } catch (cause) {
    error.value =
      cause instanceof Error ? cause.message : 'The movement ledger could not be loaded.'
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

const typeOptions = computed(() => {
  const seen = new Set(movements.value.map((movement) => movement.movementType))
  return [
    { value: '', label: 'All movement types' },
    ...[...seen]
      .sort()
      .map((type) => ({ value: type, label: movementLabel(type) })),
  ]
})

// ---------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------

type LedgerRow = {
  id: string
  date: string
  itemId: string
  itemName: string
  voucherId: string
  voucherNumber: string
  movementType: string
  movementLabel: string
  godownName: string
  direction: 'in' | 'out'
  quantityMilli: number
  rate: number
  value: number
  cost: number
  isOpening: boolean
}

const ledgerRows = computed<LedgerRow[]>(() => {
  const term = search.value.trim().toLowerCase()
  const rows: LedgerRow[] = []

  for (const movement of movements.value) {
    if (itemFilter.value && movement.itemId !== itemFilter.value) continue
    if (godownFilter.value && movement.godownId !== godownFilter.value) continue
    if (typeFilter.value && movement.movementType !== typeFilter.value) continue
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
      voucherId: movement.voucherId,
      voucherNumber: movement.voucherNumber,
      movementType: movement.movementType,
      movementLabel: movementLabel(movement.movementType),
      godownName: movement.godownId
        ? (godownNames.value.get(movement.godownId) ?? 'Unknown')
        : '—',
      direction: movement.direction,
      quantityMilli: movement.quantityMilli,
      rate: movement.rate,
      value: movement.value,
      cost: movement.cost,
      isOpening: movement.movementType === 'opening',
    })
  }

  rows.sort((left, right) => {
    if (left.date !== right.date) return left.date < right.date ? 1 : -1
    return left.id < right.id ? 1 : -1
  })
  return rows
})

const totalIn = computed(() =>
  ledgerRows.value
    .filter((row) => row.direction === 'in')
    .reduce((sum, row) => sum + row.quantityMilli, 0),
)
const totalOut = computed(() =>
  ledgerRows.value
    .filter((row) => row.direction === 'out')
    .reduce((sum, row) => sum + row.quantityMilli, 0),
)
const totalValue = computed(() =>
  ledgerRows.value.reduce((sum, row) => sum + row.value, 0),
)

const columns: TableColumn[] = [
  { key: 'date', label: 'Date', sortable: true },
  { key: 'voucherNumber', label: 'Voucher', sortable: true },
  { key: 'itemName', label: 'Item', sortable: true },
  { key: 'movementLabel', label: 'Type' },
  { key: 'godownName', label: 'Location' },
  { key: 'quantityMilli', label: 'Quantity', align: 'right', numeric: true, sortable: true },
  { key: 'rate', label: 'Rate', align: 'right', numeric: true },
  { key: 'value', label: 'Value', align: 'right', numeric: true, sortable: true },
  { key: 'cost', label: 'Cost of issue', align: 'right', numeric: true },
]
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      title="Stock movements"
      subtitle="The raw movement ledger: every change of quantity, with the rate and value it carried"
      icon="swap_vert"
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
          icon="receipt_long"
          @click="router.push('/inventory/register')"
        >
          Stock register
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
      <BaseSelect v-model="typeFilter" :options="typeOptions" size="sm" class="w-48" />
      <BaseInput v-model="fromDate" type="date" size="sm" class="w-40" label="From" />
      <BaseInput v-model="toDate" type="date" size="sm" class="w-40" label="To" />
    </FilterBar>

    <div class="min-h-0 flex-1 overflow-auto p-space-lg">
      <div v-if="loading" class="space-y-space-md">
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-3">
          <BaseSkeleton v-for="index in 3" :key="index" class="h-24" />
        </div>
        <BaseSkeleton class="h-72" />
      </div>

      <div
        v-else-if="error"
        class="rounded-md border-l-4 border-l-error bg-error-container p-space-md text-body-md text-on-error-container"
        role="alert"
      >
        <p class="font-semibold">Movement ledger could not be loaded</p>
        <p class="mt-0.5">{{ error }}</p>
      </div>

      <section v-else-if="!accounts" class="rounded-md bg-surface-container-lowest p-space-lg shadow-sm">
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
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-3">
          <StatTile
            label="Quantity in"
            :value="formatQuantity(totalIn)"
            icon="south"
            tone="info"
            hint="Stock that came in, over the period shown"
          />
          <StatTile
            label="Quantity out"
            :value="formatQuantity(totalOut)"
            icon="north"
            tone="warning"
            hint="Stock that went out, over the period shown"
          />
          <StatTile
            label="Value of the movements"
            :value="formatMoney(totalValue, currency)"
            icon="payments"
            hint="Value at cost, over the period shown"
          />
        </div>

        <section class="mt-space-md overflow-hidden rounded-md bg-surface-container-lowest shadow-sm">
          <header class="flex flex-wrap items-center justify-between gap-3 px-space-md py-space-sm">
            <div class="flex items-center gap-space-sm">
              <MaterialIcon name="table_view" :size="20" class="text-primary" />
              <h2 class="text-headline-sm text-on-surface">Movement ledger</h2>
            </div>
            <span class="text-label-xs text-outline">{{ ledgerRows.length }} movements</span>
          </header>

          <DataTable
            v-if="ledgerRows.length"
            :columns="columns"
            :rows="ledgerRows"
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
            <template #cell:quantityMilli="{ row }">
              <span :class="row.direction === 'in' ? 'text-secondary' : 'text-tertiary'">
                {{ row.direction === 'in' ? '+' : '−' }}{{ formatQuantity(row.quantityMilli) }}
              </span>
            </template>
            <template #cell:rate="{ row }">
              {{ formatMoney(row.rate, currency) }}
            </template>
            <template #cell:value="{ row }">
              {{ formatMoney(row.value, currency) }}
            </template>
            <template #cell:cost="{ row }">
              {{ row.cost ? formatMoney(row.cost, currency) : '—' }}
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
            Quantities are exact milli-units. The rate is the purchase cost for a receipt and the
            weighted-average cost for an issue.
          </footer>
        </section>
      </template>
    </div>
  </div>
</template>
