<script setup lang="ts">
/**
 * One order, with its lines, its deliveries and its history.
 *
 * The state shown is derived from the deliveries. The actions are the domain's
 * own: confirming, amending and cancelling are refused by the domain when the
 * rules are not met, and the refusal is shown as it was given.
 */

import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseEmptyState from '@/components/ui/BaseEmptyState.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import StatTile from '@/components/ui/StatTile.vue'
import { prepareOrderAmendment, type OrderContext } from '@/domain/orders'
import { formatQuantity, quantityFromString } from '@/domain/quantity'
import type { Order, OrderFulfilment, OrderLine, Voucher } from '@/domain/types'
import { formatDate, formatDateTime } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { useSessionStore } from '@/stores/session'
import { useToastStore } from '@/stores/toast'
import { orderFigures } from '@/views/orders/orderFigures'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const toast = useToastStore()

const order = ref<Order | null>(null)
const lines = ref<OrderLine[]>([])
const fulfilments = ref<OrderFulfilment[]>([])
const revisions = ref<Array<{ id: string; revision: number; reason: string; actor: string; createdAt: string }>>([])
const deliveryVouchers = ref<Record<string, Voucher>>({})
const loading = ref(true)
const error = ref<string | null>(null)
const busy = ref(false)

const orderId = computed(() => String(route.params.id ?? ''))
const currency = computed(() => session.activeCompany?.baseCurrency ?? 'INR')

const partyName = computed(() => {
  if (!order.value?.partyId) return '—'
  return session.ledgers.find((ledger) => ledger.id === order.value?.partyId)?.name ?? 'Unknown party'
})

const figures = computed(() =>
  order.value ? orderFigures(order.value, lines.value, fulfilments.value) : null,
)

const itemNames = computed(() => {
  const map = new Map<string, string>()
  for (const item of session.items) map.set(item.id, item.name)
  return map
})

async function load() {
  const companyId = session.activeCompanyId
  if (!companyId || !orderId.value) {
    loading.value = false
    return
  }
  loading.value = true
  error.value = null
  try {
    const detail = await session.repository.getOrder(companyId, orderId.value)
    if (!detail) {
      order.value = null
      error.value = 'That order no longer exists.'
      return
    }
    order.value = detail.order
    lines.value = detail.lines
    fulfilments.value = detail.fulfilments
    revisions.value = detail.revisions

    const vouchers = await Promise.all(
      [...new Set(detail.fulfilments.map((fulfilment) => fulfilment.voucherId))].map((voucherId) =>
        session.repository.getVoucher(companyId, voucherId),
      ),
    )
    const map: Record<string, Voucher> = {}
    vouchers.forEach((voucher) => {
      if (voucher) map[voucher.id] = voucher
    })
    deliveryVouchers.value = map
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'The order could not be loaded.'
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => [session.activeCompanyId, orderId.value], load)

const isSales = computed(() => order.value?.kind === 'sales')
/** The register this order was opened from, which is the route it sits on. */
const registerPath = computed(() =>
  route.meta.orderKind === 'purchase' ? '/orders/purchase' : '/orders',
)
const canConfirm = computed(() => order.value?.status === 'draft')
const canAmend = computed(() => order.value?.status === 'confirmed')
const canCancel = computed(() => order.value?.status !== 'cancelled' && fulfilments.value.length === 0)
const canInvoice = computed(
  () => order.value?.status === 'confirmed' && fulfilments.value.length < lines.value.length,
)

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function confirm() {
  const companyId = session.activeCompanyId
  if (!companyId) return
  busy.value = true
  try {
    await session.repository.confirmOrder(companyId, orderId.value)
    toast.success('Order confirmed', `${order.value?.number ?? 'The order'} is now open for delivery.`)
    await load()
  } catch (cause) {
    toast.error('The order was not confirmed', messageOf(cause))
  } finally {
    busy.value = false
  }
}

function raiseVoucher() {
  if (!order.value) return
  // The standard voucher entry screen is seeded from the order, so the party,
  // the items, what is still to be delivered, the rates and the tax
  // treatment all carry across, and posting records the delivery.
  const path = isSales.value
    ? `/vouchers/new/sales?order=${order.value.id}`
    : `/vouchers/new/purchase?order=${order.value.id}`
  router.push(path)
}

// -- Amend ------------------------------------------------------------------

const amendOpen = ref(false)
const amendReason = ref('')
const amendReasonError = ref<string | null>(null)
const amendQuantities = ref<Record<string, string>>({})

function openAmend() {
  const draft: Record<string, string> = {}
  for (const line of lines.value) draft[line.id] = String(line.quantityMilli / 1000)
  amendQuantities.value = draft
  amendReason.value = ''
  amendReasonError.value = null
  amendOpen.value = true
}

async function saveAmendment() {
  const companyId = session.activeCompanyId
  if (!companyId || !order.value) return
  if (!amendReason.value.trim()) {
    amendReasonError.value = 'An amendment needs a reason, so that the history says why.'
    return
  }
  amendReasonError.value = null

  const inputs: OrderLine[] = []
  try {
    for (const line of lines.value) {
      const typed = amendQuantities.value[line.id]
      const quantityMilli = quantityFromString(typed ?? '')
      if (quantityMilli <= 0) {
        throw new Error('An ordered quantity must be greater than zero.')
      }
      inputs.push({
        ...line,
        quantityMilli,
      })
    }
  } catch (cause) {
    toast.error('The amendment was not saved', messageOf(cause))
    return
  }

  busy.value = true
  try {
    const context: OrderContext = {
      companyId,
      items: new Map(session.items.map((item) => [item.id, item])),
      idFactory: () => `amend-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`,
      now: () => new Date().toISOString(),
    }
    const amendment = prepareOrderAmendment(
      order.value,
      lines.value,
      fulfilments.value,
      { lines: inputs, reason: amendReason.value },
      context,
    )
    await session.repository.amendOrder(companyId, orderId.value, amendment.lines, amendReason.value)
    amendOpen.value = false
    toast.success('Order amended', `${order.value.number} now carries the new quantities.`)
    await load()
  } catch (cause) {
    toast.error('The order was not amended', messageOf(cause))
  } finally {
    busy.value = false
  }
}

// -- Cancel -----------------------------------------------------------------

const cancelOpen = ref(false)
const cancelReason = ref('')
const cancelReasonError = ref<string | null>(null)

function openCancel() {
  cancelReason.value = ''
  cancelReasonError.value = null
  cancelOpen.value = true
}

async function confirmCancel() {
  const companyId = session.activeCompanyId
  if (!companyId) return
  if (!cancelReason.value.trim()) {
    cancelReasonError.value = 'Say why the order is being cancelled.'
    return
  }
  cancelReasonError.value = null
  busy.value = true
  try {
    await session.repository.cancelOrder(companyId, orderId.value, cancelReason.value)
    cancelOpen.value = false
    toast.success('Order cancelled', `${order.value?.number ?? 'The order'} has been cancelled.`)
    await load()
  } catch (cause) {
    toast.error('The order was not cancelled', messageOf(cause))
  } finally {
    busy.value = false
  }
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'The request was refused.'
}

function deliveredFor(line: OrderLine): number {
  return fulfilments.value
    .filter((fulfilment) => fulfilment.orderLineId === line.id)
    .reduce((sum, fulfilment) => sum + fulfilment.quantityMilli, 0)
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      :title="order?.number ?? 'Order'"
      :subtitle="`${isSales ? 'Sales order' : 'Purchase order'} · ${partyName}`"
      :icon="isSales ? 'playlist_add_check' : 'shopping_cart'"
    >
      <template #actions>
        <BaseButton
          size="sm"
          variant="text"
          icon="arrow_back"
          @click="router.push(registerPath)"
        >
          Register
        </BaseButton>
        <BaseButton
          v-if="canInvoice"
          size="sm"
          variant="primary"
          icon="receipt_long"
          @click="raiseVoucher"
        >
          {{ isSales ? 'Create invoice' : 'Create purchase voucher' }}
        </BaseButton>
        <BaseButton v-if="canConfirm" size="sm" variant="primary" icon="check" :loading="busy" @click="confirm">
          Confirm
        </BaseButton>
        <BaseButton v-if="canAmend" size="sm" variant="outlined" icon="edit" @click="openAmend">
          Amend
        </BaseButton>
        <BaseButton
          v-if="canCancel"
          size="sm"
          variant="danger"
          icon="cancel"
          @click="openCancel"
        >
          Cancel
        </BaseButton>
      </template>
    </PageHeader>

    <div class="min-h-0 flex-1 overflow-auto p-space-lg">
      <div v-if="loading" class="space-y-space-md">
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-4">
          <BaseSkeleton v-for="index in 4" :key="index" class="h-24" />
        </div>
        <BaseSkeleton class="h-64" />
      </div>

      <div
        v-else-if="error"
        class="rounded-md border-l-4 border-l-error bg-error-container p-space-md text-body-md text-on-error-container"
        role="alert"
      >
        <p class="font-semibold">The order could not be opened</p>
        <p class="mt-0.5">{{ error }}</p>
      </div>

      <template v-else-if="order && figures">
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Ordered value"
            :value="formatMoney(figures.orderedValue, currency)"
            icon="receipt_long"
            hint="Value of the lines as ordered"
          />
          <StatTile
            label="Delivered value"
            :value="formatMoney(figures.deliveredValue, currency)"
            icon="task_alt"
            tone="positive"
            hint="Value of the recorded deliveries"
          />
          <StatTile
            label="Still to deliver"
            :value="formatMoney(figures.remainingValue, currency)"
            icon="local_shipping"
            tone="warning"
            hint="Ordered value less what was delivered"
          />
          <StatTile
            label="State"
            :value="figures.stateLabel"
            :icon="figures.stateIcon"
            :tone="figures.stateTone === 'neutral' ? 'default' : figures.stateTone === 'danger' ? 'danger' : figures.stateTone"
            :hint="`${figures.deliveryCount} deliveries recorded`"
          />
        </div>

        <section class="mt-space-md overflow-hidden rounded-md bg-surface-container-lowest shadow-sm">
          <header class="flex flex-wrap items-center justify-between gap-3 px-space-md py-space-sm">
            <div class="flex items-center gap-space-sm">
              <MaterialIcon name="receipt_long" :size="20" class="text-primary" />
              <h2 class="text-headline-sm text-on-surface">Order lines</h2>
            </div>
            <BaseBadge :tone="figures.stateTone" size="xs" :icon="figures.stateIcon">
              {{ figures.stateLabel }}
            </BaseBadge>
          </header>

          <div class="overflow-x-auto">
            <table class="w-full text-left text-body-sm">
              <thead
                class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline"
              >
                <tr>
                  <th scope="col" class="px-space-md py-2.5">Item</th>
                  <th scope="col" class="px-space-sm py-2.5 text-right">Ordered</th>
                  <th scope="col" class="px-space-sm py-2.5 text-right">Delivered</th>
                  <th scope="col" class="px-space-sm py-2.5 text-right">Remaining</th>
                  <th scope="col" class="px-space-sm py-2.5 text-right">Rate</th>
                  <th scope="col" class="px-space-md py-2.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-surface-container-low">
                <tr v-for="line in lines" :key="line.id">
                  <td class="px-space-md py-2.5 text-on-surface">
                    {{ itemNames.get(line.itemId) ?? 'Unknown item' }}
                  </td>
                  <td class="px-space-sm py-2.5 text-right text-numeric-sm tabular text-on-surface">
                    {{ formatQuantity(line.quantityMilli) }}
                  </td>
                  <td class="px-space-sm py-2.5 text-right text-numeric-sm tabular text-on-surface">
                    {{ formatQuantity(deliveredFor(line)) }}
                  </td>
                  <td class="px-space-sm py-2.5 text-right text-numeric-sm font-semibold tabular text-on-surface">
                    {{ formatQuantity(Math.max(0, line.quantityMilli - deliveredFor(line))) }}
                  </td>
                  <td class="px-space-sm py-2.5 text-right text-numeric-sm tabular text-on-surface-variant">
                    {{ formatMoney(line.rate, currency) }}
                  </td>
                  <td class="px-space-md py-2.5 text-right text-numeric-sm font-semibold tabular text-on-surface">
                    {{ formatMoney(line.amount, currency) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <footer
            class="flex flex-wrap items-center justify-between gap-2 border-t border-surface-container bg-surface-container-low/60 px-space-md py-space-sm"
          >
            <span class="text-label-sm text-outline">
              {{ order.date }}<span v-if="order.expectedDate"> · expected {{ order.expectedDate }}</span>
            </span>
            <span class="text-numeric-md font-bold tabular text-on-surface">
              {{ formatMoney(figures.orderedValue, currency) }}
            </span>
          </footer>
        </section>

        <section class="mt-space-md overflow-hidden rounded-md bg-surface-container-lowest shadow-sm">
          <header class="flex flex-wrap items-center justify-between gap-3 px-space-md py-space-sm">
            <div class="flex items-center gap-space-sm">
              <MaterialIcon name="local_shipping" :size="20" class="text-primary" />
              <h2 class="text-headline-sm text-on-surface">Deliveries</h2>
            </div>
            <BaseBadge tone="neutral" size="xs">{{ fulfilments.length }}</BaseBadge>
          </header>

          <div v-if="fulfilments.length" class="overflow-x-auto">
            <table class="w-full text-left text-body-sm">
              <thead
                class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline"
              >
                <tr>
                  <th scope="col" class="px-space-md py-2.5">Voucher</th>
                  <th scope="col" class="px-space-sm py-2.5">Date</th>
                  <th scope="col" class="px-space-sm py-2.5">Item</th>
                  <th scope="col" class="px-space-sm py-2.5 text-right">Quantity</th>
                  <th scope="col" class="px-space-md py-2.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-surface-container-low">
                <tr v-for="fulfilment in fulfilments" :key="fulfilment.id">
                  <td class="px-space-md py-2.5 font-semibold text-on-surface">
                    {{ deliveryVouchers[fulfilment.voucherId]?.number ?? fulfilment.voucherId }}
                  </td>
                  <td class="whitespace-nowrap px-space-sm py-2.5 text-numeric-sm tabular text-outline">
                    {{ formatDate(deliveryVouchers[fulfilment.voucherId]?.date ?? fulfilment.createdAt.slice(0, 10)) }}
                  </td>
                  <td class="px-space-sm py-2.5 text-on-surface">
                    {{
                      itemNames.get(
                        lines.find((line) => line.id === fulfilment.orderLineId)?.itemId ?? '',
                      ) ?? 'Unknown item'
                    }}
                  </td>
                  <td class="px-space-sm py-2.5 text-right text-numeric-sm tabular text-on-surface">
                    {{ formatQuantity(fulfilment.quantityMilli) }}
                  </td>
                  <td class="px-space-md py-2.5 text-right text-numeric-sm tabular text-on-surface">
                    {{ formatMoney(fulfilment.amount, currency) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <BaseEmptyState
            v-else
            title="Nothing has been delivered"
            description="No delivery has been recorded against this order yet."
            :icon="MaterialIcon"
          />
        </section>

        <section class="mt-space-md overflow-hidden rounded-md bg-surface-container-lowest shadow-sm">
          <header class="flex flex-wrap items-center justify-between gap-3 px-space-md py-space-sm">
            <div class="flex items-center gap-space-sm">
              <MaterialIcon name="history" :size="20" class="text-primary" />
              <h2 class="text-headline-sm text-on-surface">History</h2>
            </div>
            <BaseBadge tone="neutral" size="xs">{{ revisions.length }}</BaseBadge>
          </header>

          <div v-if="revisions.length" class="overflow-x-auto">
            <table class="w-full text-left text-body-sm">
              <thead
                class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline"
              >
                <tr>
                  <th scope="col" class="px-space-md py-2.5">Revision</th>
                  <th scope="col" class="px-space-sm py-2.5">Reason</th>
                  <th scope="col" class="px-space-sm py-2.5">By</th>
                  <th scope="col" class="px-space-md py-2.5">When</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-surface-container-low">
                <tr v-for="revision in revisions" :key="revision.id">
                  <td class="px-space-md py-2.5 text-numeric-sm tabular text-on-surface">
                    {{ revision.revision }}
                  </td>
                  <td class="px-space-sm py-2.5 text-on-surface">{{ revision.reason }}</td>
                  <td class="px-space-sm py-2.5 text-on-surface-variant">{{ revision.actor }}</td>
                  <td class="whitespace-nowrap px-space-md py-2.5 text-numeric-sm tabular text-outline">
                    {{ formatDateTime(revision.createdAt) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <BaseEmptyState
            v-else
            title="No amendment yet"
            description="The order has not been amended since it was raised."
            :icon="MaterialIcon"
          />
        </section>
      </template>
    </div>

    <BaseModal
      :open="amendOpen"
      title="Amend the order"
      description="Change the ordered quantities. The previous quantities are kept in the history."
      size="lg"
      @close="amendOpen = false"
    >
      <div class="space-y-space-md">
        <div class="overflow-hidden rounded-md border border-outline-variant">
          <table class="w-full text-left text-body-sm">
            <thead class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline">
              <tr>
                <th scope="col" class="px-space-md py-2">Item</th>
                <th scope="col" class="px-space-sm py-2 text-right">Delivered</th>
                <th scope="col" class="px-space-md py-2 text-right">New quantity</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-surface-container-low">
              <tr v-for="line in lines" :key="line.id">
                <td class="px-space-md py-2 text-on-surface">
                  {{ itemNames.get(line.itemId) ?? 'Unknown item' }}
                </td>
                <td class="px-space-sm py-2 text-right text-numeric-sm tabular text-on-surface-variant">
                  {{ formatQuantity(deliveredFor(line)) }}
                </td>
                <td class="px-space-md py-2">
                  <BaseInput
                    v-model="amendQuantities[line.id]"
                    size="sm"
                    align="right"
                    class="w-32"
                    suffix="units"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <BaseInput
          v-model="amendReason"
          label="Reason"
          placeholder="Why the order is being changed"
          :error="amendReasonError ?? undefined"
        />
      </div>

      <template #footer>
        <BaseButton size="sm" variant="text" @click="amendOpen = false">Close</BaseButton>
        <BaseButton size="sm" variant="primary" icon="save" :loading="busy" @click="saveAmendment">
          Save amendment
        </BaseButton>
      </template>
    </BaseModal>

    <BaseModal
      :open="cancelOpen"
      title="Cancel the order"
      description="A cancelled order cannot be delivered against."
      size="sm"
      @close="cancelOpen = false"
    >
      <BaseInput
        v-model="cancelReason"
        label="Reason"
        placeholder="Why the order is being cancelled"
        :error="cancelReasonError ?? undefined"
      />

      <template #footer>
        <BaseButton size="sm" variant="text" @click="cancelOpen = false">Close</BaseButton>
        <BaseButton size="sm" variant="danger" icon="cancel" :loading="busy" @click="confirmCancel">
          Cancel the order
        </BaseButton>
      </template>
    </BaseModal>
  </div>
</template>
