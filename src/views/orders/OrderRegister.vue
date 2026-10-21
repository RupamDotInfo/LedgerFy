<script setup lang="ts">
/**
 * The register of sales or purchase orders.
 *
 * The rows come from the repository and the state of each row is derived from
 * the deliveries recorded against it. Nothing is inferred from the text of an
 * invoice.
 */

import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseEmptyState from '@/components/ui/BaseEmptyState.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import FilterBar from '@/components/ui/FilterBar.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import StatTile from '@/components/ui/StatTile.vue'
import type { OrderKind, OrderState } from '@/domain/types'
import { formatDate } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { useSessionStore } from '@/stores/session'
import { orderFigures, ORDER_STATE_LABEL, type OrderFigures } from '@/views/orders/orderFigures'

const props = defineProps<{ kind: OrderKind }>()

const session = useSessionStore()
const router = useRouter()

interface OrderRow {
  id: string
  number: string
  party: string
  date: string
  expectedDate: string | null
  figures: OrderFigures
}

const rows = ref<OrderRow[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const search = ref('')
const stateFilter = ref<'all' | OrderState>('all')

const isSales = computed(() => props.kind === 'sales')
const title = computed(() => (isSales.value ? 'Sales orders' : 'Purchase orders'))
const subtitle = computed(() =>
  isSales.value
    ? 'Orders placed with customers and what has been delivered against them'
    : 'Orders placed with suppliers and what has been received against them',
)
const currency = computed(() => session.activeCompany?.baseCurrency ?? 'INR')

const stateOptions = computed(() => [
  { value: 'all', label: 'All states' },
  ...(['draft', 'open', 'partially-fulfilled', 'fulfilled', 'cancelled'] as OrderState[]).map(
    (state) => ({ value: state, label: ORDER_STATE_LABEL[state] }),
  ),
])

const partyNames = computed(() => {
  const map = new Map<string, string>()
  for (const ledger of session.ledgers) map.set(ledger.id, ledger.name)
  return map
})

async function load() {
  const companyId = session.activeCompanyId
  if (!companyId) {
    rows.value = []
    loading.value = false
    return
  }
  loading.value = true
  error.value = null
  try {
    const orders = await session.repository.listOrders(companyId, props.kind)
    rows.value = orders.map((entry) => ({
      id: entry.order.id,
      number: entry.order.number,
      party: entry.order.partyId
        ? (partyNames.value.get(entry.order.partyId) ?? 'Unknown party')
        : '—',
      date: entry.order.date,
      expectedDate: entry.order.expectedDate,
      figures: orderFigures(entry.order, entry.lines, entry.fulfilments),
    }))
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'The orders could not be loaded.'
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => [session.activeCompanyId, session.activeYearId], load)
watch(() => session.ledgers, load)

const visibleRows = computed(() => {
  const term = search.value.trim().toLowerCase()
  return rows.value.filter((row) => {
    if (stateFilter.value !== 'all' && row.figures.state !== stateFilter.value) return false
    if (!term) return true
    return (
      row.number.toLowerCase().includes(term) || row.party.toLowerCase().includes(term)
    )
  })
})

const openCount = computed(
  () => rows.value.filter((row) => row.figures.state === 'open').length,
)
const partCount = computed(
  () => rows.value.filter((row) => row.figures.state === 'partially-fulfilled').length,
)
const orderedValue = computed(() => rows.value.reduce((sum, row) => sum + row.figures.orderedValue, 0))
const deliveredValue = computed(
  () => rows.value.reduce((sum, row) => sum + row.figures.deliveredValue, 0),
)
const remainingValue = computed(
  () => rows.value.reduce((sum, row) => sum + row.figures.remainingValue, 0),
)

function openOrder(row: OrderRow) {
  router.push(isSales.value ? `/orders/${row.id}` : `/orders/purchase/${row.id}`)
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader :title="title" :subtitle="subtitle" icon="playlist_add_check">
      <template #actions>
        <BaseButton
          v-if="isSales"
          size="sm"
          variant="outlined"
          icon="receipt_long"
          @click="router.push('/sales')"
        >
          Sales invoices
        </BaseButton>
        <BaseButton
          v-else
          size="sm"
          variant="outlined"
          icon="shopping_cart"
          @click="router.push('/purchases')"
        >
          Purchase vouchers
        </BaseButton>
      </template>
    </PageHeader>

    <FilterBar>
      <BaseInput
        v-model="search"
        type="search"
        size="sm"
        class="w-56"
        placeholder="Number or party"
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
        <p class="font-semibold">{{ title }} could not be loaded</p>
        <p class="mt-0.5">{{ error }}</p>
      </div>

      <template v-else>
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Open orders"
            :value="String(openCount)"
            icon="pending_actions"
            tone="info"
            :hint="`${partCount} partly delivered`"
          />
          <StatTile
            label="Ordered value"
            :value="formatMoney(orderedValue, currency)"
            icon="receipt_long"
            hint="Item value before tax"
          />
          <StatTile
            label="Delivered value"
            :value="formatMoney(deliveredValue, currency)"
            icon="task_alt"
            tone="positive"
            hint="Value of the deliveries recorded"
          />
          <StatTile
            label="Still to deliver"
            :value="formatMoney(remainingValue, currency)"
            icon="local_shipping"
            tone="warning"
            hint="Ordered value less what was delivered"
          />
        </div>

        <section class="mt-space-md overflow-hidden rounded-md bg-surface-container-lowest shadow-sm">
          <header class="flex flex-wrap items-center justify-between gap-3 px-space-md py-space-sm">
            <div class="flex items-center gap-space-sm">
              <MaterialIcon name="list_alt" :size="20" class="text-primary" />
              <h2 class="text-headline-sm text-on-surface">Order register</h2>
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
                  <th scope="col" class="px-space-sm py-2.5">Party</th>
                  <th scope="col" class="px-space-sm py-2.5">Date</th>
                  <th scope="col" class="px-space-sm py-2.5">Expected</th>
                  <th scope="col" class="px-space-sm py-2.5 text-right">Ordered</th>
                  <th scope="col" class="px-space-sm py-2.5 text-right">Delivered</th>
                  <th scope="col" class="px-space-sm py-2.5 text-right">Remaining</th>
                  <th scope="col" class="px-space-md py-2.5">State</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-surface-container-low">
                <tr
                  v-for="row in visibleRows"
                  :key="row.id"
                  class="cursor-pointer transition-colors hover:bg-surface-container-low/60"
                  @click="openOrder(row)"
                >
                  <td class="px-space-md py-2.5 font-semibold text-on-surface">
                    {{ row.number }}
                  </td>
                  <td class="max-w-[240px] truncate px-space-sm py-2.5 text-on-surface">
                    {{ row.party }}
                  </td>
                  <td class="whitespace-nowrap px-space-sm py-2.5 text-numeric-sm tabular text-outline">
                    {{ formatDate(row.date) }}
                  </td>
                  <td class="whitespace-nowrap px-space-sm py-2.5 text-numeric-sm tabular text-outline">
                    {{ row.expectedDate ? formatDate(row.expectedDate) : '—' }}
                  </td>
                  <td class="px-space-sm py-2.5 text-right text-numeric-sm tabular text-on-surface">
                    {{ formatMoney(row.figures.orderedValue, currency) }}
                  </td>
                  <td class="px-space-sm py-2.5 text-right text-numeric-sm tabular text-on-surface">
                    {{ formatMoney(row.figures.deliveredValue, currency) }}
                  </td>
                  <td class="px-space-sm py-2.5 text-right text-numeric-sm font-semibold tabular text-on-surface">
                    {{ formatMoney(row.figures.remainingValue, currency) }}
                  </td>
                  <td class="px-space-md py-2.5">
                    <BaseBadge :tone="row.figures.stateTone" size="xs" :icon="row.figures.stateIcon">
                      {{ row.figures.stateLabel }}
                    </BaseBadge>
                    <span class="ml-2 text-label-xs tabular text-outline">
                      {{ row.figures.deliveryCount }} deliveries
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <BaseEmptyState
            v-else
            :title="rows.length ? 'No order matches the filter' : `No ${isSales ? 'sales' : 'purchase'} orders`"
            :description="
              rows.length
                ? 'Adjust the search or the state filter to see the orders of this company.'
                : `No ${isSales ? 'sales' : 'purchase'} order has been raised in this company yet.`
            "
            :icon="MaterialIcon"
          />

          <footer
            v-if="visibleRows.length"
            class="flex flex-wrap items-center justify-between gap-2 border-t border-surface-container bg-surface-container-low/60 px-space-md py-space-sm"
          >
            <span class="text-label-sm text-outline">
              Open an order to see its lines, its deliveries and its history.
            </span>
            <span class="text-numeric-md font-bold tabular text-on-surface">
              {{ formatMoney(orderedValue, currency) }}
            </span>
          </footer>
        </section>
      </template>
    </div>
  </div>
</template>
