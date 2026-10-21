<script setup lang="ts">
/**
 * The register of production orders.
 *
 * The state of each order is derived from what has been issued and received
 * against it. The work in progress it carries is the domain's figure.
 */

import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseEmptyState from '@/components/ui/BaseEmptyState.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import FilterBar from '@/components/ui/FilterBar.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import StatTile from '@/components/ui/StatTile.vue'
import {
  buildProductionOrder,
  deriveProductionState,
  workInProgressCost,
} from '@/domain/production'
import { formatQuantity, quantityFromString } from '@/domain/quantity'
import type { ProductionOrder, ProductionOrderState } from '@/domain/types'
import type { ProductionOrderWithDetail } from '@/repositories/contracts'
import { todayIso } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { useSessionStore } from '@/stores/session'
import { useToastStore } from '@/stores/toast'

const router = useRouter()
const session = useSessionStore()
const toast = useToastStore()

const orders = ref<ProductionOrderWithDetail[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const search = ref('')
const stateFilter = ref<'all' | ProductionOrderState>('all')

const currency = computed(() => session.activeCompany?.baseCurrency ?? 'INR')

const STATE_LABEL: Record<ProductionOrderState, string> = {
  draft: 'Draft',
  released: 'Released',
  'in-production': 'In production',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

const STATE_TONE: Record<ProductionOrderState, 'neutral' | 'info' | 'warning' | 'positive' | 'danger'> = {
  draft: 'neutral',
  released: 'info',
  'in-production': 'warning',
  completed: 'positive',
  cancelled: 'danger',
}

const STATE_ICON: Record<ProductionOrderState, string> = {
  draft: 'edit_note',
  released: 'play_circle',
  'in-production': 'precision_manufacturing',
  completed: 'task_alt',
  cancelled: 'cancel',
}

interface ProductionRow {
  id: string
  number: string
  item: string
  plannedMilli: number
  state: ProductionOrderState
  stateLabel: string
  stateTone: 'neutral' | 'info' | 'warning' | 'positive' | 'danger'
  stateIcon: string
  issuedCost: number
  godown: string
  plannedAt: string
}

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

async function load() {
  const companyId = session.activeCompanyId
  if (!companyId) {
    orders.value = []
    loading.value = false
    return
  }
  loading.value = true
  error.value = null
  try {
    const [productionOrders, boms] = await Promise.all([
      session.repository.listProductionOrders(companyId),
      session.repository.listBoms(companyId),
    ])
    orders.value = productionOrders
    structures.value = boms
      .filter((entry) => entry.bom.status === 'released')
      .map((entry) => ({ bom: entry.bom, lines: entry.lines }))
  } catch (cause) {
    error.value =
      cause instanceof Error ? cause.message : 'The production orders could not be loaded.'
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => [session.activeCompanyId, session.activeYearId], load)

const rows = computed<ProductionRow[]>(() =>
  orders.value.map((detail) => {
    const state = deriveProductionState(detail.order, detail.issues, detail.completions)
    return {
      id: detail.order.id,
      number: detail.order.number,
      item: itemNames.value.get(detail.order.itemId) ?? 'Unknown item',
      plannedMilli: detail.order.plannedQuantityMilli,
      state,
      stateLabel: STATE_LABEL[state],
      stateTone: STATE_TONE[state],
      stateIcon: STATE_ICON[state],
      issuedCost: workInProgressCost(detail.issues),
      godown: godownNames.value.get(detail.order.godownId) ?? '—',
      plannedAt: detail.order.plannedAt,
    }
  }),
)

const stateOptions = computed(() => [
  { value: 'all', label: 'All states' },
  ...(['draft', 'released', 'in-production', 'completed', 'cancelled'] as ProductionOrderState[]).map(
    (state) => ({ value: state, label: STATE_LABEL[state] }),
  ),
])

const visibleRows = computed(() => {
  const term = search.value.trim().toLowerCase()
  return rows.value.filter((row) => {
    if (stateFilter.value !== 'all' && row.state !== stateFilter.value) return false
    if (!term) return true
    return row.number.toLowerCase().includes(term) || row.item.toLowerCase().includes(term)
  })
})

const inProductionCount = computed(
  () => rows.value.filter((row) => row.state === 'in-production').length,
)
const completedCount = computed(
  () => rows.value.filter((row) => row.state === 'completed').length,
)
const totalIssuedCost = computed(
  () => rows.value.reduce((sum, row) => sum + row.issuedCost, 0),
)

// ---------------------------------------------------------------------------
// New production order
// ---------------------------------------------------------------------------

const newOpen = ref(false)
const busy = ref(false)
const structures = ref<Array<{ bom: { id: string; itemId: string; version: number }; lines: Array<{ itemId: string }> }>>([])
const newBomId = ref('')
const newQuantity = ref('1')
const newGodownId = ref('')
const newPlannedAt = ref(todayIso())
const newError = ref<string | null>(null)

const structureOptions = computed(() =>
  structures.value.map((structure) => ({
    value: structure.bom.id,
    label: `${itemNames.value.get(structure.bom.itemId) ?? 'Unknown item'} — version ${structure.bom.version}`,
  })),
)

const godownOptions = computed(() =>
  session.godowns.map((godown) => ({ value: godown.id, label: godown.name })),
)

async function openNew() {
  const companyId = session.activeCompanyId
  if (!companyId) return
  newError.value = null
  newQuantity.value = '1'
  newPlannedAt.value = todayIso()
  try {
    const boms = await session.repository.listBoms(companyId)
    structures.value = boms
      .filter((entry) => entry.bom.status === 'released')
      .map((entry) => ({ bom: entry.bom, lines: entry.lines }))
    newBomId.value = structures.value[0]?.bom.id ?? ''
    newGodownId.value = session.godowns[0]?.id ?? ''
    newOpen.value = true
  } catch (cause) {
    toast.error('The structures could not be loaded', messageOf(cause))
  }
}
async function createOrder() {
  const companyId = session.activeCompanyId
  if (!companyId) return
  const structure = structures.value.find((entry) => entry.bom.id === newBomId.value)
  if (!structure) {
    newError.value = 'Choose a released structure to produce against.'
    return
  }
  if (!newGodownId.value) {
    newError.value = 'Choose where the finished goods are received.'
    return
  }
  let plannedQuantityMilli: number
  try {
    plannedQuantityMilli = quantityFromString(newQuantity.value)
    if (plannedQuantityMilli <= 0) throw new Error('The planned quantity must be greater than zero.')
  } catch (cause) {
    newError.value = messageOf(cause)
    return
  }
  newError.value = null

  busy.value = true
  try {
    const order: ProductionOrder = buildProductionOrder(
      {
        itemId: structure.bom.itemId,
        bomId: structure.bom.id,
        plannedQuantityMilli,
        godownId: newGodownId.value,
        plannedAt: newPlannedAt.value,
        narration: '',
      },
      {
        companyId,
        items: new Map(session.items.map((item) => [item.id, item])),
        idFactory: () => `prd-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`,
        now: () => new Date().toISOString(),
      },
    )
    const saved = await session.repository.saveProductionOrder(order, [])
    await session.repository.releaseProductionOrder(companyId, saved.order.id)
    newOpen.value = false
    toast.success('Production order raised', `${order.number || 'The order'} is released against the structure.`)
    await load()
  } catch (cause) {
    toast.error('The production order was not raised', messageOf(cause))
  } finally {
    busy.value = false
  }
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'The request was refused.'
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      title="Production orders"
      subtitle="What is being made, what has been issued and what has been received"
      icon="precision_manufacturing"
    >
      <template #actions>
        <BaseButton
          size="sm"
          variant="outlined"
          icon="account_tree"
          @click="router.push('/production/bom')"
        >
          Bill of materials
        </BaseButton>
        <BaseButton size="sm" variant="primary" icon="add" @click="openNew">
          New production order
        </BaseButton>
      </template>
    </PageHeader>

    <FilterBar>
      <BaseInput
        v-model="search"
        type="search"
        size="sm"
        class="w-56"
        placeholder="Number or item"
      />
      <BaseSelect v-model="stateFilter" :options="stateOptions" size="sm" class="w-44" />
      <span class="text-label-sm text-outline">
        {{ visibleRows.length }} of {{ rows.length }}
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
        <p class="font-semibold">Production orders could not be loaded</p>
        <p class="mt-0.5">{{ error }}</p>
      </div>

      <template v-else>
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Production orders"
            :value="String(rows.length)"
            icon="precision_manufacturing"
            :hint="`${inProductionCount} under way`"
          />
          <StatTile
            label="Completed"
            :value="String(completedCount)"
            icon="task_alt"
            tone="positive"
            hint="Finished goods received"
          />
          <StatTile
            label="Materials issued"
            :value="formatMoney(totalIssuedCost, currency)"
            icon="local_shipping"
            tone="warning"
            hint="The cost the work in progress carries"
          />
          <StatTile
            label="Structures"
            :value="String(structures.length)"
            icon="account_tree"
            tone="info"
            hint="Released structures of this company"
          />
        </div>

        <section class="mt-space-md overflow-hidden rounded-md bg-surface-container-lowest shadow-sm">
          <header class="flex flex-wrap items-center justify-between gap-3 px-space-md py-space-sm">
            <div class="flex items-center gap-space-sm">
              <MaterialIcon name="list_alt" :size="20" class="text-primary" />
              <h2 class="text-headline-sm text-on-surface">Production register</h2>
            </div>
            <BaseBadge tone="neutral" size="xs">{{ rows.length }} orders</BaseBadge>
          </header>

          <div v-if="visibleRows.length" class="overflow-x-auto">
            <table class="w-full text-left text-body-sm">
              <thead
                class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline"
              >
                <tr>
                  <th scope="col" class="px-space-md py-2.5">Number</th>
                  <th scope="col" class="px-space-sm py-2.5">Item</th>
                  <th scope="col" class="px-space-sm py-2.5">Planned</th>
                  <th scope="col" class="px-space-sm py-2.5 text-right">Issued cost</th>
                  <th scope="col" class="px-space-sm py-2.5">Godown</th>
                  <th scope="col" class="px-space-md py-2.5">State</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-surface-container-low">
                <tr
                  v-for="row in visibleRows"
                  :key="row.id"
                  class="cursor-pointer transition-colors hover:bg-surface-container-low/60"
                  @click="router.push(`/production/${row.id}`)"
                >
                  <td class="px-space-md py-2.5 font-semibold text-on-surface">
                    {{ row.number }}
                  </td>
                  <td class="max-w-[240px] truncate px-space-sm py-2.5 text-on-surface">
                    {{ row.item }}
                  </td>
                  <td class="px-space-sm py-2.5 text-right text-numeric-sm tabular text-on-surface">
                    {{ formatQuantity(row.plannedMilli) }}
                  </td>
                  <td class="px-space-sm py-2.5 text-right text-numeric-sm tabular text-on-surface">
                    {{ formatMoney(row.issuedCost, currency) }}
                  </td>
                  <td class="px-space-sm py-2.5 text-on-surface-variant">{{ row.godown }}</td>
                  <td class="px-space-md py-2.5">
                    <BaseBadge :tone="row.stateTone" size="xs" :icon="row.stateIcon">
                      {{ row.stateLabel }}
                    </BaseBadge>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <BaseEmptyState
            v-else
            :title="rows.length ? 'No order matches the filter' : 'No production orders'"
            :description="
              rows.length
                ? 'Adjust the search or the state filter to see the orders of this company.'
                : 'No production order has been raised in this company yet.'
            "
            :icon="MaterialIcon"
          />
        </section>
      </template>
    </div>

    <BaseModal
      :open="newOpen"
      title="New production order"
      description="Raise an order against a released structure and release it."
      size="md"
      @close="newOpen = false"
    >
      <div class="space-y-space-md">
        <BaseSelect
          v-model="newBomId"
          :options="structureOptions"
          label="Structure"
          size="sm"
          hint="Only a released structure can be produced against."
        />
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2">
          <BaseInput
            v-model="newQuantity"
            label="Planned quantity"
            size="sm"
            align="right"
            suffix="units"
          />
          <BaseSelect v-model="newGodownId" :options="godownOptions" label="Godown" size="sm" />
        </div>
        <BaseInput v-model="newPlannedAt" type="date" label="Planned on" size="sm" />
        <p
          v-if="newError"
          class="rounded-sm bg-error-container px-space-sm py-space-xs text-body-sm text-on-error-container"
          role="alert"
        >
          {{ newError }}
        </p>
      </div>

      <template #footer>
        <BaseButton size="sm" variant="text" @click="newOpen = false">Close</BaseButton>
        <BaseButton size="sm" variant="primary" icon="add" :loading="busy" @click="createOrder">
          Raise and release
        </BaseButton>
      </template>
    </BaseModal>
  </div>
</template>
