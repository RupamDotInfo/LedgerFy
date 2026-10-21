<script setup lang="ts">
/**
 * One production order, with its requirements, its issues and the cost it
 * carries.
 *
 * The state is derived from what has been issued and received. Issuing
 * materials and receiving the finished goods are the domain's own operations,
 * so a refusal is shown with the reason the domain gave.
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
import {
  deriveProductionState,
  workInProgressCost,
} from '@/domain/production'
import { formatQuantity, quantityFromString } from '@/domain/quantity'
import type { ProductionOrderState } from '@/domain/types'
import type { ProductionOrderWithDetail } from '@/repositories/contracts'
import { formatDate } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { useSessionStore } from '@/stores/session'
import { useToastStore } from '@/stores/toast'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const toast = useToastStore()

const detail = ref<ProductionOrderWithDetail | null>(null)
const structureVersion = ref<number | null>(null)
const structureItem = ref<string>('')
const loading = ref(true)
const error = ref<string | null>(null)
const busy = ref(false)

const orderId = computed(() => String(route.params.id ?? ''))
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

const state = computed<ProductionOrderState | null>(() =>
  detail.value
    ? deriveProductionState(detail.value.order, detail.value.issues, detail.value.completions)
    : null,
)

const issuedCost = computed(() =>
  detail.value ? workInProgressCost(detail.value.issues) : 0,
)

const receivedCost = computed(() =>
  detail.value
    ? detail.value.completions.reduce((sum, completion) => sum + completion.cost, 0)
    : 0,
)

const canIssue = computed(
  () => detail.value?.order.status === 'released' || detail.value?.order.status === 'completed',
)

const canComplete = computed(() => {
  if (!detail.value) return false
  if (detail.value.order.status !== 'released') return false
  if (!detail.value.issues.length) return false
  return detail.value.requirements.every(
    (requirement) => requirement.issuedQuantityMilli >= requirement.requiredQuantityMilli,
  )
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
    const found = await session.repository.getProductionOrder(companyId, orderId.value)
    detail.value = found
    if (found) {
      const boms = await session.repository.listBoms(companyId, found.order.itemId)
      const structure = boms.find((entry) => entry.bom.id === found.order.bomId)
      structureVersion.value = structure?.bom.version ?? found.order.bomVersion ?? null
      structureItem.value = itemNames.value.get(found.order.itemId) ?? ''
    }
  } catch (cause) {
    error.value =
      cause instanceof Error ? cause.message : 'The production order could not be loaded.'
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => [session.activeCompanyId, orderId.value], load)

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'The request was refused.'
}

// ---------------------------------------------------------------------------
// Issue materials
// ---------------------------------------------------------------------------

const issueOpen = ref(false)
const issueQuantities = ref<Record<string, string>>({})
const issueError = ref<string | null>(null)

function openIssue() {
  const quantities: Record<string, string> = {}
  for (const requirement of detail.value?.requirements ?? []) {
    const outstanding = Math.max(
      0,
      requirement.requiredQuantityMilli - requirement.issuedQuantityMilli,
    )
    quantities[requirement.id] = String(outstanding / 1000)
  }
  issueQuantities.value = quantities
  issueError.value = null
  issueOpen.value = true
}

async function confirmIssue() {
  const companyId = session.activeCompanyId
  const current = detail.value
  if (!companyId || !current) return

  const inputs: Array<{
    requirementId: string
    itemId: string
    godownId: string
    quantityMilli: number
  }> = []
  try {
    for (const requirement of current.requirements) {
      const typed = issueQuantities.value[requirement.id] ?? '0'
      const quantityMilli = quantityFromString(typed)
      if (quantityMilli <= 0) continue
      inputs.push({
        requirementId: requirement.id,
        itemId: requirement.itemId,
        godownId: current.order.godownId,
        quantityMilli,
      })
    }
    if (!inputs.length) {
      throw new Error('Choose the components to issue.')
    }
  } catch (cause) {
    issueError.value = messageOf(cause)
    return
  }
  issueError.value = null

  busy.value = true
  try {
    const result = await session.repository.postProductionIssue(
      current.order,
      current.requirements,
      inputs,
    )
    issueOpen.value = false
    toast.success(
      'Materials issued',
      `${result.issues.length} component${result.issues.length === 1 ? '' : 's'} issued against ${current.order.number}.`,
    )
    await load()
  } catch (cause) {
    issueError.value = messageOf(cause)
    toast.error('The materials were not issued', messageOf(cause))
  } finally {
    busy.value = false
  }
}

// ---------------------------------------------------------------------------
// Complete
// ---------------------------------------------------------------------------

async function complete() {
  const companyId = session.activeCompanyId
  const current = detail.value
  if (!companyId || !current) return
  busy.value = true
  try {
    const result = await session.repository.postProductionCompletion(
      current.order,
      current.requirements,
      current.issues,
    )
    toast.success(
      'Finished goods received',
      `${result.completions.length ? formatQuantity(result.completions[0]!.quantityMilli) : ''} received into stock at ${formatMoney(result.completions.reduce((sum, completion) => sum + completion.cost, 0), currency.value)}.`,
    )
    await load()
  } catch (cause) {
    toast.error('The production order was not completed', messageOf(cause))
  } finally {
    busy.value = false
  }
}

</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      :title="detail?.order.number ?? 'Production order'"
      :subtitle="structureItem || 'Production order'"
      icon="precision_manufacturing"
    >
      <template #actions>
        <BaseButton
          size="sm"
          variant="text"
          icon="arrow_back"
          @click="router.push('/production')"
        >
          Register
        </BaseButton>
        <BaseButton
          v-if="canIssue"
          size="sm"
          variant="outlined"
          icon="local_shipping"
          @click="openIssue"
        >
          Issue materials
        </BaseButton>
        <BaseButton
          v-if="detail"
          size="sm"
          variant="primary"
          icon="task_alt"
          :disabled="!canComplete"
          :loading="busy"
          @click="complete"
        >
          Complete
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
        <p class="font-semibold">The production order could not be opened</p>
        <p class="mt-0.5">{{ error }}</p>
      </div>

      <template v-else-if="detail && state">
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Planned quantity"
            :value="formatQuantity(detail.order.plannedQuantityMilli)"
            icon="inventory_2"
            :hint="godownNames.get(detail.order.godownId) ?? ''"
          />
          <StatTile
            label="Materials issued"
            :value="formatMoney(issuedCost, currency)"
            icon="local_shipping"
            tone="warning"
            hint="The cost the work in progress carries"
          />
          <StatTile
            label="Cost transferred"
            :value="formatMoney(receivedCost, currency)"
            icon="swap_horiz"
            tone="positive"
            hint="Moved from work in progress to the finished goods"
          />
          <StatTile
            label="State"
            :value="STATE_LABEL[state]"
            :icon="state === 'completed' ? 'task_alt' : 'precision_manufacturing'"
            :tone="state === 'completed' ? 'positive' : state === 'in-production' ? 'warning' : 'info'"
            :hint="`Structure version ${structureVersion ?? detail.order.bomVersion ?? '—'}`"
          />
        </div>

        <section class="mt-space-md overflow-hidden rounded-md bg-surface-container-lowest shadow-sm">
          <header class="flex flex-wrap items-center justify-between gap-3 px-space-md py-space-sm">
            <div class="flex items-center gap-space-sm">
              <MaterialIcon name="account_tree" :size="20" class="text-primary" />
              <h2 class="text-headline-sm text-on-surface">Requirements</h2>
            </div>
            <BaseBadge :tone="STATE_TONE[state]" size="xs">{{ STATE_LABEL[state] }}</BaseBadge>
          </header>

          <div v-if="detail.requirements.length" class="overflow-x-auto">
            <table class="w-full text-left text-body-sm">
              <thead
                class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline"
              >
                <tr>
                  <th scope="col" class="px-space-md py-2.5">Component</th>
                  <th scope="col" class="px-space-sm py-2.5 text-right">Required</th>
                  <th scope="col" class="px-space-sm py-2.5 text-right">Issued</th>
                  <th scope="col" class="px-space-md py-2.5 text-right">Outstanding</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-surface-container-low">
                <tr v-for="requirement in detail.requirements" :key="requirement.id">
                  <td class="px-space-md py-2.5 text-on-surface">
                    {{ itemNames.get(requirement.itemId) ?? 'Unknown item' }}
                  </td>
                  <td class="px-space-sm py-2.5 text-right text-numeric-sm tabular text-on-surface">
                    {{ formatQuantity(requirement.requiredQuantityMilli) }}
                  </td>
                  <td class="px-space-sm py-2.5 text-right text-numeric-sm tabular text-on-surface">
                    {{ formatQuantity(requirement.issuedQuantityMilli) }}
                  </td>
                  <td class="px-space-md py-2.5 text-right text-numeric-sm font-semibold tabular text-on-surface">
                    {{
                      formatQuantity(
                        Math.max(
                          0,
                          requirement.requiredQuantityMilli - requirement.issuedQuantityMilli,
                        ),
                      )
                    }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <BaseEmptyState
            v-else
            title="No requirements yet"
            description="The structure is snapshotted when the order is released."
            :icon="MaterialIcon"
          />
        </section>

        <section class="mt-space-md overflow-hidden rounded-md bg-surface-container-lowest shadow-sm">
          <header class="flex flex-wrap items-center justify-between gap-3 px-space-md py-space-sm">
            <div class="flex items-center gap-space-sm">
              <MaterialIcon name="local_shipping" :size="20" class="text-primary" />
              <h2 class="text-headline-sm text-on-surface">Issues</h2>
            </div>
            <BaseBadge tone="neutral" size="xs">{{ detail.issues.length }}</BaseBadge>
          </header>

          <div v-if="detail.issues.length" class="overflow-x-auto">
            <table class="w-full text-left text-body-sm">
              <thead
                class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline"
              >
                <tr>
                  <th scope="col" class="px-space-md py-2.5">Date</th>
                  <th scope="col" class="px-space-sm py-2.5">Component</th>
                  <th scope="col" class="px-space-sm py-2.5 text-right">Quantity</th>
                  <th scope="col" class="px-space-md py-2.5 text-right">Cost</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-surface-container-low">
                <tr v-for="issue in detail.issues" :key="issue.id">
                  <td class="whitespace-nowrap px-space-md py-2.5 text-numeric-sm tabular text-outline">
                    {{ formatDate(issue.createdAt.slice(0, 10)) }}
                  </td>
                  <td class="px-space-sm py-2.5 text-on-surface">
                    {{ itemNames.get(issue.itemId) ?? 'Unknown item' }}
                  </td>
                  <td class="px-space-sm py-2.5 text-right text-numeric-sm tabular text-on-surface">
                    {{ formatQuantity(issue.quantityMilli) }}
                  </td>
                  <td class="px-space-md py-2.5 text-right text-numeric-sm tabular text-on-surface">
                    {{ formatMoney(issue.cost, currency) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <BaseEmptyState
            v-else
            title="Nothing has been issued"
            description="No materials have been issued against this order yet."
            :icon="MaterialIcon"
          />
        </section>

        <section class="mt-space-md overflow-hidden rounded-md bg-surface-container-lowest shadow-sm">
          <header class="flex flex-wrap items-center justify-between gap-3 px-space-md py-space-sm">
            <div class="flex items-center gap-space-sm">
              <MaterialIcon name="swap_horiz" :size="20" class="text-primary" />
              <h2 class="text-headline-sm text-on-surface">Cost transfer</h2>
            </div>
            <BaseBadge tone="neutral" size="xs">{{ detail.completions.length }}</BaseBadge>
          </header>

          <div v-if="detail.completions.length" class="overflow-x-auto">
            <table class="w-full text-left text-body-sm">
              <thead
                class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline"
              >
                <tr>
                  <th scope="col" class="px-space-md py-2.5">Date</th>
                  <th scope="col" class="px-space-sm py-2.5">Item</th>
                  <th scope="col" class="px-space-sm py-2.5 text-right">Quantity</th>
                  <th scope="col" class="px-space-sm py-2.5 text-right">Rate</th>
                  <th scope="col" class="px-space-md py-2.5 text-right">Cost</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-surface-container-low">
                <tr v-for="completion in detail.completions" :key="completion.id">
                  <td class="whitespace-nowrap px-space-md py-2.5 text-numeric-sm tabular text-outline">
                    {{ formatDate(completion.createdAt.slice(0, 10)) }}
                  </td>
                  <td class="px-space-sm py-2.5 text-on-surface">
                    {{ itemNames.get(completion.itemId) ?? 'Unknown item' }}
                  </td>
                  <td class="px-space-sm py-2.5 text-right text-numeric-sm tabular text-on-surface">
                    {{ formatQuantity(completion.quantityMilli) }}
                  </td>
                  <td class="px-space-sm py-2.5 text-right text-numeric-sm tabular text-on-surface-variant">
                    {{ formatMoney(completion.rate, currency) }}
                  </td>
                  <td class="px-space-md py-2.5 text-right text-numeric-sm font-semibold tabular text-on-surface">
                    {{ formatMoney(completion.cost, currency) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <BaseEmptyState
            v-else
            title="The cost has not been transferred"
            description="The finished goods are received when every component has been issued in full."
            :icon="MaterialIcon"
          />
        </section>
      </template>
    </div>

    <BaseModal
      :open="issueOpen"
      title="Issue materials"
      description="Choose how much of each component goes into the work in progress."
      size="lg"
      @close="issueOpen = false"
    >
      <div class="space-y-space-md">
        <div class="overflow-hidden rounded-md border border-outline-variant">
          <table class="w-full text-left text-body-sm">
            <thead class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline">
              <tr>
                <th scope="col" class="px-space-md py-2">Component</th>
                <th scope="col" class="px-space-sm py-2 text-right">Outstanding</th>
                <th scope="col" class="px-space-md py-2 text-right">To issue</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-surface-container-low">
              <tr v-for="requirement in detail?.requirements ?? []" :key="requirement.id">
                <td class="px-space-md py-2 text-on-surface">
                  {{ itemNames.get(requirement.itemId) ?? 'Unknown item' }}
                </td>
                <td class="px-space-sm py-2 text-right text-numeric-sm tabular text-on-surface-variant">
                  {{
                    formatQuantity(
                      Math.max(
                        0,
                        requirement.requiredQuantityMilli - requirement.issuedQuantityMilli,
                      ),
                    )
                  }}
                </td>
                <td class="px-space-md py-2">
                  <BaseInput
                    v-model="issueQuantities[requirement.id]"
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

        <p
          v-if="issueError"
          class="rounded-sm bg-error-container px-space-sm py-space-xs text-body-sm text-on-error-container"
          role="alert"
        >
          {{ issueError }}
        </p>
      </div>

      <template #footer>
        <BaseButton size="sm" variant="text" @click="issueOpen = false">Close</BaseButton>
        <BaseButton size="sm" variant="primary" icon="local_shipping" :loading="busy" @click="confirmIssue">
          Issue
        </BaseButton>
      </template>
    </BaseModal>
  </div>
</template>
