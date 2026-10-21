<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseEmptyState from '@/components/ui/BaseEmptyState.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import FilterBar from '@/components/ui/FilterBar.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import { voucherTypeLabel } from '@/app/labels'
import type { StatementLine, Voucher } from '@/domain/types'
import { formatDate } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { useSessionStore } from '@/stores/session'
import { useToastStore } from '@/stores/toast'

const session = useSessionStore()
const toast = useToastStore()

const lines = ref<StatementLine[]>([])
const vouchers = ref<Voucher[]>([])
const selectedLedgerId = ref<string | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const working = ref(false)

const currency = computed(() => session.activeCompany?.baseCurrency ?? 'INR')

const ledgerOptions = computed(() =>
  session.bankLedgers.map((ledger) => ({ value: ledger.id, label: ledger.name })),
)

const selectedLedgerName = computed(
  () => session.bankLedgers.find((ledger) => ledger.id === selectedLedgerId.value)?.name ?? '',
)

const voucherById = computed(() => {
  const map = new Map<string, Voucher>()
  for (const voucher of vouchers.value) map.set(voucher.id, voucher)
  return map
})

async function load() {
  const companyId = session.activeCompanyId
  if (!companyId) {
    lines.value = []
    loading.value = false
    return
  }
  loading.value = true
  error.value = null
  try {
    const [lineList, voucherList] = await Promise.all([
      session.repository.listStatementLines(
        companyId,
        selectedLedgerId.value ? { ledgerId: selectedLedgerId.value } : {},
      ),
      session.repository.listVouchers(companyId, { status: 'posted' }),
    ])
    lines.value = lineList
    vouchers.value = voucherList
  } catch (cause) {
    error.value =
      cause instanceof Error
        ? cause.message
        : 'The bank statement lines could not be loaded.'
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  if (!selectedLedgerId.value && session.bankLedgers.length) {
    selectedLedgerId.value = session.bankLedgers[0]!.id
  }
  await load()
})

watch(
  () => [session.activeCompanyId, session.activeYearId],
  async () => {
    await load()
  },
)

watch(selectedLedgerId, () => {
  void load()
})

/**
 * Masters are reloaded when the company changes, so the selected bank account
 * can point at a ledger of the previous company. Re-align it once the master
 * list for the new company is in place.
 */
watch(
  () => session.bankLedgers.map((ledger) => ledger.id).join(','),
  () => {
    const ids = session.bankLedgers.map((ledger) => ledger.id)
    if (selectedLedgerId.value && !ids.includes(selectedLedgerId.value)) {
      selectedLedgerId.value = ids[0] ?? null
    }
  },
)

// ---------------------------------------------------------------------------
// Line classification
// ---------------------------------------------------------------------------

const reconciledLines = computed(() => lines.value.filter((line) => line.isReconciled))

const suggestedLines = computed(() =>
  lines.value.filter((line) => !line.isReconciled && line.matchedVoucherId !== null),
)

const unmatchedLines = computed(() =>
  lines.value.filter((line) => !line.isReconciled && line.matchedVoucherId === null),
)

/** Lines the user already marked as a book entry to create. */
const bookEntryLines = computed(() =>
  unmatchedLines.value.filter((line) => line.matchReason.toLowerCase().includes('book entry')),
)

function isBookEntry(line: StatementLine): boolean {
  return bookEntryLines.value.some((entry) => entry.id === line.id)
}

const reconciledCount = computed(() => reconciledLines.value.length)
const unmatchedCount = computed(() => lines.value.length - reconciledCount.value)
const reconciledPercentage = computed(() =>
  lines.value.length ? (reconciledCount.value / lines.value.length) * 100 : 100,
)
const unmatchedAmount = computed(() =>
  lines.value
    .filter((line) => !line.isReconciled)
    .reduce((sum, line) => sum + line.amount, 0),
)

// ---------------------------------------------------------------------------
// Reconciliation actions
// ---------------------------------------------------------------------------

const pending = ref<{
  line: StatementLine
  voucherId: string | null
  voucherNumber: string
  label: string
} | null>(null)

function suggest(line: StatementLine) {
  const voucher = line.matchedVoucherId ? voucherById.value.get(line.matchedVoucherId) : undefined
  pending.value = {
    line,
    voucherId: line.matchedVoucherId,
    voucherNumber: voucher?.number ?? 'Unknown voucher',
    label: 'Reconcile this statement line',
  }
}

function markBookEntry(line: StatementLine) {
  pending.value = {
    line,
    voucherId: null,
    voucherNumber: '',
    label: 'Mark this statement line as a book entry',
  }
}

const pendingVoucher = computed<Voucher | null>(() => {
  const id = pending.value?.voucherId
  if (!id) return null
  return voucherById.value.get(id) ?? null
})

const pendingVoucherLabel = computed(() => {
  const voucher = pendingVoucher.value
  if (!voucher) return 'voucher'
  return `${voucher.number} (${voucherTypeLabel(voucher.type)})`
})

async function confirmPending() {
  const target = pending.value
  const companyId = session.activeCompanyId
  if (!target || !companyId) return

  working.value = true
  try {
    await session.repository.reconcileStatementLine(companyId, target.line.id, target.voucherId)
    pending.value = null
    toast.success(
      target.voucherId ? 'Statement line reconciled' : 'Book entry flagged',
      target.voucherId
        ? `${target.line.reference || target.line.description} now matches ${target.voucherNumber}.`
        : `${target.line.reference || target.line.description} is marked for a book entry.`,
    )
    await load()
  } catch (cause) {
    toast.error(
      'Reconciliation failed',
      cause instanceof Error ? cause.message : 'The statement line could not be updated.',
    )
  } finally {
    working.value = false
  }
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      title="Bank reconciliation"
      subtitle="Match imported statement lines against posted vouchers"
      icon="fact_check"
    />

    <FilterBar>
      <BaseSelect
        v-model="selectedLedgerId"
        :options="ledgerOptions"
        label="Bank account"
        size="sm"
        class="w-72"
      />
      <template #trailing>
        <span class="text-label-sm text-outline">
          {{ lines.length }} statement line{{ lines.length === 1 ? '' : 's' }} loaded
        </span>
      </template>
    </FilterBar>

    <div class="min-h-0 flex-1 overflow-auto p-space-lg">
      <div v-if="loading" class="space-y-space-md">
        <BaseSkeleton class="h-28" />
        <div class="grid grid-cols-1 gap-space-md lg:grid-cols-2">
          <BaseSkeleton class="h-72" />
          <BaseSkeleton class="h-72" />
        </div>
      </div>

      <div
        v-else-if="error"
        class="rounded-md border-l-4 border-l-error bg-error-container p-space-md text-body-md text-on-error-container"
        role="alert"
      >
        <p class="font-semibold">Statement lines could not be loaded</p>
        <p class="mt-0.5">{{ error }}</p>
      </div>

      <template v-else>
        <!-- Live connectivity notice -->
        <p
          class="mb-space-md flex items-start gap-space-sm rounded-md border-l-4 border-l-outline bg-surface-container-low p-space-md text-body-sm text-on-surface-variant"
        >
          <MaterialIcon name="wifi_off" :size="18" class="mt-0.5 shrink-0 text-outline" />
          <span>
            <strong class="font-semibold text-on-surface">Live bank connectivity is not configured.</strong>
            This workflow works on imported statements only. Import a CSV from
            <button
              type="button"
              class="font-semibold text-primary hover:underline"
              @click="$router.push('/banking/import')"
            >
              Statement import
            </button>
            and reconcile the lines here.
          </span>
        </p>

        <!-- Reconciliation summary -->
        <section class="rounded-md bg-surface-container-lowest p-space-md shadow-sm">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-space-sm">
              <MaterialIcon name="donut_large" :size="20" class="text-primary" />
              <h2 class="text-headline-sm text-on-surface">
                Reconciliation summary
                <span v-if="selectedLedgerName" class="text-body-sm font-normal text-outline">
                  — {{ selectedLedgerName }}
                </span>
              </h2>
            </div>
            <span class="text-label-xs text-outline">
              {{ reconciledCount }} of {{ lines.length }} lines cleared
            </span>
          </div>

          <div class="mt-space-md grid grid-cols-2 gap-space-sm lg:grid-cols-4">
            <div class="rounded-sm bg-surface-container-low p-space-sm">
              <span class="section-label">Reconciled</span>
              <p class="num text-numeric-lg font-bold text-secondary">
                {{ reconciledCount }}
              </p>
            </div>
            <div class="rounded-sm bg-surface-container-low p-space-sm">
              <span class="section-label">Unmatched</span>
              <p class="num text-numeric-lg font-bold text-tertiary">
                {{ unmatchedCount }}
              </p>
            </div>
            <div class="rounded-sm bg-surface-container-low p-space-sm">
              <span class="section-label">Reconciled percentage</span>
              <p class="num text-numeric-lg font-bold text-on-surface">
                {{ reconciledPercentage.toFixed(1) }}%
              </p>
            </div>
            <div class="rounded-sm bg-surface-container-low p-space-sm">
              <span class="section-label">Unmatched amount</span>
              <p class="num text-numeric-lg font-bold text-tertiary">
                {{ formatMoney(unmatchedAmount, currency, { signed: true }) }}
              </p>
            </div>
          </div>

          <div class="mt-space-md">
            <div
              class="h-2 w-full overflow-hidden rounded-full bg-surface-container-high"
              role="progressbar"
              :aria-valuenow="Math.round(reconciledPercentage)"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-label="`${reconciledCount} of ${lines.length} statement lines reconciled`"
            >
              <div
                class="h-2 rounded-full bg-secondary"
                :style="{ width: `${Math.min(100, Math.max(0, reconciledPercentage))}%` }"
              />
            </div>
            <p class="mt-1 text-label-xs text-outline">
              {{ reconciledCount }} of {{ lines.length }} lines cleared
            </p>
          </div>
        </section>

        <div class="mt-space-md grid grid-cols-1 items-start gap-space-md 2xl:grid-cols-2">
          <!-- Statement lines -->
          <section class="overflow-hidden rounded-md bg-surface-container-lowest shadow-sm">
            <header class="flex items-center justify-between gap-3 px-space-md py-space-sm">
              <div class="flex items-center gap-space-sm">
                <MaterialIcon name="receipt_long" :size="20" class="text-primary" />
                <h2 class="text-headline-sm text-on-surface">Statement lines</h2>
              </div>
              <BaseBadge tone="neutral" size="xs">{{ lines.length }}</BaseBadge>
            </header>

            <div v-if="lines.length" class="max-h-[26rem] overflow-auto">
              <table class="w-full text-left text-body-sm">
                <thead
                  class="sticky top-0 bg-surface-container-low text-label-xs uppercase tracking-wider text-outline"
                >
                  <tr>
                    <th scope="col" class="px-space-md py-2.5">Date</th>
                    <th scope="col" class="px-space-sm py-2.5">Description</th>
                    <th scope="col" class="px-space-sm py-2.5 text-right">Amount</th>
                    <th scope="col" class="px-space-md py-2.5 text-center">State</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-surface-container-low">
                  <tr v-for="line in lines" :key="line.id">
                    <td class="whitespace-nowrap px-space-md py-2.5 text-numeric-sm tabular text-outline">
                      {{ formatDate(line.date) }}
                    </td>
                    <td class="max-w-[220px] px-space-sm py-2.5">
                      <span class="block truncate text-on-surface">{{ line.description }}</span>
                      <span class="block truncate text-label-xs text-outline">
                        {{ line.reference || 'No reference' }}
                      </span>
                    </td>
                    <td
                      class="px-space-sm py-2.5 text-right text-numeric-sm font-semibold tabular"
                      :class="line.amount < 0 ? 'text-tertiary' : 'text-secondary'"
                    >
                      {{ formatMoney(line.amount, currency, { signed: true }) }}
                    </td>
                    <td class="px-space-md py-2.5 text-center">
                      <BaseBadge
                        v-if="line.isReconciled"
                        tone="positive"
                        size="xs"
                        icon="task_alt"
                      >
                        Reconciled
                      </BaseBadge>
                      <BaseBadge
                        v-else-if="line.matchedVoucherId"
                        tone="warning"
                        size="xs"
                        icon="match"
                      >
                        Suggested
                      </BaseBadge>
                      <BaseBadge v-else tone="danger" size="xs" icon="error">Unmatched</BaseBadge>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <BaseEmptyState
              v-else
              title="No statement lines"
              description="Import a bank statement to reconcile it against the books."
              :icon="MaterialIcon"
            />
          </section>

          <div class="flex flex-col gap-space-md">
            <!-- Suggested matches -->
            <section class="overflow-hidden rounded-md bg-surface-container-lowest shadow-sm">
              <header class="flex items-center justify-between gap-3 px-space-md py-space-sm">
                <div class="flex items-center gap-space-sm">
                  <MaterialIcon name="auto_awesome" :size="20" class="text-primary" />
                  <h2 class="text-headline-sm text-on-surface">Suggested matches</h2>
                </div>
                <BaseBadge tone="warning" size="xs">{{ suggestedLines.length }}</BaseBadge>
              </header>

              <div v-if="suggestedLines.length" class="max-h-[24rem] divide-y divide-surface-container-low overflow-auto">
                <article
                  v-for="line in suggestedLines"
                  :key="line.id"
                  class="px-space-md py-space-sm"
                >
                  <div class="flex flex-wrap items-baseline justify-between gap-2">
                    <div class="min-w-0">
                      <span class="text-numeric-sm tabular text-outline">
                        {{ formatDate(line.date) }}
                      </span>
                      <span class="ml-2 font-semibold text-on-surface">{{ line.description }}</span>
                    </div>
                    <span
                      class="num text-numeric-md font-bold tabular"
                      :class="line.amount < 0 ? 'text-tertiary' : 'text-secondary'"
                    >
                      {{ formatMoney(line.amount, currency, { signed: true }) }}
                    </span>
                  </div>

                  <p class="mt-0.5 text-label-sm text-on-surface-variant">
                    {{ line.matchReason }}
                  </p>

                  <div class="mt-space-xs flex flex-wrap items-center justify-between gap-2">
                    <div class="flex items-center gap-space-sm">
                      <BaseBadge tone="info" size="xs" icon="percent">
                        Confidence {{ (line.confidence * 100).toFixed(0) }}% ({{ line.confidence.toFixed(2) }})
                      </BaseBadge>
                      <span class="text-label-xs text-outline">
                        Reference: {{ line.reference || '—' }}
                      </span>
                    </div>
                    <BaseButton
                      size="xs"
                      variant="primary"
                      icon="task_alt"
                      @click="suggest(line)"
                    >
                      Reconcile
                    </BaseButton>
                  </div>
                </article>
              </div>

              <BaseEmptyState
                v-else
                size="sm"
                title="No suggestions pending"
                description="Every suggested match for this account has been confirmed."
                :icon="MaterialIcon"
              />
            </section>

            <!-- Unmatched lines -->
            <section class="overflow-hidden rounded-md bg-surface-container-lowest shadow-sm">
              <header class="flex items-center justify-between gap-3 px-space-md py-space-sm">
                <div class="flex items-center gap-space-sm">
                  <MaterialIcon name="link_off" :size="20" class="text-tertiary" />
                  <h2 class="text-headline-sm text-on-surface">Unmatched lines</h2>
                </div>
                <BaseBadge tone="danger" size="xs">{{ unmatchedLines.length }}</BaseBadge>
              </header>

              <div v-if="unmatchedLines.length" class="max-h-[24rem] divide-y divide-surface-container-low overflow-auto">
                <article
                  v-for="line in unmatchedLines"
                  :key="line.id"
                  class="px-space-md py-space-sm"
                >
                  <div class="flex flex-wrap items-baseline justify-between gap-2">
                    <div class="min-w-0">
                      <span class="text-numeric-sm tabular text-outline">
                        {{ formatDate(line.date) }}
                      </span>
                      <span class="ml-2 font-semibold text-on-surface">{{ line.description }}</span>
                    </div>
                    <span
                      class="num text-numeric-md font-bold tabular"
                      :class="line.amount < 0 ? 'text-tertiary' : 'text-secondary'"
                    >
                      {{ formatMoney(line.amount, currency, { signed: true }) }}
                    </span>
                  </div>

                  <p class="mt-0.5 text-label-sm text-on-surface-variant">{{ line.matchReason }}</p>

                  <div class="mt-space-xs flex flex-wrap items-center justify-between gap-2">
                    <div class="flex items-center gap-space-sm">
                      <BaseBadge
                        v-if="isBookEntry(line)"
                        tone="info"
                        size="xs"
                        icon="edit_note"
                      >
                        Book entry flagged
                      </BaseBadge>
                      <span class="text-label-xs text-outline">
                        Reference: {{ line.reference || '—' }}
                      </span>
                    </div>
                    <BaseButton
                      size="xs"
                      variant="outlined"
                      icon="post_add"
                      @click="markBookEntry(line)"
                    >
                      Create book entry
                    </BaseButton>
                  </div>
                </article>
              </div>

              <BaseEmptyState
                v-else
                size="sm"
                title="Nothing unmatched"
                description="Every statement line for this account is reconciled."
                :icon="MaterialIcon"
              />
            </section>
          </div>
        </div>
      </template>
    </div>

    <!-- Confirmation -->
    <BaseModal
      :open="pending !== null"
      :title="pending?.label ?? ''"
      size="sm"
      @close="pending = null"
    >
      <div v-if="pending" class="space-y-space-sm">
        <div class="rounded-sm bg-surface-container-low p-space-sm">
          <p class="text-label-sm text-outline">{{ formatDate(pending.line.date) }}</p>
          <p class="font-semibold text-on-surface">{{ pending.line.description }}</p>
          <p class="num mt-0.5 text-numeric-lg font-bold tabular text-on-surface">
            {{ formatMoney(pending.line.amount, currency, { signed: true }) }}
          </p>
        </div>

        <p v-if="pending.voucherId" class="text-body-sm text-on-surface-variant">
          This line will be matched with voucher
          <strong class="text-on-surface">{{ pendingVoucherLabel }}</strong>.
        </p>
        <p v-else class="text-body-sm text-on-surface-variant">
          No voucher matches this line. It will be flagged as a book entry so a
          payment or receipt can be created for it in the books.
        </p>
      </div>

      <template #footer>
        <BaseButton variant="outlined" size="sm" @click="pending = null">Cancel</BaseButton>
        <BaseButton
          variant="primary"
          size="sm"
          :loading="working"
          :icon="pending?.voucherId ? 'task_alt' : 'edit_note'"
          @click="confirmPending"
        >
          {{ pending?.voucherId ? 'Confirm reconciliation' : 'Flag book entry' }}
        </BaseButton>
      </template>
    </BaseModal>
  </div>
</template>
