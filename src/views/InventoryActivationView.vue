<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCheckbox from '@/components/ui/BaseCheckbox.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseNumberInput from '@/components/ui/BaseNumberInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import { computeLedgerBalances } from '@/domain/accounting'
import { formatQuantity, quantityFromString } from '@/domain/quantity'
import type { InventoryAccounts, Ledger, Voucher } from '@/domain/types'
import { todayIso } from '@/lib/datetime'
import { formatMoney, toMinor } from '@/lib/money'
import { useSessionStore } from '@/stores/session'
import { useToastStore } from '@/stores/toast'

const session = useSessionStore()
const toast = useToastStore()
const router = useRouter()

const vouchers = ref<Voucher[]>([])
const existingAccounts = ref<InventoryAccounts | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

// The decision being prepared.
const cutoverDate = ref('')
const reason = ref('')
const confirmed = ref(false)
const saving = ref(false)
const saveError = ref<string | null>(null)
const saved = ref(false)

/** The item id to "is this item stock-tracked". */
const classification = ref<Record<string, boolean>>({})
/** The opening balances being prepared. */
const openingLines = ref<
  Array<{ key: string; itemId: string; godownId: string; quantity: string; value: string }>
>([])
/** The four accounts the inventory policy uses. */
const ledgerChoice = ref({
  inventory: '',
  cogs: '',
  variance: '',
  purchases: '',
})

const currency = computed(() => session.activeCompany?.baseCurrency ?? 'INR')

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

async function load() {
  const companyId = session.activeCompanyId
  if (!companyId) {
    loading.value = false
    return
  }
  loading.value = true
  error.value = null
  try {
    const [loadedVouchers, loadedAccounts] = await Promise.all([
      session.repository.listVouchers(companyId),
      session.repository.getInventoryAccounts(companyId),
    ])
    vouchers.value = loadedVouchers
    existingAccounts.value = loadedAccounts
    prepareDefaults()
  } catch (cause) {
    error.value =
      cause instanceof Error ? cause.message : 'The activation review could not be loaded.'
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => [session.activeCompanyId, session.activeYearId], load)

// ---------------------------------------------------------------------------
// Masters
// ---------------------------------------------------------------------------

const unitNames = computed(() => {
  const map = new Map<string, string>()
  for (const unit of session.units) map.set(unit.id, unit.name)
  return map
})

const itemNames = computed(() => {
  const map = new Map<string, string>()
  for (const item of session.items) map.set(item.id, item.name)
  return map
})

const godownOptions = computed(() =>
  session.godowns.map((godown) => ({ value: godown.id, label: godown.name })),
)

const inventoryLedgerOptions = computed(() =>
  session.ledgers
    .filter((ledger) => ledger.type === 'inventory' || ledger.group === 'assets')
    .map((ledger) => ({ value: ledger.id, label: ledger.name })),
)

const cogsLedgerOptions = computed(() =>
  session.ledgers
    .filter((ledger) => ledger.group === 'expenses' && ledger.type === 'expenses')
    .map((ledger) => ({ value: ledger.id, label: ledger.name })),
)

const purchasesLedgerOptions = computed(() =>
  session.ledgers
    .filter((ledger) => ledger.type === 'purchase')
    .map((ledger) => ({ value: ledger.id, label: ledger.name })),
)

/** The ledger the company uses for stock, when it has one. */
function findLedger(predicate: (ledger: Ledger) => boolean): Ledger | undefined {
  return session.ledgers.find(predicate)
}

// ---------------------------------------------------------------------------
// The history that has no stock
// ---------------------------------------------------------------------------

/** Voucher types that change stock when they carry a stock-tracked item. */
const STOCK_AFFECTING_TYPES = new Set([
  'sales',
  'purchase',
  'credit-note',
  'debit-note',
  'stock-journal',
])

const isStockTracked = (itemId: string): boolean =>
  classification.value[itemId] ?? session.items.find((item) => item.id === itemId)?.isInventory ?? false

const postedVouchers = computed(() =>
  vouchers.value.filter((voucher) => voucher.status === 'posted'),
)

/** The posted vouchers that carry at least one item line. */
const vouchersWithItems = computed(() =>
  postedVouchers.value.filter((voucher) => voucher.items.length > 0),
)

/** The posted vouchers that would have changed stock. */
const stockAffectingVouchers = computed(() =>
  vouchersWithItems.value.filter(
    (voucher) =>
      STOCK_AFFECTING_TYPES.has(voucher.type) &&
      voucher.items.some((line) => isStockTracked(line.itemId)),
  ),
)

/** The last date a posted voucher changed stock. */
const latestStockDate = computed(() => {
  let latest: string | null = null
  for (const voucher of stockAffectingVouchers.value) {
    if (!latest || voucher.date > latest) latest = voucher.date
  }
  return latest
})

function nextDay(iso: string): string {
  const date = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(date.getTime())) return iso
  date.setDate(date.getDate() + 1)
  const offset = date.getTimezoneOffset()
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10)
}

/**
 * The cutover date is only valid when no posted stock-affecting voucher is
 * dated on or after it. Where that cannot be satisfied the activation is
 * refused: a later date, or a reviewed historical reconciliation.
 */
const cutoverConflict = computed(() => {
  if (!cutoverDate.value) return null
  const latest = latestStockDate.value
  if (!latest) return null
  if (cutoverDate.value <= latest) {
    const blocking = stockAffectingVouchers.value.filter(
      (voucher) => voucher.date >= cutoverDate.value,
    )
    return { latest, blocking }
  }
  return null
})

const cutoverIsValid = computed(() => Boolean(cutoverDate.value) && !cutoverConflict.value)

/** The most recent posted item transaction for every stock-tracked item. */
const recentItemTransactions = computed(() => {
  const latest = new Map<string, Voucher>()
  for (const voucher of vouchersWithItems.value) {
    for (const line of voucher.items) {
      if (!isStockTracked(line.itemId)) continue
      const current = latest.get(line.itemId)
      if (!current || voucher.date > current.date) latest.set(line.itemId, voucher)
    }
  }
  return [...latest.entries()].map(([itemId, voucher]) => ({
    itemId,
    itemName: itemNames.value.get(itemId) ?? 'Unknown item',
    voucher,
  }))
})

// ---------------------------------------------------------------------------
// The classification
// ---------------------------------------------------------------------------

const stockItems = computed(() =>
  session.items.filter((item) => item.isActive && isStockTracked(item.id)),
)

const serviceItems = computed(() =>
  session.items.filter((item) => item.isActive && !isStockTracked(item.id)),
)

const classificationDirty = computed(() =>
  session.items.some((item) => (classification.value[item.id] ?? item.isInventory) !== item.isInventory),
)

async function saveClassification() {
  const companyId = session.activeCompanyId
  if (!companyId) return
  saving.value = true
  saveError.value = null
  try {
    for (const item of session.items) {
      const next = classification.value[item.id] ?? item.isInventory
      if (next === item.isInventory) continue
      await session.repository.saveItem({
        ...item,
        isInventory: next,
        isService: !next,
      })
    }
    toast.success('The item classification was saved')
    await session.loadMasters(companyId)
  } catch (cause) {
    saveError.value =
      cause instanceof Error ? cause.message : 'The classification could not be saved.'
  } finally {
    saving.value = false
  }
}

// ---------------------------------------------------------------------------
// The opening balances
// ---------------------------------------------------------------------------

function prepareDefaults() {
  const stockItemList = session.items.filter((item) => item.isActive && item.isInventory)
  classification.value = Object.fromEntries(
    session.items.map((item) => [item.id, item.isInventory]),
  )

  const defaultGodown = session.godowns[0]?.id ?? ''
  openingLines.value = stockItemList.map((item) => ({
    key: `${item.id}-${defaultGodown}`,
    itemId: item.id,
    godownId: defaultGodown,
    quantity: formatQuantity(item.openingQuantityMilli),
    value: (item.openingValue / 100).toFixed(2),
  }))

  const accounts = existingAccounts.value
  ledgerChoice.value = {
    inventory:
      accounts?.inventoryLedgerId ??
      findLedger((ledger) => ledger.type === 'inventory')?.id ??
      '',
    cogs:
      accounts?.cogsLedgerId ??
      findLedger((ledger) => ledger.group === 'expenses' && ledger.type === 'expenses')?.id ??
      '',
    variance:
      accounts?.varianceLedgerId ??
      findLedger((ledger) => ledger.group === 'expenses' && ledger.type === 'expenses')?.id ??
      '',
    purchases:
      accounts?.purchasesLedgerId ??
      findLedger((ledger) => ledger.type === 'purchase')?.id ??
      '',
  }

  // The safe cutover date is the day after the last posted stock movement.
  cutoverDate.value = latestStockDate.value ? nextDay(latestStockDate.value) : todayIso()
  reason.value = latestStockDate.value
    ? `Stock tracking starts the day after the last posted stock-affecting voucher (${latestStockDate.value}).`
    : 'No posted stock-affecting voucher was found, so stock tracking starts from today.'
}

function addOpeningLine() {
  const item = stockItems.value[0]
  const godown = session.godowns[0]?.id ?? ''
  if (!item || !godown) return
  openingLines.value = [
    ...openingLines.value,
    {
      key: `${item.id}-${godown}-${openingLines.value.length}`,
      itemId: item.id,
      godownId: godown,
      quantity: '0',
      value: '0.00',
    },
  ]
}

/** An item that has just been classified as stock needs an opening line. */
watch(
  () => stockItems.value.map((item) => item.id).join(','),
  () => {
    const defaultGodown = session.godowns[0]?.id ?? ''
    const missing = stockItems.value.filter(
      (item) => !openingLines.value.some((line) => line.itemId === item.id),
    )
    if (!missing.length) return
    openingLines.value = [
      ...openingLines.value,
      ...missing.map((item) => ({
        key: `${item.id}-${defaultGodown}`,
        itemId: item.id,
        godownId: defaultGodown,
        quantity: formatQuantity(item.openingQuantityMilli),
        value: (item.openingValue / 100).toFixed(2),
      })),
    ]
  },
)

function removeOpeningLine(key: string) {
  openingLines.value = openingLines.value.filter((line) => line.key !== key)
}

/** The opening line, read as exact numbers. */
const parsedLines = computed(() =>
  openingLines.value.map((line) => {
    let quantityMilli = 0
    let carryingValue = 0
    let problem: string | null = null
    try {
      quantityMilli = quantityFromString(line.quantity)
    } catch {
      problem = 'The quantity cannot be read.'
    }
    try {
      carryingValue = toMinor(line.value)
    } catch {
      problem = problem ?? 'The value cannot be read.'
    }
    if (quantityMilli < 0) problem = 'A quantity cannot be negative.'
    if (carryingValue < 0) problem = 'A value cannot be negative.'
    return { line, quantityMilli, carryingValue, problem }
  }),
)

const lineProblems = computed(() => parsedLines.value.filter((row) => row.problem))

const openingQuantityTotal = computed(() =>
  parsedLines.value.reduce((sum, row) => sum + row.quantityMilli, 0),
)
const openingValueTotal = computed(() =>
  parsedLines.value.reduce((sum, row) => sum + row.carryingValue, 0),
)

/**
 * The balance the inventory asset ledger carries today, against the carrying
 * value the opening balances add up to.
 */
const ledgerBalance = computed(() => {
  const ledger = session.ledgers.find((candidate) => candidate.id === ledgerChoice.value.inventory)
  if (!ledger) return null
  const balances = computeLedgerBalances(session.ledgers, vouchers.value, { to: todayIso() })
  const balance = balances.find((entry) => entry.ledger.id === ledger.id)
  return { ledger, closing: balance?.closing ?? 0 }
})

const reconciliationDifference = computed(() => {
  if (!ledgerBalance.value) return null
  return openingValueTotal.value - ledgerBalance.value.closing
})

// ---------------------------------------------------------------------------
// Writing the activation
// ---------------------------------------------------------------------------

const accountsAreComplete = computed(
  () =>
    Boolean(ledgerChoice.value.inventory) &&
    Boolean(ledgerChoice.value.cogs) &&
    Boolean(ledgerChoice.value.variance) &&
    Boolean(ledgerChoice.value.purchases),
)

const canActivate = computed(
  () =>
    cutoverIsValid.value &&
    accountsAreComplete.value &&
    lineProblems.value.length === 0 &&
    confirmed.value &&
    !saving.value &&
    !alreadyActivated.value,
)

/** A company activates inventory once. A second activation is not offered. */
const alreadyActivated = computed(() => Boolean(existingAccounts.value?.activatedAt))

async function activate() {
  const companyId = session.activeCompanyId
  if (!companyId || !canActivate.value) return
  saving.value = true
  saveError.value = null
  try {
    const accounts: InventoryAccounts = {
      id: existingAccounts.value?.id ?? `ina-${companyId}`,
      companyId,
      inventoryLedgerId: ledgerChoice.value.inventory,
      cogsLedgerId: ledgerChoice.value.cogs,
      varianceLedgerId: ledgerChoice.value.variance,
      purchasesLedgerId: ledgerChoice.value.purchases,
      productionLedgerId: existingAccounts.value?.productionLedgerId ?? null,
      valuationMethod: existingAccounts.value?.valuationMethod ?? 'moving-weighted-average',
      inputTaxRecoverable: existingAccounts.value?.inputTaxRecoverable ?? true,
      activatedAt: cutoverDate.value,
      createdAt: existingAccounts.value?.createdAt ?? new Date().toISOString(),
    }

    await session.repository.createOpeningStock({
      companyId,
      cutoverDate: cutoverDate.value,
      accounts,
      lines: parsedLines.value.map((row) => ({
        itemId: row.line.itemId,
        godownId: row.line.godownId,
        quantityMilli: row.quantityMilli,
        carryingValue: row.carryingValue,
      })),
      stockItemIds: stockItems.value.map((item) => item.id),
      reason: reason.value,
      actor: 'local.operator',
    })

    saved.value = true
    confirmed.value = false
    toast.success(
      'Inventory is activated',
      `Stock tracking starts from ${cutoverDate.value}. The decision is recorded in the audit trail.`,
    )
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    saveError.value = message.includes('create_opening_stock_cmd')
      ? 'The desktop shell does not expose the command that writes the opening stock yet, so the activation could not be completed. Nothing was changed.'
      : `${message} Nothing was changed, so the entries above are still here.`
  } finally {
    saving.value = false
  }
}

const itemLabel = (itemId: string): string => itemNames.value.get(itemId) ?? 'Unknown item'
const unitLabel = (itemId: string): string => {
  const item = session.items.find((candidate) => candidate.id === itemId)
  return item ? (unitNames.value.get(item.unitId) ?? '') : ''
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      title="Inventory activation"
      subtitle="Open the stock books of this company at a cutover date"
      icon="rocket_launch"
    >
      <template #actions>
        <BaseButton size="sm" variant="outlined" icon="inventory_2" @click="router.push('/inventory')">
          Stock summary
        </BaseButton>
      </template>
    </PageHeader>

    <div class="min-h-0 flex-1 overflow-auto p-space-lg">
      <div v-if="loading" class="space-y-space-md">
        <BaseSkeleton class="h-32" />
        <BaseSkeleton class="h-64" />
        <BaseSkeleton class="h-64" />
      </div>

      <div
        v-else-if="error"
        class="rounded-md border-l-4 border-l-error bg-error-container p-space-md text-body-md text-on-error-container"
        role="alert"
      >
        <p class="font-semibold">The activation review could not be loaded</p>
        <p class="mt-0.5">{{ error }}</p>
      </div>

      <div v-else class="mx-auto max-w-5xl space-y-space-md">
        <!-- Inventory is already open for this company. -->
        <div
          v-if="alreadyActivated"
          class="flex items-center gap-space-sm rounded-md bg-secondary-container px-space-md py-space-sm text-body-md text-on-secondary-container"
          role="status"
        >
          <MaterialIcon name="check_circle" :size="20" />
          <p>
            Inventory is already activated for this company, from
            {{ existingAccounts?.activatedAt }}. The opening balances are on the books, and a
            second activation is not offered.
          </p>
        </div>

        <!-- 1. What this is. -->
        <section class="rounded-md bg-surface-container-lowest p-space-md shadow-sm">
          <header class="flex items-center gap-space-sm">
            <MaterialIcon name="info" :size="20" class="text-primary" />
            <h2 class="text-headline-sm text-on-surface">What activating inventory does</h2>
          </header>
          <div class="mt-space-sm space-y-space-sm text-body-md text-on-surface-variant">
            <p>
              The earlier version of this application posted financial vouchers without recording
              a stock movement. The purchase went to the purchase expense, the sale carried no cost
              of goods sold, and the stock that was bought and sold left no trace. The quantity in
              the warehouse and the value of the stock on hand therefore cannot be read out of the
              books that are already there.
            </p>
            <p>
              LedgerFy does not reconstruct that history. Activating inventory records a
              <strong class="font-semibold text-on-surface">cutover date</strong>, captures the
              quantity and the carrying value that are on hand at that date, reconciles them
              against the inventory asset account, and records the decision in the audit trail.
              Nothing that has already been posted is changed.
            </p>
            <p class="rounded-sm bg-surface-container-low p-space-sm text-label-sm">
              After activation, a purchase of stock is capitalised into the inventory asset
              account, a sale carries the cost of the stock it issues, and a count difference goes
              to the stock variance account.
            </p>
          </div>
        </section>

        <!-- 2. The history that has no stock. -->
        <section class="rounded-md bg-surface-container-lowest p-space-md shadow-sm">
          <header class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-space-sm">
              <MaterialIcon name="history" :size="20" class="text-primary" />
              <h2 class="text-headline-sm text-on-surface">What the books already hold</h2>
            </div>
            <BaseBadge tone="info" size="xs" icon="receipt_long">
              {{ vouchersWithItems.length }} posted vouchers with item lines
            </BaseBadge>
          </header>

          <div class="mt-space-sm grid grid-cols-1 gap-space-md sm:grid-cols-3">
            <div class="rounded-sm bg-surface-container-low p-space-sm">
              <p class="section-label text-outline">Posted item vouchers</p>
              <p class="num text-headline-md tabular text-on-surface">{{ vouchersWithItems.length }}</p>
              <p class="text-label-xs text-outline">Carry item lines but no stock movement</p>
            </div>
            <div class="rounded-sm bg-surface-container-low p-space-sm">
              <p class="section-label text-outline">Would have changed stock</p>
              <p class="num text-headline-md tabular text-on-surface">
                {{ stockAffectingVouchers.length }}
              </p>
              <p class="text-label-xs text-outline">Sales, purchases and returns</p>
            </div>
            <div class="rounded-sm bg-surface-container-low p-space-sm">
              <p class="section-label text-outline">Last stock-affecting date</p>
              <p class="num text-headline-md tabular text-on-surface">
                {{ latestStockDate ?? 'None' }}
              </p>
              <p class="text-label-xs text-outline">The earliest safe cutover is the day after</p>
            </div>
          </div>

          <div v-if="recentItemTransactions.length" class="mt-space-md">
            <p class="section-label mb-space-sm text-outline">
              The most recent posted transaction of each stock-tracked item
            </p>
            <div class="divide-y divide-surface-container-low rounded-sm border border-surface-container">
              <div
                v-for="entry in recentItemTransactions"
                :key="entry.itemId"
                class="flex flex-wrap items-center justify-between gap-2 px-space-sm py-space-xs"
              >
                <span class="text-body-sm text-on-surface">{{ entry.itemName }}</span>
                <span class="flex items-center gap-space-sm text-label-sm text-outline">
                  <BaseBadge tone="neutral" size="xs">{{ entry.voucher.type }}</BaseBadge>
                  <span class="tabular">{{ entry.voucher.date }}</span>
                  <span class="tabular">{{ entry.voucher.number }}</span>
                </span>
              </div>
            </div>
          </div>
        </section>

        <!-- 3. The cutover date. -->
        <section class="rounded-md bg-surface-container-lowest p-space-md shadow-sm">
          <header class="flex items-center gap-space-sm">
            <MaterialIcon name="event" :size="20" class="text-primary" />
            <h2 class="text-headline-sm text-on-surface">The cutover date</h2>
          </header>

          <div class="mt-space-sm flex flex-wrap items-end gap-space-md">
            <BaseInput
              v-model="cutoverDate"
              type="date"
              label="Inventory starts on"
              class="w-56"
              :error="cutoverConflict ? 'A posted stock-affecting voucher falls on or after this date.' : ''"
              :hint="
                latestStockDate
                  ? `The earliest safe date is ${nextDay(latestStockDate)}.`
                  : 'No posted stock-affecting voucher was found.'
              "
            />
            <BaseInput
              v-model="reason"
              label="Why this date was chosen"
              class="min-w-64 flex-1"
              hint="Recorded in the audit trail."
            />
          </div>

          <div
            v-if="cutoverConflict"
            class="mt-space-sm rounded-md border-l-4 border-l-error bg-error-container p-space-md text-body-md text-on-error-container"
            role="alert"
          >
            <p class="font-semibold">This cutover date cannot be used</p>
            <p class="mt-0.5">
              {{ cutoverConflict.blocking.length }} posted stock-affecting voucher{{
                cutoverConflict.blocking.length === 1 ? '' : 's'
              }}
              {{ cutoverConflict.blocking.length === 1 ? 'is' : 'are' }} dated on or after
              {{ cutoverDate }}, the last of them on {{ cutoverConflict.latest }}. Stock tracking
              cannot start while a posted transaction after that date has no movement.
            </p>
            <p class="mt-1">
              Choose a later date, or have the history from
              {{ cutoverDate }} onwards reviewed and reconciled before inventory is activated.
              LedgerFy will not rebuild the missing movements.
            </p>
            <ul class="mt-2 max-h-40 space-y-1 overflow-auto text-label-sm">
              <li v-for="voucher in cutoverConflict.blocking" :key="voucher.id">
                {{ voucher.date }} · {{ voucher.number }} · {{ voucher.type }} ·
                {{ voucher.narration }}
              </li>
            </ul>
          </div>

          <div
            v-else-if="cutoverIsValid"
            class="mt-space-sm flex items-center gap-space-sm rounded-md bg-secondary-container px-space-md py-space-sm text-body-sm text-on-secondary-container"
            role="status"
          >
            <MaterialIcon name="check_circle" :size="20" />
            <p>
              No posted stock-affecting voucher is dated on or after {{ cutoverDate }}, so this date
              is safe to start from.
            </p>
          </div>
        </section>

        <!-- 4. The items. -->
        <section class="rounded-md bg-surface-container-lowest p-space-md shadow-sm">
          <header class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-space-sm">
              <MaterialIcon name="category" :size="20" class="text-primary" />
              <h2 class="text-headline-sm text-on-surface">Which items are stock</h2>
            </div>
            <BaseButton
              size="sm"
              variant="outlined"
              icon="save"
              :loading="saving"
              :disabled="!classificationDirty"
              @click="saveClassification"
            >
              Save classification
            </BaseButton>
          </header>

          <p class="mt-space-sm text-body-sm text-on-surface-variant">
            Only a stock-tracked item creates a movement. A service, or an item the business
            identifies individually, keeps its existing expense treatment and carries no quantity.
            Review the classification before the opening balances are captured.
          </p>

          <div class="mt-space-md grid grid-cols-1 gap-space-md lg:grid-cols-2">
            <div>
              <p class="section-label mb-space-sm text-outline">
                Stock-tracked ({{ stockItems.length }})
              </p>
              <div class="divide-y divide-surface-container-low rounded-sm border border-surface-container">
                <label
                  v-for="item in stockItems"
                  :key="item.id"
                  class="flex cursor-pointer items-center justify-between gap-2 px-space-sm py-space-xs"
                >
                  <span class="text-body-sm text-on-surface">{{ item.name }}</span>
                  <input
                    type="checkbox"
                    class="size-4 accent-primary"
                    :checked="classification[item.id]"
                    @change="classification[item.id] = ($event.target as HTMLInputElement).checked"
                  />
                </label>
                <p v-if="!stockItems.length" class="px-space-sm py-space-sm text-label-sm text-outline">
                  No item is classified as stock.
                </p>
              </div>
            </div>

            <div>
              <p class="section-label mb-space-sm text-outline">
                Service or non-stock ({{ serviceItems.length }})
              </p>
              <div class="divide-y divide-surface-container-low rounded-sm border border-surface-container">
                <label
                  v-for="item in serviceItems"
                  :key="item.id"
                  class="flex cursor-pointer items-center justify-between gap-2 px-space-sm py-space-xs"
                >
                  <span class="text-body-sm text-on-surface">{{ item.name }}</span>
                  <input
                    type="checkbox"
                    class="size-4 accent-primary"
                    :checked="classification[item.id]"
                    @change="classification[item.id] = ($event.target as HTMLInputElement).checked"
                  />
                </label>
                <p v-if="!serviceItems.length" class="px-space-sm py-space-sm text-label-sm text-outline">
                  Every item is classified as stock.
                </p>
              </div>
            </div>
          </div>
        </section>

        <!-- 5. The opening balances. -->
        <section class="rounded-md bg-surface-container-lowest p-space-md shadow-sm">
          <header class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-space-sm">
              <MaterialIcon name="inventory_2" :size="20" class="text-primary" />
              <h2 class="text-headline-sm text-on-surface">Opening quantity and carrying value</h2>
            </div>
            <BaseButton size="sm" variant="outlined" icon="add" @click="addOpeningLine">
              Add a location
            </BaseButton>
          </header>

          <p class="mt-space-sm text-body-sm text-on-surface-variant">
            What is on hand at the cutover date, per item and per location. The quantity is entered
            in units and held exactly in thousandths of a unit. The value is the carrying value of
            that quantity, in rupees.
          </p>

          <div class="mt-space-md overflow-x-auto">
            <table class="w-full min-w-[42rem] border-collapse text-body-sm">
              <thead>
                <tr class="bg-surface-container-low text-left">
                  <th class="section-label px-space-sm py-space-xs text-outline">Item</th>
                  <th class="section-label px-space-sm py-space-xs text-outline">Location</th>
                  <th class="section-label px-space-sm py-space-xs text-outline">Quantity</th>
                  <th class="section-label px-space-sm py-space-xs text-outline">Carrying value</th>
                  <th class="section-label px-space-sm py-space-xs text-outline"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-surface-container-low">
                <tr v-for="row in parsedLines" :key="row.line.key">
                  <td class="px-space-sm py-space-xs">
                    <span class="text-on-surface">{{ itemLabel(row.line.itemId) }}</span>
                    <span class="ml-1 text-label-xs text-outline">{{ unitLabel(row.line.itemId) }}</span>
                  </td>
                  <td class="px-space-sm py-space-xs">
                    <BaseSelect
                      v-model="row.line.godownId"
                      :options="godownOptions"
                      size="sm"
                      class="w-40"
                    />
                  </td>
                  <td class="px-space-sm py-space-xs">
                    <BaseInput
                      v-model="row.line.quantity"
                      size="sm"
                      align="right"
                      class="w-32"
                      :error="row.problem ?? ''"
                    />
                  </td>
                  <td class="px-space-sm py-space-xs">
                    <BaseNumberInput
                      v-model="row.line.value"
                      size="sm"
                      :currency="currency"
                      class="w-40"
                    />
                  </td>
                  <td class="px-space-sm py-space-xs text-right">
                    <BaseButton
                      size="xs"
                      variant="text"
                      icon="delete"
                      aria-label="Remove the line"
                      @click="removeOpeningLine(row.line.key)"
                    />
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr class="bg-surface-container-low">
                  <td class="px-space-sm py-space-xs text-label-sm font-semibold" colspan="2">
                    Total
                  </td>
                  <td class="num px-space-sm py-space-xs text-label-sm font-semibold tabular">
                    {{ formatQuantity(openingQuantityTotal) }}
                  </td>
                  <td class="num px-space-sm py-space-xs text-label-sm font-semibold tabular">
                    {{ formatMoney(openingValueTotal, currency) }}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <!-- 6. The accounts and the reconciliation. -->
        <section class="rounded-md bg-surface-container-lowest p-space-md shadow-sm">
          <header class="flex items-center gap-space-sm">
            <MaterialIcon name="account_balance" :size="20" class="text-primary" />
            <h2 class="text-headline-sm text-on-surface">The accounts inventory will use</h2>
          </header>

          <div class="mt-space-sm grid grid-cols-1 gap-space-md sm:grid-cols-2">
            <BaseSelect
              v-model="ledgerChoice.inventory"
              :options="inventoryLedgerOptions"
              label="Inventory asset account"
              size="sm"
            />
            <BaseSelect
              v-model="ledgerChoice.cogs"
              :options="cogsLedgerOptions"
              label="Cost of goods sold account"
              size="sm"
            />
            <BaseSelect
              v-model="ledgerChoice.variance"
              :options="cogsLedgerOptions"
              label="Stock variance account"
              size="sm"
            />
            <BaseSelect
              v-model="ledgerChoice.purchases"
              :options="purchasesLedgerOptions"
              label="Purchase expense account"
              size="sm"
            />
          </div>

          <div
            class="mt-space-md rounded-md p-space-md"
            :class="
              reconciliationDifference === null || reconciliationDifference === 0
                ? 'bg-secondary-container text-on-secondary-container'
                : 'bg-tertiary-fixed text-on-tertiary-fixed'
            "
            role="status"
          >
            <div class="flex items-center gap-space-sm">
              <MaterialIcon
                :name="
                  reconciliationDifference === null || reconciliationDifference === 0
                    ? 'check_circle'
                    : 'warning'
                "
                :size="20"
              />
              <p class="text-body-md font-semibold">Reconciliation with the inventory asset account</p>
            </div>
            <div v-if="ledgerBalance" class="mt-space-sm space-y-1 text-body-sm">
              <p class="num tabular">
                Balance of {{ ledgerBalance.ledger.name }} today:
                {{ formatMoney(ledgerBalance.closing, currency) }}
              </p>
              <p class="num tabular">
                Carrying value of the opening balances:
                {{ formatMoney(openingValueTotal, currency) }}
              </p>
              <p class="num tabular font-semibold">
                Difference:
                {{
                  reconciliationDifference === null
                    ? '—'
                    : formatMoney(reconciliationDifference, currency)
                }}
              </p>
            </div>
            <p v-else class="mt-space-sm text-body-sm">
              Choose the inventory asset account to see the balance it carries.
            </p>
            <p class="mt-space-sm text-label-sm">
              The difference is reported, and it is not balanced against retained earnings or any
              other account. If it has to be corrected, raise it as an explicit, auditable
              adjustment.
            </p>
          </div>
        </section>

        <!-- 7. The confirmation and the write. -->
        <section class="rounded-md bg-surface-container-lowest p-space-md shadow-sm">
          <header class="flex items-center gap-space-sm">
            <MaterialIcon name="verified_user" :size="20" class="text-primary" />
            <h2 class="text-headline-sm text-on-surface">Activate inventory</h2>
          </header>

          <div v-if="saved" class="mt-space-sm flex items-center gap-space-sm rounded-md bg-secondary-container px-space-md py-space-sm text-body-sm text-on-secondary-container" role="status">
            <MaterialIcon name="check_circle" :size="20" />
            <p>
              Inventory is activated from {{ cutoverDate }}. The opening balances, the accounts and
              the decision are recorded in the audit trail.
            </p>
          </div>

          <div
            v-else-if="saveError"
            class="mt-space-sm rounded-md border-l-4 border-l-error bg-error-container p-space-md text-body-md text-on-error-container"
            role="alert"
          >
            <p class="font-semibold">The activation was not written</p>
            <p class="mt-0.5">{{ saveError }}</p>
            <p class="mt-1">
              Nothing was changed. The opening balances above are still here, so the activation can
              be tried again.
            </p>
          </div>

          <div class="mt-space-sm space-y-space-sm">
            <BaseCheckbox
              v-model="confirmed"
              label="I have reviewed the opening quantities, the carrying values and the difference against the inventory asset account."
              description="The activation writes the opening balances, the accounts and the decision to the audit trail. It does not change any voucher that is already posted."
            />
            <BaseButton
              variant="primary"
              icon="rocket_launch"
              :loading="saving"
              :disabled="!canActivate"
              @click="activate"
            >
              Activate inventory from {{ cutoverDate || 'the cutover date' }}
            </BaseButton>
            <p v-if="!canActivate && !saved" class="text-label-sm text-outline">
              <template v-if="alreadyActivated">
                Inventory is already activated for this company.
              </template>
              <template v-else-if="!cutoverIsValid">
                The cutover date must be set and must not fall on or before a posted
                stock-affecting voucher.
              </template>
              <template v-else-if="!accountsAreComplete">
                Every account must be chosen before inventory can be activated.
              </template>
              <template v-else-if="lineProblems.length">
                One or more opening balances cannot be read. Correct them before activating.
              </template>
              <template v-else>
                Confirm that the opening balances have been reviewed.
              </template>
            </p>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
