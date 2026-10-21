<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCombobox, { type ComboboxOption } from '@/components/ui/BaseCombobox.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseNumberInput from '@/components/ui/BaseNumberInput.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import ItemGrid from '@/features/voucher/ItemGrid.vue'
import LedgerLinesGrid from '@/features/voucher/LedgerLinesGrid.vue'
import PartyPanel from '@/features/voucher/PartyPanel.vue'
import TaxBreakdownPanel from '@/features/voucher/TaxBreakdownPanel.vue'
import VoucherActionBar from '@/features/voucher/VoucherActionBar.vue'
import VoucherMetaBar from '@/features/voucher/VoucherMetaBar.vue'
import VoucherTypeDock from '@/features/voucher/VoucherTypeDock.vue'
import { useVoucherDraft, usesItemGrid } from '@/features/voucher/useVoucherDraft'
import { prepareOrderConversion } from '@/domain/orders'
import type { VoucherType } from '@/domain/types'
import { useSessionStore } from '@/stores/session'
import { useToastStore } from '@/stores/toast'
import { formatMoney } from '@/lib/money'
import { formatQuantity } from '@/domain/quantity'
import { formatDate, todayIso } from '@/lib/datetime'
import { amountInWords } from '@/lib/words'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const toast = useToastStore()

const type = computed<VoucherType>(() => (route.params.type as VoucherType) ?? 'sales')

const draft = useVoucherDraft(type)

const saving = ref(false)
const previewOpen = ref(false)
const referenceDate = ref('')
const partyPanel = ref<InstanceType<typeof PartyPanel> | null>(null)
const narrationEl = ref<HTMLTextAreaElement | null>(null)

const currency = computed(() => session.activeCompany?.baseCurrency ?? 'INR')

const partyKind = computed<'customer' | 'supplier' | 'both' | null>(() => {
  if (directSettlement.value) return 'customer'
  if (type.value === 'purchase' || type.value === 'debit-note' || type.value === 'payment') {
    return 'supplier'
  }
  if (type.value === 'sales' || type.value === 'credit-note' || type.value === 'receipt') {
    return 'customer'
  }
  return null
})

/**
 * A cash sale is settled directly against a cash or bank account, so it
 * creates no receivable. The workspace opens it with `?mode=cash-sale`.
 */
const directSettlement = computed(() => route.query.mode === 'cash-sale')

const companyStateCode = computed(() => session.activeCompany?.gstin?.slice(0, 2) ?? '')
const partyStateCode = computed(() => draft.party.value?.taxNumber?.slice(0, 2) ?? '')
const isInterState = computed(
  () => !!companyStateCode.value && !!partyStateCode.value && companyStateCode.value !== partyStateCode.value,
)
const placeOfSupply = computed(() => {
  const state = session.activeCompany?.state ?? 'Not configured'
  return companyStateCode.value ? `${companyStateCode.value} - ${state}` : state
})

const accountOptions = computed<ComboboxOption[]>(() =>
  [...session.cashLedgers, ...session.bankLedgers].map((ledger) => ({
    id: ledger.id,
    label: ledger.name,
    sublabel: ledger.type === 'cash' ? 'Cash' : 'Bank',
  })),
)

const paymentTermOptions = computed(() =>
  session.paymentTerms.map((term) => ({
    value: term.id,
    label: term.days === 0 ? 'Due on receipt' : `Net ${term.days} days`,
  })),
)

const blockingIssues = computed(() =>
  draft.issues.value.filter((issue) => issue.severity === 'error'),
)

const isBalanced = computed(() => {
  const voucher = draft.draftVoucher.value
  const debit = voucher.entries.reduce((sum, entry) => sum + entry.debit, 0)
  const credit = voucher.entries.reduce((sum, entry) => sum + entry.credit, 0)
  return debit === credit && debit > 0
})

const difference = computed(() => {
  const voucher = draft.draftVoucher.value
  const debit = voucher.entries.reduce((sum, entry) => sum + entry.debit, 0)
  const credit = voucher.entries.reduce((sum, entry) => sum + entry.credit, 0)
  return debit - credit
})

const grandTotal = computed(() => {
  if (usesItemGrid(type.value)) return draft.grandTotal.value
  return draft.simpleAmount.value
})

const discountTotal = computed(() =>
  draft.itemRows.value.reduce((sum, row) => sum + row.discount, 0),
)

const taxableValue = computed(() => draft.gross.value)

function printDocument() {
  window.print()
}

onMounted(async () => {
  await loadVoucherNumber()
  const seeded = await seedFromOrder()
  if (!seeded && usesItemGrid(type.value)) draft.addItemRow()
  if (type.value === 'journal') draft.addLedgerRow()
})

/**
 * Seed the voucher from the order it is being raised from.
 *
 * The order's party, items, remaining quantities, rates and tax treatment are
 * carried across, and every line remembers the order line it fulfils, so
 * posting the voucher records the delivery against the order.
 */
async function seedFromOrder(): Promise<boolean> {
  const orderId = typeof route.query.order === 'string' ? route.query.order : null
  const companyId = session.activeCompanyId
  if (!orderId || !companyId) return false

  try {
    const order = await session.repository.getOrder(companyId, orderId)
    if (!order) return false
    // The screen's type and the order's kind must agree, or the party and the
    // items would not belong to the same side of the books.
    const expected = order.order.kind === 'purchase' ? 'purchase' : 'sales'
    if (type.value !== expected) {
      toast.error(
        'That order is not a ' + (expected === 'purchase' ? 'purchase' : 'sales') + ' order',
        'Open the order from the register it belongs to.',
      )
      return false
    }
    const conversion = prepareOrderConversion(order.order, order.lines, order.fulfilments, {
      companyId,
      items: new Map(session.items.map((item) => [item.id, item])),
      idFactory: () => `order-${orderId}-${Math.random().toString(36).slice(2, 10)}`,
      now: () => new Date().toISOString(),
      today: todayIso(),
    })
    draft.applyOrderDraft(conversion)
    return true
  } catch (cause) {
    toast.error(
      cause instanceof Error ? cause.message : 'The order could not be opened for invoicing.',
    )
    return false
  }
}

watch(
  () => type.value,
  async () => {
    draft.reset()
    await loadVoucherNumber()
    if (usesItemGrid(type.value)) draft.addItemRow()
    if (type.value === 'journal') draft.addLedgerRow()
  },
)

async function loadVoucherNumber() {
  if (!session.activeCompanyId) return
  draft.voucherNumber.value = await session.repository.nextVoucherNumber(
    session.activeCompanyId,
    type.value,
  )
}

async function persist(nextStatus: 'draft' | 'posted') {
  if (!session.activeCompanyId) {
    toast.error('No company is open', 'Open a company before saving a voucher.')
    return
  }
  if (nextStatus === 'posted' && blockingIssues.value.length) {
    toast.error(
      'This voucher cannot be posted yet',
      blockingIssues.value[0]?.message ?? 'Correct the highlighted fields first.',
    )
    return
  }

  saving.value = true
  try {
    const voucher = {
      ...draft.draftVoucher.value,
      status: nextStatus,
      number: draft.voucherNumber.value,
    }

    if (nextStatus === 'posted') {
      // Posting writes the voucher, its entries, the bill-wise allocations it
      // settles and the audit event in one transaction.
      const saved = await session.repository.postVoucher(voucher)
      toast.success(
        'Voucher posted',
        `${saved.number} now affects balances, receivables and the reports.`,
      )
      await loadVoucherNumber()
      await router.push(`/vouchers/${saved.id}`)
    } else {
      // A draft has no financial effect: it allocates nothing and does not
      // appear in any report.
      const saved = await session.repository.saveVoucher(voucher)
      toast.success(
        'Draft saved',
        `${saved.number} is stored as a draft. It does not affect balances until it is posted.`,
      )
      await loadVoucherNumber()
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'The voucher was not saved.'
    toast.error('The voucher was not saved', message)
  } finally {
    saving.value = false
  }
}

function cancel() {
  void router.push('/vouchers')
}

function onKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  const typing =
    !!target &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)

  if (event.key === 'F2') {
    event.preventDefault()
    document.querySelector<HTMLInputElement>('input[type="date"]')?.focus()
    return
  }
  if (event.ctrlKey && event.key.toLowerCase() === 's') {
    event.preventDefault()
    void persist('draft')
    return
  }
  if (event.ctrlKey && event.key === 'Enter') {
    event.preventDefault()
    void persist('posted')
    return
  }
  if (event.altKey && event.key.toLowerCase() === 'p') {
    event.preventDefault()
    previewOpen.value = true
    return
  }
  if (event.altKey && event.key.toLowerCase() === 'c') {
    event.preventDefault()
    partyPanel.value?.openCreate()
    return
  }
  if (event.ctrlKey && event.key.toLowerCase() === 'n') {
    event.preventDefault()
    narrationEl.value?.focus()
    return
  }
  if (event.ctrlKey && event.key.toLowerCase() === 'd' && usesItemGrid(type.value)) {
    event.preventDefault()
    const last = draft.itemRows.value[draft.itemRows.value.length - 1]
    if (last) draft.removeItemRow(last.id)
    return
  }
  if (event.key === 'Escape' && !typing) {
    cancel()
  }
}

const printableVoucher = computed(() => draft.draftVoucher.value)
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden" @keydown="onKeydown">
    <VoucherTypeDock :active="type" :is-draft="draft.status.value === 'draft'" />

    <VoucherMetaBar
      v-model:date="draft.date.value"
      :voucher-number="draft.voucherNumber.value"
      :place-of-supply="placeOfSupply"
      :is-inter-state="isInterState"
    />

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="space-y-space-md p-space-lg">
        <!-- Validation summary -->
        <div
          v-if="blockingIssues.length"
          class="rounded-md border-l-4 border-l-error bg-error-container px-space-md py-space-sm"
          role="alert"
        >
          <div class="flex items-center gap-space-sm">
            <MaterialIcon name="error" :size="18" class="text-error" />
            <span class="text-label-md font-bold text-on-error-container">
              {{ blockingIssues.length }} {{ blockingIssues.length === 1 ? 'issue' : 'issues' }} must be
              corrected before this voucher can be posted
            </span>
          </div>
          <ul class="mt-1 space-y-0.5 pl-6 text-label-sm text-on-error-container">
            <li v-for="(issue, index) in blockingIssues" :key="index" class="list-disc">
              {{ issue.message }}
            </li>
          </ul>
        </div>

        <!-- Party -->
        <PartyPanel
          v-if="partyKind"
          ref="partyPanel"
          v-model:party-id="draft.partyId.value"
          v-model:reference="draft.reference.value"
          :reference-date="referenceDate"
          :party-kind="partyKind"
          :credit-limit="150000000"
          :mode="directSettlement ? 'account' : 'party'"
        />

        <!-- Item grid -->
        <ItemGrid
          v-if="usesItemGrid(type)"
          :rows="draft.itemRows.value"
          :tax-lines="draft.taxComputation.value.lines"
          :line-taxes="draft.lineTaxes.value"
          @update:rows="draft.itemRows.value = $event"
          @add="draft.addItemRow()"
          @remove="draft.removeItemRow($event)"
          @apply-defaults="draft.applyItemDefaults($event)"
        />

        <!-- Simple money movements -->
        <div
          v-else-if="type === 'payment' || type === 'receipt' || type === 'contra'"
          class="rounded-md bg-surface-container-lowest p-space-md shadow-md"
        >
          <div class="grid grid-cols-1 gap-space-md md:grid-cols-3">
            <BaseNumberInput
              :model-value="draft.simpleAmount.value / 100"
              label="Amount"
              required
              @update:model-value="draft.setSimpleAmount(String($event ?? 0))"
            />

            <BaseCombobox
              v-if="type === 'contra'"
              :model-value="draft.contraFromId.value"
              :options="accountOptions"
              label="From account"
              placeholder="Select the source account"
              variant="outlined"
              @update:model-value="draft.contraFromId.value = $event"
            />
            <BaseCombobox
              v-else
              :model-value="draft.accountLedgerId.value"
              :options="accountOptions"
              :label="type === 'payment' ? 'Pay through' : 'Receive into'"
              placeholder="Select a cash or bank account"
              variant="outlined"
              @update:model-value="draft.accountLedgerId.value = $event"
            />

            <BaseCombobox
              v-if="type === 'contra'"
              :model-value="draft.contraToId.value"
              :options="accountOptions"
              label="To account"
              placeholder="Select the destination account"
              variant="outlined"
              @update:model-value="draft.contraToId.value = $event"
            />
            <BaseInput
              v-else
              :model-value="draft.reference.value"
              label="Reference"
              placeholder="Cheque or transaction reference"
              variant="outlined"
              @update:model-value="draft.reference.value = String($event)"
            />
          </div>

          <div class="mt-space-md rounded-sm bg-surface-container-low p-space-sm">
            <p class="section-label">Ledger preview</p>
            <table class="mt-2 w-full text-left text-body-sm">
              <tbody class="divide-y divide-surface-container">
                <tr v-for="entry in draft.simpleEntries.value" :key="entry.id">
                  <td class="py-1.5 pr-space-md">
                    {{
                      session.ledgers.find((ledger) => ledger.id === entry.ledgerId)?.name ??
                      'Select a ledger'
                    }}
                  </td>
                  <td class="num py-1.5 pr-space-md text-right text-numeric-sm">
                    {{ entry.debit ? formatMoney(entry.debit, currency) : '—' }}
                  </td>
                  <td class="num py-1.5 text-right text-numeric-sm font-bold">
                    {{ entry.credit ? formatMoney(entry.credit, currency) : '—' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Journal lines -->
        <LedgerLinesGrid
          v-else
          :rows="draft.ledgerRows.value"
          :difference="difference"
          @update:rows="draft.ledgerRows.value = $event"
          @add="draft.addLedgerRow()"
          @remove="draft.removeLedgerRow($event)"
        />

        <!-- Narration and statutory panel -->
        <div class="grid grid-cols-1 gap-space-md lg:grid-cols-12">
          <div class="space-y-space-md lg:col-span-7">
            <div class="rounded-md bg-surface-container-lowest p-space-md shadow-md">
              <div class="flex items-center justify-between">
                <span class="text-label-sm font-bold uppercase text-outline">Narration / Remarks</span>
                <span class="text-label-xs text-outline">Ctrl+N to jump</span>
              </div>
              <textarea
                ref="narrationEl"
                :value="draft.narration.value"
                rows="3"
                placeholder="Enter voucher narration…"
                class="mt-2 w-full resize-none rounded-sm bg-surface-container-low p-space-sm font-body-sm text-body-sm text-on-surface placeholder:text-outline focus:ring-2 focus:ring-primary focus:outline-none"
                @input="draft.narration.value = ($event.target as HTMLTextAreaElement).value"
              />
            </div>

            <div class="rounded-md bg-surface-container-lowest p-space-md shadow-md">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-space-sm">
                  <MaterialIcon name="fact_check" :size="20" class="text-primary" />
                  <span class="text-label-md font-bold text-on-surface">
                    Statutory &amp; E-Way Trigger
                  </span>
                </div>
                <span
                  class="rounded-sm bg-secondary-container px-2 py-0.5 text-label-xs font-bold text-on-secondary-container"
                >
                  Auto threshold &gt; {{ formatMoney(5000000, currency) }}
                </span>
              </div>

              <div class="grid grid-cols-1 gap-space-md pt-space-xs md:grid-cols-2">
                <label
                  class="flex cursor-pointer items-start gap-space-sm rounded-sm bg-surface-container-low p-space-sm transition-colors hover:bg-surface-container"
                >
                  <input type="checkbox" class="mt-0.5 size-4 rounded accent-primary" disabled />
                  <span class="flex flex-col">
                    <span class="text-label-sm font-bold text-on-surface">
                      Generate IRN &amp; E-Way Bill
                    </span>
                    <span class="text-body-sm text-outline">
                      Requires the GST portal and a configured credential. Not available in this build.
                    </span>
                  </span>
                </label>

                <div class="flex items-center justify-between rounded-sm bg-surface-container-low p-space-sm">
                  <div class="flex flex-col">
                    <span class="text-label-xs uppercase text-outline">Remittance Bank</span>
                    <span class="text-label-sm font-bold text-on-surface">
                      {{ session.bankLedgers[0]?.name ?? 'No bank ledger' }}
                    </span>
                  </div>
                  <MaterialIcon name="change_circle" :size="16" class="text-outline" />
                </div>
              </div>
            </div>
          </div>

          <div class="lg:col-span-5">
            <TaxBreakdownPanel
              :gross="taxableValue"
              :discount="discountTotal"
              :taxable="taxableValue"
              :tax-total="draft.taxTotal.value"
              :grand-total="grandTotal"
              :tax-lines="draft.taxComputation.value.lines"
              :is-balanced="isBalanced"
              :difference="difference"
            />
          </div>
        </div>

        <!-- Payment terms -->
        <div class="mt-space-md grid grid-cols-1 gap-space-md lg:grid-cols-12">
          <div class="rounded-md bg-surface-container-lowest p-space-md shadow-md lg:col-span-7">
            <div class="flex items-center justify-between">
              <span class="text-label-sm font-bold uppercase text-outline">Payment terms</span>
              <span v-if="draft.dueDate.value" class="text-label-sm font-semibold text-on-surface">
                Due {{ formatDate(draft.dueDate.value) }}
              </span>
            </div>

            <div class="mt-space-sm grid grid-cols-1 gap-space-sm md:grid-cols-2">
              <BaseSelect
                :model-value="draft.paymentTermId.value ?? ''"
                :options="paymentTermOptions"
                label="Credit period"
                placeholder="Due on receipt"
                variant="outlined"
                @update:model-value="draft.applyPaymentTerm($event ? String($event) : null)"
              />

              <p class="flex items-end">
                <span class="rounded-sm bg-surface-container-low p-space-sm text-label-sm text-outline">
                  <template v-if="draft.dueDate.value">
                    This invoice falls due on
                    <strong class="text-on-surface">{{ formatDate(draft.dueDate.value) }}</strong
                    >. The due date is fixed when the term is chosen, so a later change to the term
                    cannot restate this invoice.
                  </template>
                  <template v-else>
                    No credit period is applied, so the invoice is due on the voucher date. Choose a
                    term to set a due date.
                  </template>
                </span>
              </p>
            </div>
          </div>

          <div class="lg:col-span-5" />
        </div>
      </div>
    </div>

    <VoucherActionBar
      :saving="saving"
      :can-post="!blockingIssues.length"
      :can-save="!!session.activeCompanyId"
      @save="persist('draft')"
      @post="persist('posted')"
      @preview="previewOpen = true"
    />

    <!-- Print preview -->
    <BaseModal
      :open="previewOpen"
      title="Print preview"
      description="The layout below is built from the voucher as it currently stands."
      size="xl"
      @close="previewOpen = false"
    >
      <div class="rounded-md bg-surface-container-lowest p-space-lg shadow-sm print-surface">
        <div class="flex items-start justify-between border-b border-surface-container pb-space-sm">
          <div>
            <p class="text-headline-sm text-on-surface">
              {{ session.activeCompany?.name ?? 'Company' }}
            </p>
            <p class="text-label-xs text-outline">{{ session.activeCompany?.address }}</p>
            <p class="num text-label-xs text-outline">{{ session.activeCompany?.gstin }}</p>
          </div>
          <div class="text-right">
            <p class="text-label-xs uppercase text-outline">Voucher</p>
            <p class="num text-numeric-md font-bold text-primary">{{ printableVoucher.number }}</p>
            <p class="text-label-xs text-outline">{{ formatDate(printableVoucher.date) }}</p>
          </div>
        </div>

        <p class="mt-space-sm text-body-sm text-on-surface">
          <span class="font-bold">Party:</span> {{ draft.party.value?.name ?? '—' }}
        </p>

        <table class="mt-space-md w-full text-left text-body-sm">
          <thead>
            <tr class="bg-surface-container-low text-label-xs uppercase text-outline">
              <th class="py-1.5 px-space-sm">Particulars</th>
              <th class="py-1.5 px-space-sm text-right">Qty</th>
              <th class="py-1.5 px-space-sm text-right">Rate</th>
              <th class="py-1.5 px-space-sm text-right">Taxable</th>
              <th class="py-1.5 px-space-sm text-right">Tax</th>
              <th class="py-1.5 px-space-sm text-right">Amount</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-surface-container-low">
            <tr v-for="line in printableVoucher.items" :key="line.id">
              <td class="py-1.5 px-space-sm">
                {{ session.items.find((item) => item.id === line.itemId)?.name ?? line.itemId }}
              </td>
              <td class="num py-1.5 px-space-sm text-right">{{ formatQuantity(line.quantityMilli) }}</td>
              <td class="num py-1.5 px-space-sm text-right">{{ formatMoney(line.rate, currency) }}</td>
              <td class="num py-1.5 px-space-sm text-right">{{ formatMoney(line.amount, currency) }}</td>
              <td class="num py-1.5 px-space-sm text-right">
                {{
                  formatMoney(
                    printableVoucher.taxes
                      .filter((tax) => tax.taxCategoryId === line.taxCategoryId)
                      .reduce((sum, tax) => sum + tax.amount, 0),
                    currency,
                  )
                }}
              </td>
              <td class="num py-1.5 px-space-sm text-right font-bold">
                {{ formatMoney(line.amount, currency) }}
              </td>
            </tr>
            <tr v-if="!printableVoucher.items.length">
              <td colspan="6" class="py-3 text-center text-outline">No item lines on this voucher.</td>
            </tr>
          </tbody>
        </table>

        <div class="mt-space-md flex justify-end">
          <div class="w-64 space-y-1 text-numeric-sm">
            <div class="flex justify-between">
              <span class="text-on-surface-variant">Taxable value</span>
              <span class="num">{{ formatMoney(taxableValue, currency) }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-on-surface-variant">Tax</span>
              <span class="num">{{ formatMoney(draft.taxTotal.value, currency) }}</span>
            </div>
            <div class="flex justify-between border-t border-surface-container pt-1">
              <span class="font-bold">Total</span>
              <span class="num font-bold">{{ formatMoney(grandTotal, currency) }}</span>
            </div>
            <p class="text-label-xs text-outline">{{ amountInWords(grandTotal, currency) }}</p>
          </div>
        </div>
      </div>

      <template #footer>
        <BaseButton variant="text" @click="previewOpen = false">Close</BaseButton>
        <BaseButton variant="primary" icon="print" @click="printDocument">Print</BaseButton>
      </template>
    </BaseModal>
  </div>
</template>
