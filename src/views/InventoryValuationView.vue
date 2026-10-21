<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

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
import { computeLedgerBalances } from '@/domain/accounting'
import { averageCost, formatQuantity } from '@/domain/quantity'
import type { InventoryAccounts, StockPoolBalance, Voucher } from '@/domain/types'
import { todayIso } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const router = useRouter()

const accounts = ref<InventoryAccounts | null>(null)
const pools = ref<StockPoolBalance[]>([])
const vouchers = ref<Voucher[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const groupFilter = ref('')

const currency = computed(() => session.activeCompany?.baseCurrency ?? 'INR')
const reportingDate = computed(() => todayIso())
const valuationMethod = computed(() => accounts.value?.valuationMethod ?? 'moving-weighted-average')

async function load() {
  const companyId = session.activeCompanyId
  if (!companyId) {
    accounts.value = null
    pools.value = []
    vouchers.value = []
    loading.value = false
    return
  }
  loading.value = true
  error.value = null
  try {
    const [loadedAccounts, loadedPools, loadedVouchers] = await Promise.all([
      session.repository.getInventoryAccounts(companyId),
      session.repository.listStockPools(companyId),
      session.repository.listVouchers(companyId),
    ])
    accounts.value = loadedAccounts
    pools.value = loadedPools
    vouchers.value = loadedVouchers
  } catch (cause) {
    error.value =
      cause instanceof Error ? cause.message : 'The valuation could not be loaded.'
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

const groupOptions = computed(() => [
  { value: '', label: 'All groups' },
  ...session.stockGroups.map((group) => ({ value: group.id, label: group.name })),
])

// ---------------------------------------------------------------------------
// Valuation
// ---------------------------------------------------------------------------

type ValuationRow = {
  id: string
  name: string
  group: string
  unit: string
  quantityMilli: number
  /** The weighted-average unit cost of the item, in minor units. */
  unitCost: number
  carryingValue: number
  /** The share of the total carrying value. */
  share: number
}

const valuationRows = computed<ValuationRow[]>(() => {
  const poolByItem = new Map(pools.value.map((pool) => [pool.itemId, pool]))
  const total = pools.value.reduce((sum, pool) => sum + pool.carryingValue, 0)

  const rows: ValuationRow[] = session.items
    .filter((item) => item.isInventory)
    .filter((item) => !groupFilter.value || item.stockGroupId === groupFilter.value)
    .map((item) => {
      const pool = poolByItem.get(item.id)
      const quantityMilli = pool?.quantityMilli ?? 0
      const carryingValue = pool?.carryingValue ?? 0
      return {
        id: item.id,
        name: item.name,
        group: groupNames.value.get(item.stockGroupId) ?? 'Ungrouped',
        unit: unitNames.value.get(item.unitId) ?? '',
        quantityMilli,
        unitCost: averageCost(carryingValue, quantityMilli),
        carryingValue,
        share: total === 0 ? 0 : (carryingValue / total) * 100,
      }
    })

  rows.sort((left, right) => right.carryingValue - left.carryingValue)
  return rows
})

const totalCarryingValue = computed(() =>
  valuationRows.value.reduce((sum, row) => sum + row.carryingValue, 0),
)

/**
 * The carrying value the books carry, compared with the inventory asset
 * ledger. The two must agree: stock that is not in the ledger is not in the
 * books.
 */
const ledgerComparison = computed(() => {
  const ledger = session.ledgers.find(
    (candidate) => candidate.id === accounts.value?.inventoryLedgerId,
  )
  if (!ledger) return null
  const balances = computeLedgerBalances(session.ledgers, vouchers.value, {
    to: reportingDate.value,
  })
  const balance = balances.find((entry) => entry.ledger.id === ledger.id)
  const ledgerValue = balance?.closing ?? 0
  const difference = totalCarryingValue.value - ledgerValue
  return { ledgerName: ledger.name, ledgerValue, difference }
})

const columns: TableColumn[] = [
  { key: 'name', label: 'Item', sortable: true },
  { key: 'group', label: 'Group', sortable: true },
  { key: 'quantityMilli', label: 'Quantity', align: 'right', numeric: true, sortable: true },
  { key: 'unit', label: 'Unit' },
  { key: 'unitCost', label: 'Cost basis', align: 'right', numeric: true, sortable: true },
  { key: 'carryingValue', label: 'Carrying value', align: 'right', numeric: true, sortable: true },
  { key: 'share', label: 'Share', align: 'right', numeric: true },
]
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      title="Stock valuation"
      subtitle="What the stock on hand is worth, at the cost it was bought at"
      icon="query_stats"
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
      <BaseSelect v-model="groupFilter" :options="groupOptions" size="sm" class="w-56" />
      <span class="text-label-sm text-outline">
        Method: {{ valuationMethod }} · Reporting date: {{ reportingDate }}
      </span>
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
        <p class="font-semibold">Valuation could not be loaded</p>
        <p class="mt-0.5">{{ error }}</p>
      </div>

      <section v-else-if="!accounts" class="rounded-md bg-surface-container-lowest p-space-lg shadow-sm">
        <BaseEmptyState
          title="Inventory is not activated for this company"
          description="Without inventory there is no costing pool and nothing to value. Activate inventory to start valuing stock."
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
            label="Total carrying value"
            :value="formatMoney(totalCarryingValue, currency)"
            icon="inventory_2"
            tone="info"
            :hint="`As at ${reportingDate} · ${valuationMethod}`"
          />
          <StatTile
            label="Items valued"
            :value="String(valuationRows.length)"
            icon="category"
            hint="Stock-tracked items with a costing pool"
          />
          <StatTile
            v-if="ledgerComparison"
            label="Inventory asset ledger"
            :value="formatMoney(ledgerComparison.ledgerValue, currency)"
            icon="account_balance"
            :hint="
              ledgerComparison.difference === 0
                ? 'Agrees with the carrying value of the stock'
                : 'Differs from the carrying value of the stock'
            "
          />
        </div>

        <!-- The ledger and the stock must agree. -->
        <div
          v-if="ledgerComparison"
          class="mt-space-md flex flex-wrap items-center gap-space-sm rounded-md px-space-md py-space-sm"
          :class="
            ledgerComparison.difference === 0
              ? 'bg-secondary-container text-on-secondary-container'
              : 'bg-tertiary-fixed text-on-tertiary-fixed'
          "
          role="status"
        >
          <MaterialIcon
            :name="ledgerComparison.difference === 0 ? 'check_circle' : 'warning'"
            :size="20"
          />
          <p class="text-body-sm">
            <template v-if="ledgerComparison.difference === 0">
              The carrying value of the stock agrees with the
              {{ ledgerComparison.ledgerName }} ledger.
            </template>
            <template v-else>
              The carrying value of the stock and the
              {{ ledgerComparison.ledgerName }} ledger differ by
              {{ formatMoney(ledgerComparison.difference, currency) }}. The difference is
              reported here and is not adjusted silently.
            </template>
          </p>
        </div>

        <section class="mt-space-md overflow-hidden rounded-md bg-surface-container-lowest shadow-sm">
          <header class="flex flex-wrap items-center justify-between gap-3 px-space-md py-space-sm">
            <div class="flex items-center gap-space-sm">
              <MaterialIcon name="table_view" :size="20" class="text-primary" />
              <h2 class="text-headline-sm text-on-surface">Valuation by item</h2>
            </div>
            <span class="text-label-xs text-outline">{{ valuationRows.length }} items</span>
          </header>

          <DataTable
            v-if="valuationRows.length"
            :columns="columns"
            :rows="valuationRows"
            row-key="id"
            :clickable="false"
            empty-title="No stock to value"
            empty-description="This company holds no stock in the selected group."
          >
            <template #cell:name="{ row }">
              <span class="font-medium text-on-surface">{{ row.name }}</span>
            </template>
            <template #cell:unit="{ row }">
              <span class="text-label-sm text-outline">{{ row.unit }}</span>
            </template>
            <template #cell:quantityMilli="{ row }">
              {{ formatQuantity(row.quantityMilli) }}
            </template>
            <template #cell:unitCost="{ row }">
              {{ formatMoney(row.unitCost, currency) }}
            </template>
            <template #cell:carryingValue="{ row }">
              <span class="font-bold">{{ formatMoney(row.carryingValue, currency) }}</span>
            </template>
            <template #cell:share="{ row }">
              {{ row.share.toFixed(1) }}%
            </template>
          </DataTable>

          <BaseEmptyState
            v-else
            title="No stock to value"
            description="This company holds no stock in the selected group."
            :icon="MaterialIcon"
          />

          <footer
            class="border-t border-surface-container bg-surface-container-low/60 px-space-md py-space-sm text-label-xs text-outline"
          >
            <p>
              Method: {{ valuationMethod }} · Reporting date: {{ reportingDate }} · The cost basis
              is the weighted-average cost of the company's costing pool for the item. It is the
              cost the stock was bought at, never the selling price.
            </p>
            <p class="mt-1">
              Not implemented yet: net realisable value as a lower limit on the carrying value,
              and the FIFO and LIFO costing methods. Only the moving weighted-average method
              described in the inventory accounting policy is available.
            </p>
          </footer>
        </section>
      </template>
    </div>
  </div>
</template>
