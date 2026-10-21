<script setup lang="ts">
import { computed, h, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseEmptyState from '@/components/ui/BaseEmptyState.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import { VOUCHER_TYPE_META } from '@/app/navigation'
import { voucherStatusLabel, voucherStatusTone, voucherTypeLabel, voucherTypeTone } from '@/app/labels'
import { balanceDifference, isBalanced, roundHalfAwayFromZero, totalCredit, totalDebit } from '@/domain/accounting'
import { buildAllocationLedger } from '@/domain/allocations'
import type { AdvanceRecord, AllocationRecord } from '@/domain/allocations'
import type { Voucher } from '@/domain/types'
import { formatDate, formatDateTime } from '@/lib/datetime'
import { formatMoney, formatPercent } from '@/lib/money'
import { formatQuantity } from '@/domain/quantity'
import { useSessionStore } from '@/stores/session'
import { useToastStore } from '@/stores/toast'

const session = useSessionStore()
const toast = useToastStore()
const route = useRoute()
const router = useRouter()

const voucher = ref<Voucher | null>(null)
/** Every voucher of the company, used to read the allocation position. */
const allVouchers = ref<Voucher[]>([])
/** The stored bill-wise allocations of the company. */
const storedAllocations = ref<AllocationRecord[]>([])
/** Money received or paid that no invoice has settled yet, as stored. */
const storedAdvances = ref<AdvanceRecord[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const printOpen = ref(false)
const cancelOpen = ref(false)
const cancelling = ref(false)

const currency = computed(() => session.activeCompany?.baseCurrency ?? 'INR')
const company = computed(() => session.activeCompany)
const party = computed(() =>
  voucher.value?.partyId
    ? (session.ledgers.find((ledger) => ledger.id === voucher.value?.partyId) ?? null)
    : null,
)

const EmptyIcon = () => h(MaterialIcon, { name: 'search_off', size: 19 })

/* ------------------------------------------------------------------ *
 * Loading
 * ------------------------------------------------------------------ */

const voucherId = computed(() => String(route.params.id ?? ''))

async function load() {
  const companyId = session.activeCompanyId
  if (!companyId || !voucherId.value) {
    voucher.value = null
    allVouchers.value = []
    storedAllocations.value = []
    storedAdvances.value = []
    loading.value = false
    return
  }
  loading.value = true
  error.value = null
  try {
    const [current, vouchers, allocations, advances] = await Promise.all([
      session.repository.getVoucher(companyId, voucherId.value),
      // The whole book, so the allocation position of this voucher can be
      // read against every other voucher of the party.
      session.repository.listVouchers(companyId),
      // The stored bill-wise allocations: which payment settled which invoice.
      session.repository.listAllocations(companyId),
      session.repository.listAdvances(companyId),
    ])
    voucher.value = current
    allVouchers.value = vouchers
    storedAllocations.value = allocations
    storedAdvances.value = advances
  } catch (cause) {
    voucher.value = null
    allVouchers.value = []
    storedAllocations.value = []
    storedAdvances.value = []
    error.value =
      cause instanceof Error ? cause.message : 'The voucher could not be loaded.'
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  if (!session.ready && !session.loading) await session.bootstrap()
  await load()
})

watch(voucherId, load)
watch(() => [session.activeCompanyId, session.activeYearId], load)

/* ------------------------------------------------------------------ *
 * Voucher lines
 * ------------------------------------------------------------------ */

type EntryRow = {
  id: string
  ledger: string
  narration: string
  debit: number
  credit: number
  running: number
}

const entryRows = computed<EntryRow[]>(() => {
  const current = voucher.value
  if (!current) return []
  let running = 0
  return current.entries.map((entry) => {
    running += entry.debit - entry.credit
    const ledger = session.ledgers.find((candidate) => candidate.id === entry.ledgerId)
    return {
      id: entry.id,
      ledger: ledger?.name ?? 'Ledger not found',
      narration: entry.narration ?? '',
      debit: entry.debit,
      credit: entry.credit,
      running,
    }
  })
})

const debitTotal = computed(() => (voucher.value ? totalDebit(voucher.value) : 0))
const creditTotal = computed(() => (voucher.value ? totalCredit(voucher.value) : 0))
const difference = computed(() => (voucher.value ? balanceDifference(voucher.value) : 0))
const balanced = computed(() => (voucher.value ? isBalanced(voucher.value) : true))

type ItemRow = {
  id: string
  description: string
  hsn: string
  quantity: number
  unit: string
  rate: number
  discount: number
  taxable: number
  taxRate: number
  taxAmount: number
  amount: number
}

const itemRows = computed<ItemRow[]>(() => {
  const current = voucher.value
  if (!current) return []
  return current.items.map((line) => {
    const item = session.items.find((candidate) => candidate.id === line.itemId)
    const category = line.taxCategoryId
      ? session.taxCategories.find((candidate) => candidate.id === line.taxCategoryId)
      : undefined
    const rate = category?.rate ?? 0
    const taxAmount = roundHalfAwayFromZero((line.amount * rate) / 100)
    return {
      id: line.id,
      description: item?.name ?? 'Item not found',
      hsn: item?.hsn ?? '—',
      quantity: line.quantityMilli,
      unit: item ? (session.units.find((unit) => unit.id === item.unitId)?.name ?? '') : '',
      rate: line.rate,
      discount: line.discount,
      taxable: line.amount,
      taxRate: rate,
      taxAmount,
      amount: line.amount + taxAmount,
    }
  })
})

type TaxRow = {
  id: string
  name: string
  rate: number
  taxable: number
  amount: number
}

const taxRows = computed<TaxRow[]>(() => {
  const current = voucher.value
  if (!current) return []
  return current.taxes.map((line) => {
    const category = session.taxCategories.find((candidate) => candidate.id === line.taxCategoryId)
    return {
      id: line.id,
      name: category?.name ?? 'Tax category not found',
      rate: category?.rate ?? 0,
      taxable: line.taxable,
      amount: line.amount,
    }
  })
})

const taxableTotal = computed(() => itemRows.value.reduce((sum, row) => sum + row.taxable, 0))
const taxTotal = computed(() => taxRows.value.reduce((sum, row) => sum + row.amount, 0))
const grandTotal = computed(() => taxableTotal.value + taxTotal.value)

/* ------------------------------------------------------------------ *
 * Bill-wise allocation
 * ------------------------------------------------------------------ */

type AllocationSide = 'receivable' | 'payable'

/** The side of the books a voucher belongs to. */
function sideOf(type: Voucher['type']): AllocationSide | null {
  if (type === 'sales' || type === 'receipt') return 'receivable'
  if (type === 'purchase' || type === 'payment') return 'payable'
  return null
}

const voucherById = computed(() => new Map(allVouchers.value.map((voucher) => [voucher.id, voucher])))

/**
 * The allocation ledger of the company, built by the domain over the vouchers
 * that were read. It is the authority for the position of every invoice.
 */
const ledger = computed(() =>
  buildAllocationLedger(allVouchers.value, {
    asOf: '9999-12-31',
    dueDays: 30,
    idFactory: () => 'allocation',
    now: () => new Date().toISOString(),
  }),
)

/** True when the company holds stored allocation records. */
const allocationsFromStore = computed(() => storedAllocations.value.length > 0)

/**
 * The allocation records that describe this voucher: the stored ones when the
 * company has them, and the ones the domain derives when it does not.
 */
const companyAllocations = computed<AllocationRecord[]>(() =>
  allocationsFromStore.value ? storedAllocations.value : ledger.value.allocations,
)

const allocationBasis = computed(() =>
  allocationsFromStore.value
    ? 'Read from the stored allocation records of this company.'
    : 'This company has no stored allocation records yet, so the trail is derived from the posted vouchers.',
)

const isPayment = computed(() => {
  const type = voucher.value?.type
  return type === 'receipt' || type === 'payment'
})

const isInvoice = computed(() => {
  const type = voucher.value?.type
  return type === 'sales' || type === 'purchase'
})

type AllocationRow = {
  id: string
  voucherId: string
  number: string
  date: string
  amount: number
}

/** The invoices a receipt or payment settled. */
const settledInvoices = computed<AllocationRow[]>(() => {
  const current = voucher.value
  if (!current) return []
  return companyAllocations.value
    .filter((record) => record.paymentVoucherId === current.id)
    .filter((record) => voucherById.value.get(record.invoiceVoucherId)?.status === 'posted')
    .map((record) => {
      const invoice = voucherById.value.get(record.invoiceVoucherId)
      return {
        id: `${record.id}:${record.invoiceVoucherId}`,
        voucherId: record.invoiceVoucherId,
        number: invoice?.number ?? '—',
        date: invoice?.date ?? '',
        amount: record.amount,
      }
    })
    .sort((left, right) =>
      left.date === right.date
        ? left.number.localeCompare(right.number)
        : left.date < right.date
          ? -1
          : 1,
    )
})

/** The payments that settled an invoice. */
const settledPayments = computed<AllocationRow[]>(() => {
  const current = voucher.value
  if (!current) return []
  return companyAllocations.value
    .filter((record) => record.invoiceVoucherId === current.id)
    .filter((record) => voucherById.value.get(record.paymentVoucherId)?.status === 'posted')
    .map((record) => {
      const payment = voucherById.value.get(record.paymentVoucherId)
      return {
        id: `${record.id}:${record.paymentVoucherId}`,
        voucherId: record.paymentVoucherId,
        number: payment?.number ?? '—',
        date: payment?.date ?? '',
        amount: record.amount,
      }
    })
    .sort((left, right) =>
      left.date === right.date
        ? left.number.localeCompare(right.number)
        : left.date < right.date
          ? -1
          : 1,
    )
})

/** The amount this voucher moves on the party ledger. */
const partyLegAmount = computed(() => {
  const current = voucher.value
  if (!current?.partyId) return 0
  const entry = current.entries.find((candidate) => candidate.ledgerId === current.partyId)
  return entry ? Math.abs(entry.debit - entry.credit) : 0
})

const settledTotal = computed(() => {
  const rows = isInvoice.value ? settledPayments.value : settledInvoices.value
  return rows.reduce((sum, row) => sum + row.amount, 0)
})

/** What is still owed on an invoice, or still to be applied on a payment. */
const outstandingAmount = computed(() => Math.max(0, partyLegAmount.value - settledTotal.value))

/**
 * The money this voucher holds as an advance: money received or paid that no
 * invoice has settled yet.
 */
const advanceAmount = computed(() => {
  const current = voucher.value
  if (!current) return 0
  const side = sideOf(current.type)
  const stored = storedAdvances.value.find(
    (advance) => advance.voucherId === current.id && (!side || advance.side === side),
  )
  if (stored) return stored.amount
  const derived = ledger.value.advances.find(
    (advance) => advance.voucherId === current.id && (!side || advance.side === side),
  )
  if (derived) return derived.amount
  return outstandingAmount.value
})

function openRelatedVoucher(voucherId: string) {
  void router.push(`/vouchers/${voucherId}`)
}

const advanceWording = computed(() =>
  sideOf(voucher.value?.type ?? 'sales') === 'payable'
    ? 'An advance is money paid to a supplier that no bill has settled yet. It stays with the supplier and is applied to their oldest open bill when one is raised.'
    : 'An advance is money received from a customer that no invoice has settled yet. It stays with the customer and is applied to their oldest open invoice when one is raised.',
)

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

const canCancel = computed(
  () => !!voucher.value && voucher.value.status !== 'cancelled' && !voucher.value.isLocked,
)

function editVoucher() {
  const current = voucher.value
  if (!current) return
  void router.push(`/vouchers/new/${current.type}?id=${current.id}`)
}

function openPrint() {
  printOpen.value = true
  document.body.classList.add('voucher-print-open')
}

function closePrint() {
  printOpen.value = false
  document.body.classList.remove('voucher-print-open')
}

function printVoucher() {
  window.print()
}

async function confirmCancel() {
  const current = voucher.value
  if (!current) return
  cancelling.value = true
  try {
    // Cancelling withdraws the financial effect and releases the allocations
    // the voucher held, so the outstanding balances are restored.
    await session.repository.cancelVoucher(current)
    cancelOpen.value = false
    // The allocation figures are recomputed from the books: the voucher, the
    // vouchers of the company and the allocation records are read again
    // instead of being patched in place.
    await load()
    toast.success(
      `${current.number} cancelled`,
      'Cancelled vouchers are excluded from reports and do not affect balances. The allocation figures below have been read again from the books.',
    )
  } catch (cause) {
    toast.error(
      'The voucher could not be cancelled',
      cause instanceof Error ? cause.message : 'The voucher was not changed.',
    )
  } finally {
    cancelling.value = false
  }
}

onBeforeUnmount(() => {
  document.body.classList.remove('voucher-print-open')
})

const documentTitle = computed(() => {
  const type = voucher.value?.type
  if (type === 'sales') return 'Tax Invoice'
  if (type === 'purchase') return 'Purchase Bill'
  if (type === 'receipt') return 'Receipt'
  if (type === 'payment') return 'Payment Voucher'
  if (type === 'contra') return 'Contra Voucher'
  if (type === 'journal') return 'Journal Voucher'
  return 'Voucher'
})
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      :title="voucher?.number ?? 'Voucher'"
      :subtitle="
        voucher
          ? `${voucherTypeLabel(voucher.type)} · ${formatDate(voucher.date)}${party ? ` · ${party.name}` : ''}`
          : 'Voucher detail'
      "
      icon="receipt_long"
      :breadcrumb="[
        { label: 'Accounting', to: '/vouchers' },
        { label: voucher?.number ?? 'Voucher' },
      ]"
    >
      <template #title-meta>
        <BaseBadge v-if="voucher" :tone="voucherTypeTone(voucher.type)" size="xs">
          {{ VOUCHER_TYPE_META[voucher.type]?.label ?? voucherTypeLabel(voucher.type) }}
        </BaseBadge>
        <BaseBadge v-if="voucher" :tone="voucherStatusTone(voucher.status)" size="xs">
          {{ voucherStatusLabel(voucher.status) }}
        </BaseBadge>
      </template>

      <template #actions>
        <BaseButton
          v-if="voucher"
          size="sm"
          variant="outlined"
          icon="edit"
          :disabled="voucher.status === 'cancelled'"
          @click="editVoucher"
        >
          Edit voucher
        </BaseButton>
        <BaseButton v-if="voucher" size="sm" variant="tonal" icon="print" @click="openPrint">
          Print preview
        </BaseButton>
        <BaseButton
          v-if="voucher"
          size="sm"
          variant="danger"
          icon="cancel"
          :disabled="!canCancel"
          :title="voucher.isLocked ? 'This voucher is locked and cannot be cancelled.' : undefined"
          @click="cancelOpen = true"
        >
          Cancel voucher
        </BaseButton>
      </template>
    </PageHeader>

    <div class="min-h-0 flex-1 overflow-auto p-space-lg">
      <div v-if="loading" class="space-y-space-md">
        <BaseSkeleton class="h-24" />
        <BaseSkeleton class="h-64" />
        <BaseSkeleton class="h-56" />
      </div>

      <div
        v-else-if="error"
        class="rounded-md border-l-4 border-l-error bg-error-container p-space-md text-body-md text-on-error-container"
        role="alert"
      >
        <p class="font-semibold">The voucher could not be loaded</p>
        <p class="mt-0.5">{{ error }}</p>
      </div>

      <BaseEmptyState
        v-else-if="!voucher"
        class="mt-space-xl"
        title="Voucher not found"
        description="This voucher does not exist in the open company, or it has been removed."
        :icon="EmptyIcon"
      >
        <RouterLink
          to="/vouchers"
          class="rounded-sm bg-primary px-space-sm py-1 text-label-sm font-semibold text-on-primary"
        >
          Back to the voucher register
        </RouterLink>
      </BaseEmptyState>

      <template v-else>
        <!-- State notices -->
        <div
          v-if="voucher.status === 'draft'"
          class="mb-space-md flex items-start gap-space-sm rounded-md border-l-4 border-l-tertiary bg-tertiary-fixed p-space-md text-body-md text-on-tertiary-fixed"
          role="alert"
        >
          <MaterialIcon name="edit_note" :size="20" class="mt-0.5 shrink-0" />
          <div>
            <p class="font-semibold">Not posted — this voucher does not affect balances.</p>
            <p class="mt-0.5 text-body-sm">
              It is saved as a draft. Post it from the voucher entry screen before it can be
              reported, and it will be left out of every balance until then.
            </p>
          </div>
        </div>

        <div
          v-else-if="voucher.status === 'cancelled'"
          class="mb-space-md flex items-start gap-space-sm rounded-md border-l-4 border-l-error bg-error-container p-space-md text-body-md text-on-error-container"
          role="alert"
        >
          <MaterialIcon name="cancel" :size="20" class="mt-0.5 shrink-0" />
          <div>
            <p class="font-semibold">This voucher is cancelled.</p>
            <p class="mt-0.5 text-body-sm">
              Cancelled vouchers are excluded from reports, balances and outstanding amounts.
            </p>
          </div>
        </div>

        <div
          v-if="voucher.status === 'posted' && !balanced"
          class="mb-space-md flex items-start gap-space-sm rounded-md border-l-4 border-l-error bg-error-container p-space-md text-body-md text-on-error-container"
          role="alert"
        >
          <MaterialIcon name="error" :size="20" class="mt-0.5 shrink-0" />
          <div>
            <p class="font-semibold">This voucher does not balance.</p>
            <p class="mt-0.5 text-body-sm">
              Debits and credits differ by {{ formatMoney(Math.abs(difference), currency) }}. A
              voucher must balance before it can be relied on in a report.
            </p>
          </div>
        </div>

        <div v-if="voucher.isLocked" class="mb-space-md">
          <BaseBadge tone="neutral" size="sm" icon="lock">
            Locked — this voucher belongs to a closed period
          </BaseBadge>
        </div>

        <div class="grid grid-cols-1 items-start gap-space-md xl:grid-cols-3">
          <!-- Header facts -->
          <BaseCard title="Voucher" class="xl:col-span-1">
            <dl class="space-y-space-sm">
              <div>
                <dt class="section-label">Date</dt>
                <dd class="text-body-md text-on-surface">{{ formatDate(voucher.date) }}</dd>
              </div>
              <div>
                <dt class="section-label">Party</dt>
                <dd class="text-body-md text-on-surface">{{ party?.name ?? 'No party on this voucher' }}</dd>
                <dd v-if="party?.taxNumber" class="text-label-sm text-outline">
                  Tax number {{ party.taxNumber }}
                </dd>
              </div>
              <div>
                <dt class="section-label">Reference</dt>
                <dd class="text-body-md text-on-surface">{{ voucher.reference || '—' }}</dd>
              </div>
              <div>
                <dt class="section-label">Narration</dt>
                <dd class="text-body-md text-on-surface">{{ voucher.narration || '—' }}</dd>
              </div>
              <div>
                <dt class="section-label">Last changed</dt>
                <dd class="text-body-sm text-on-surface-variant">
                  {{ formatDateTime(voucher.updatedAt) }}
                </dd>
              </div>
            </dl>
          </BaseCard>

          <div class="flex flex-col gap-space-md xl:col-span-2">
            <!-- Accounting entries -->
            <BaseCard title="Accounting entries" description="Debit and credit lines as posted">
              <template #actions>
                <BaseBadge :tone="balanced ? 'positive' : 'danger'" size="xs">
                  {{ balanced ? 'Balanced' : 'Out of balance' }}
                </BaseBadge>
              </template>

              <div v-if="entryRows.length" class="overflow-x-auto">
                <table class="w-full text-left text-body-sm">
                  <caption class="sr-only">Ledger entries of this voucher</caption>
                  <thead class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline">
                    <tr>
                      <th scope="col" class="px-space-md py-2">Ledger</th>
                      <th scope="col" class="px-space-md py-2">Narration</th>
                      <th scope="col" class="px-space-md py-2 text-right">Debit</th>
                      <th scope="col" class="px-space-md py-2 text-right">Credit</th>
                      <th scope="col" class="px-space-md py-2 text-right">Running</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-surface-container-low">
                    <tr v-for="row in entryRows" :key="row.id">
                      <td class="px-space-md py-2 font-medium text-on-surface">{{ row.ledger }}</td>
                      <td class="px-space-md py-2 text-on-surface-variant">
                        {{ row.narration || '—' }}
                      </td>
                      <td class="px-space-md py-2 text-right tabular text-on-surface">
                        {{ formatMoney(row.debit, currency) }}
                      </td>
                      <td class="px-space-md py-2 text-right tabular text-on-surface">
                        {{ formatMoney(row.credit, currency) }}
                      </td>
                      <td class="px-space-md py-2 text-right tabular text-on-surface-variant">
                        {{ formatMoney(row.running, currency, { signed: true }) }}
                      </td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr class="bg-surface-container-low/60">
                      <td class="px-space-md py-2 text-label-md font-semibold text-on-surface" colspan="2">
                        Totals
                      </td>
                      <td class="px-space-md py-2 text-right tabular text-numeric-md font-bold text-on-surface">
                        {{ formatMoney(debitTotal, currency) }}
                      </td>
                      <td class="px-space-md py-2 text-right tabular text-numeric-md font-bold text-on-surface">
                        {{ formatMoney(creditTotal, currency) }}
                      </td>
                      <td class="px-space-md py-2 text-right tabular text-label-sm text-on-surface-variant">
                        {{ balanced ? 'In balance' : formatMoney(difference, currency, { signed: true }) }}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <p v-else class="text-body-sm text-outline">This voucher has no ledger entries.</p>
            </BaseCard>

            <!-- Bill-wise allocation -->
            <BaseCard
              v-if="isPayment || isInvoice"
              title="Bill-wise allocation"
              :description="
                isPayment
                  ? 'The invoices this voucher settles'
                  : 'The payments that settled this invoice'
              "
            >
              <template #actions>
                <BaseBadge tone="neutral" size="xs">
                  {{ formatMoney(settledTotal, currency) }} settled
                </BaseBadge>
              </template>

              <p
                v-if="voucher.status !== 'posted'"
                class="rounded-sm bg-surface-container-low p-space-sm text-body-sm text-on-surface-variant"
              >
                This voucher is not posted, so it settles nothing and is left out of every
                allocation.
              </p>

              <template v-else-if="isPayment">
                <div v-if="settledInvoices.length" class="overflow-x-auto">
                  <table class="w-full text-left text-body-sm">
                    <caption class="sr-only">Invoices settled by this voucher</caption>
                    <thead class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline">
                      <tr>
                        <th scope="col" class="px-space-md py-2">Invoice no.</th>
                        <th scope="col" class="px-space-md py-2">Date</th>
                        <th scope="col" class="px-space-md py-2 text-right">Amount settled</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-surface-container-low">
                      <tr v-for="row in settledInvoices" :key="row.id">
                        <td class="px-space-md py-2">
                          <button
                            type="button"
                            class="font-medium text-primary hover:underline"
                            @click="openRelatedVoucher(row.voucherId)"
                          >
                            {{ row.number }}
                          </button>
                        </td>
                        <td class="px-space-md py-2 tabular text-on-surface-variant">
                          {{ formatDate(row.date) }}
                        </td>
                        <td class="px-space-md py-2 text-right tabular text-on-surface">
                          {{ formatMoney(row.amount, currency) }}
                        </td>
                      </tr>
                    </tbody>
                    <tfoot>
                      <tr class="bg-surface-container-low/60">
                        <td
                          class="px-space-md py-2 text-label-md font-semibold text-on-surface"
                          colspan="2"
                        >
                          Settled
                        </td>
                        <td class="px-space-md py-2 text-right tabular text-numeric-md font-bold text-on-surface">
                          {{ formatMoney(settledTotal, currency) }}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                <p v-else class="text-body-md text-on-surface">
                  This {{ voucherTypeLabel(voucher.type).toLowerCase() }} settles no invoice.
                </p>

                <div
                  class="mt-space-md flex flex-wrap items-center justify-between gap-space-sm rounded-sm bg-surface-container-low p-space-sm"
                >
                  <div>
                    <p class="section-label">Amount on this voucher</p>
                    <p class="text-numeric-md font-bold tabular text-on-surface">
                      {{ formatMoney(partyLegAmount, currency) }}
                    </p>
                  </div>
                  <div>
                    <p class="section-label">Held as an advance</p>
                    <p class="text-numeric-md font-bold tabular text-on-surface">
                      {{ formatMoney(advanceAmount, currency) }}
                    </p>
                  </div>
                </div>

                <p class="mt-space-sm text-label-sm text-outline">{{ advanceWording }}</p>
              </template>

              <template v-else-if="isInvoice">
                <div v-if="settledPayments.length" class="overflow-x-auto">
                  <table class="w-full text-left text-body-sm">
                    <caption class="sr-only">Payments that settled this invoice</caption>
                    <thead class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline">
                      <tr>
                        <th scope="col" class="px-space-md py-2">Payment no.</th>
                        <th scope="col" class="px-space-md py-2">Date</th>
                        <th scope="col" class="px-space-md py-2 text-right">Amount settled</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-surface-container-low">
                      <tr v-for="row in settledPayments" :key="row.id">
                        <td class="px-space-md py-2">
                          <button
                            type="button"
                            class="font-medium text-primary hover:underline"
                            @click="openRelatedVoucher(row.voucherId)"
                          >
                            {{ row.number }}
                          </button>
                        </td>
                        <td class="px-space-md py-2 tabular text-on-surface-variant">
                          {{ formatDate(row.date) }}
                        </td>
                        <td class="px-space-md py-2 text-right tabular text-on-surface">
                          {{ formatMoney(row.amount, currency) }}
                        </td>
                      </tr>
                    </tbody>
                    <tfoot>
                      <tr class="bg-surface-container-low/60">
                        <td
                          class="px-space-md py-2 text-label-md font-semibold text-on-surface"
                          colspan="2"
                        >
                          Settled
                        </td>
                        <td class="px-space-md py-2 text-right tabular text-numeric-md font-bold text-on-surface">
                          {{ formatMoney(settledTotal, currency) }}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                <p v-else class="text-body-md text-on-surface">
                  No payment has settled this invoice yet.
                </p>

                <div class="mt-space-md grid grid-cols-1 gap-space-sm sm:grid-cols-3">
                  <div class="rounded-sm bg-surface-container-low p-space-sm">
                    <p class="section-label">Invoice amount</p>
                    <p class="text-numeric-md font-bold tabular text-on-surface">
                      {{ formatMoney(partyLegAmount, currency) }}
                    </p>
                  </div>
                  <div class="rounded-sm bg-surface-container-low p-space-sm">
                    <p class="section-label">Settled</p>
                    <p class="text-numeric-md font-bold tabular text-on-surface">
                      {{ formatMoney(settledTotal, currency) }}
                    </p>
                  </div>
                  <div class="rounded-sm bg-surface-container-low p-space-sm">
                    <p class="section-label">Outstanding</p>
                    <p class="text-numeric-md font-bold tabular text-on-surface">
                      {{ formatMoney(outstandingAmount, currency) }}
                    </p>
                  </div>
                </div>
              </template>

              <template #footer>
                <p class="text-label-xs text-outline">{{ allocationBasis }}</p>
              </template>
            </BaseCard>

            <!-- Item lines -->
            <BaseCard v-if="itemRows.length" title="Item lines" description="What this voucher bills for">
              <div class="overflow-x-auto">
                <table class="w-full text-left text-body-sm">
                  <caption class="sr-only">Item lines of this voucher</caption>
                  <thead class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline">
                    <tr>
                      <th scope="col" class="px-space-md py-2">Item</th>
                      <th scope="col" class="px-space-md py-2">HSN</th>
                      <th scope="col" class="px-space-md py-2 text-right">Qty</th>
                      <th scope="col" class="px-space-md py-2 text-right">Rate</th>
                      <th scope="col" class="px-space-md py-2 text-right">Discount</th>
                      <th scope="col" class="px-space-md py-2 text-right">Taxable</th>
                      <th scope="col" class="px-space-md py-2 text-right">Tax %</th>
                      <th scope="col" class="px-space-md py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-surface-container-low">
                    <tr v-for="row in itemRows" :key="row.id">
                      <td class="px-space-md py-2 font-medium text-on-surface">
                        {{ row.description }}
                      </td>
                      <td class="px-space-md py-2 tabular text-on-surface-variant">{{ row.hsn }}</td>
                      <td class="px-space-md py-2 text-right tabular text-on-surface">
                        {{ formatQuantity(row.quantity) }} {{ row.unit }}
                      </td>
                      <td class="px-space-md py-2 text-right tabular text-on-surface">
                        {{ formatMoney(row.rate, currency) }}
                      </td>
                      <td class="px-space-md py-2 text-right tabular text-on-surface-variant">
                        {{ formatMoney(row.discount, currency) }}
                      </td>
                      <td class="px-space-md py-2 text-right tabular text-on-surface">
                        {{ formatMoney(row.taxable, currency) }}
                      </td>
                      <td class="px-space-md py-2 text-right tabular text-on-surface-variant">
                        {{ row.taxRate ? formatPercent(row.taxRate) : '—' }}
                      </td>
                      <td class="px-space-md py-2 text-right tabular font-semibold text-on-surface">
                        {{ formatMoney(row.amount, currency) }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </BaseCard>

            <!-- Tax breakup -->
            <BaseCard
              v-if="taxRows.length"
              title="Tax breakup"
              description="Tax charged on this voucher"
            >
              <div class="overflow-x-auto">
                <table class="w-full text-left text-body-sm">
                  <caption class="sr-only">Tax breakup of this voucher</caption>
                  <thead class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline">
                    <tr>
                      <th scope="col" class="px-space-md py-2">Tax category</th>
                      <th scope="col" class="px-space-md py-2 text-right">Rate</th>
                      <th scope="col" class="px-space-md py-2 text-right">Taxable</th>
                      <th scope="col" class="px-space-md py-2 text-right">Tax</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-surface-container-low">
                    <tr v-for="row in taxRows" :key="row.id">
                      <td class="px-space-md py-2 font-medium text-on-surface">{{ row.name }}</td>
                      <td class="px-space-md py-2 text-right tabular text-on-surface-variant">
                        {{ formatPercent(row.rate) }}
                      </td>
                      <td class="px-space-md py-2 text-right tabular text-on-surface">
                        {{ formatMoney(row.taxable, currency) }}
                      </td>
                      <td class="px-space-md py-2 text-right tabular font-semibold text-on-surface">
                        {{ formatMoney(row.amount, currency) }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </BaseCard>

            <!-- Document total -->
            <div
              class="flex flex-wrap items-center justify-between gap-space-md rounded-md bg-inverse-surface px-space-md py-space-md text-inverse-on-surface"
            >
              <div>
                <p class="section-label text-inverse-on-surface/70">Taxable value</p>
                <p class="num text-numeric-lg font-bold tabular">
                  {{ formatMoney(taxableTotal, currency) }}
                </p>
              </div>
              <div>
                <p class="section-label text-inverse-on-surface/70">Tax</p>
                <p class="num text-numeric-lg font-bold tabular">
                  {{ formatMoney(taxTotal, currency) }}
                </p>
              </div>
              <div class="text-right">
                <p class="section-label text-inverse-on-surface/70">Document total</p>
                <p class="num text-numeric-lg font-bold tabular">
                  {{ formatMoney(grandTotal, currency) }}
                </p>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- Print preview -->
    <BaseModal
      :open="printOpen"
      title="Print preview"
      description="How this voucher prints"
      size="xl"
      @close="closePrint"
    >
      <div v-if="voucher" class="print-surface rounded-md bg-surface-container-lowest p-space-lg">
        <header class="flex flex-wrap items-start justify-between gap-space-md border-b border-surface-container pb-space-md">
          <div>
            <p class="text-headline-sm text-on-surface">{{ company?.name ?? 'Company' }}</p>
            <p v-if="company?.address" class="max-w-xs text-label-sm text-outline">
              {{ company.address }}
            </p>
            <p class="text-label-sm text-outline">
              {{ company?.gstin ? `GSTIN ${company.gstin}` : 'GSTIN not recorded' }}
            </p>
          </div>
          <div class="text-right">
            <p class="section-label">{{ documentTitle }}</p>
            <p class="text-numeric-md font-bold text-on-surface">{{ voucher.number }}</p>
            <p class="text-label-sm text-outline">{{ formatDate(voucher.date) }}</p>
          </div>
        </header>

        <dl class="grid grid-cols-1 gap-space-sm py-space-md sm:grid-cols-3">
          <div>
            <dt class="section-label">Billed to</dt>
            <dd class="text-body-md text-on-surface">{{ party?.name ?? 'No party' }}</dd>
            <dd v-if="party?.address" class="text-label-sm text-outline">{{ party.address }}</dd>
            <dd v-if="party?.taxNumber" class="text-label-sm text-outline">
              Tax number {{ party.taxNumber }}
            </dd>
          </div>
          <div>
            <dt class="section-label">Reference</dt>
            <dd class="text-body-md text-on-surface">{{ voucher.reference || '—' }}</dd>
          </div>
          <div>
            <dt class="section-label">Status</dt>
            <dd class="text-body-md text-on-surface">{{ voucherStatusLabel(voucher.status) }}</dd>
          </div>
        </dl>

        <table v-if="itemRows.length" class="w-full text-left text-body-sm">
          <thead class="border-y border-surface-container bg-surface-container-low text-label-xs uppercase tracking-wider text-outline">
            <tr>
              <th scope="col" class="px-space-sm py-2">Item</th>
              <th scope="col" class="px-space-sm py-2">HSN</th>
              <th scope="col" class="px-space-sm py-2 text-right">Qty</th>
              <th scope="col" class="px-space-sm py-2 text-right">Rate</th>
              <th scope="col" class="px-space-sm py-2 text-right">Taxable</th>
              <th scope="col" class="px-space-sm py-2 text-right">Tax</th>
              <th scope="col" class="px-space-sm py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-surface-container-low">
            <tr v-for="row in itemRows" :key="row.id">
              <td class="px-space-sm py-2 text-on-surface">{{ row.description }}</td>
              <td class="px-space-sm py-2 tabular text-on-surface-variant">{{ row.hsn }}</td>
              <td class="px-space-sm py-2 text-right tabular text-on-surface">
                {{ formatQuantity(row.quantity) }} {{ row.unit }}
              </td>
              <td class="px-space-sm py-2 text-right tabular text-on-surface">
                {{ formatMoney(row.rate, currency) }}
              </td>
              <td class="px-space-sm py-2 text-right tabular text-on-surface">
                {{ formatMoney(row.taxable, currency) }}
              </td>
              <td class="px-space-sm py-2 text-right tabular text-on-surface-variant">
                {{ row.taxRate ? formatPercent(row.taxRate) : '—' }}
              </td>
              <td class="px-space-sm py-2 text-right tabular font-semibold text-on-surface">
                {{ formatMoney(row.amount, currency) }}
              </td>
            </tr>
          </tbody>
        </table>

        <table v-if="taxRows.length" class="mt-space-md w-full text-left text-body-sm">
          <thead class="border-y border-surface-container bg-surface-container-low text-label-xs uppercase tracking-wider text-outline">
            <tr>
              <th scope="col" class="px-space-sm py-2">Tax</th>
              <th scope="col" class="px-space-sm py-2 text-right">Taxable</th>
              <th scope="col" class="px-space-sm py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-surface-container-low">
            <tr v-for="row in taxRows" :key="row.id">
              <td class="px-space-sm py-2 text-on-surface">{{ row.name }}</td>
              <td class="px-space-sm py-2 text-right tabular text-on-surface">
                {{ formatMoney(row.taxable, currency) }}
              </td>
              <td class="px-space-sm py-2 text-right tabular text-on-surface">
                {{ formatMoney(row.amount, currency) }}
              </td>
            </tr>
          </tbody>
        </table>

        <div class="mt-space-md flex justify-end">
          <dl class="w-full max-w-xs space-y-space-xs">
            <div class="flex items-center justify-between">
              <dt class="text-body-sm text-on-surface-variant">Taxable value</dt>
              <dd class="num text-body-sm tabular text-on-surface">
                {{ formatMoney(taxableTotal, currency) }}
              </dd>
            </div>
            <div class="flex items-center justify-between">
              <dt class="text-body-sm text-on-surface-variant">Tax</dt>
              <dd class="num text-body-sm tabular text-on-surface">
                {{ formatMoney(taxTotal, currency) }}
              </dd>
            </div>
            <div class="flex items-center justify-between border-t border-surface-container pt-space-xs">
              <dt class="text-label-md font-semibold text-on-surface">Total</dt>
              <dd class="num text-numeric-md font-bold tabular text-on-surface">
                {{ formatMoney(grandTotal, currency) }}
              </dd>
            </div>
          </dl>
        </div>

        <p class="mt-space-md border-t border-surface-container pt-space-sm text-label-xs text-outline">
          Preview of voucher {{ voucher.number }} as it stands in the books. This is not a filed
          document and carries no signature.
        </p>
      </div>

      <template #footer>
        <div class="no-print flex w-full flex-wrap items-center justify-between gap-2">
          <span class="text-label-xs text-outline">
            Printing uses the browser dialog. Save as PDF to keep a copy.
          </span>
          <div class="flex items-center gap-2">
            <BaseButton variant="neutral" size="sm" @click="closePrint">Close</BaseButton>
            <BaseButton variant="primary" size="sm" icon="print" @click="printVoucher">Print</BaseButton>
          </div>
        </div>
      </template>
    </BaseModal>

    <!-- Cancel confirmation -->
    <BaseModal
      :open="cancelOpen"
      title="Cancel this voucher?"
      description="Cancellation is recorded on the voucher and kept in the audit trail."
      size="sm"
      @close="cancelOpen = false"
    >
      <p v-if="voucher" class="text-body-md text-on-surface">
        Voucher <strong>{{ voucher.number }}</strong> dated {{ formatDate(voucher.date) }} will be
        marked as cancelled.
      </p>
      <ul class="mt-space-sm list-disc space-y-space-xs pl-space-lg text-body-sm text-on-surface-variant">
        <li>The voucher is excluded from reports, balances and outstanding amounts.</li>
        <li>The voucher stays in the register and in the audit trail, marked as cancelled.</li>
        <li>This cannot be undone from this screen.</li>
      </ul>

      <template #footer>
        <BaseButton variant="neutral" size="sm" @click="cancelOpen = false">Keep voucher</BaseButton>
        <BaseButton
          variant="danger"
          size="sm"
          icon="cancel"
          :loading="cancelling"
          @click="confirmCancel"
        >
          Cancel voucher
        </BaseButton>
      </template>
    </BaseModal>
  </div>
</template>

<style>
/*
 * Print rules for the voucher preview. The class is put on <body> while the
 * preview is open so that only the preview itself reaches the printer.
 */
@media print {
  body.voucher-print-open > #app {
    display: none !important;
  }

  body.voucher-print-open > div {
    position: static !important;
    inset: auto !important;
    display: block !important;
    overflow: visible !important;
    padding: 0 !important;
    background: transparent !important;
  }

  body.voucher-print-open > div > div:first-of-type {
    display: none !important;
  }

  body.voucher-print-open > div > div:last-of-type {
    position: static !important;
    max-width: none !important;
    width: 100% !important;
    border-radius: 0 !important;
    box-shadow: none !important;
  }

  body.voucher-print-open > div > div:last-of-type > header {
    display: none !important;
  }

  body.voucher-print-open > div > div:last-of-type > div {
    max-height: none !important;
    overflow: visible !important;
    padding: 0 !important;
  }
}
</style>
