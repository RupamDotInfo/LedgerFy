<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import BaseButton from '@/components/ui/BaseButton.vue'
import BaseEmptyState from '@/components/ui/BaseEmptyState.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import StatTile from '@/components/ui/StatTile.vue'
import { ledgerClosingBalance } from '@/domain/accounting'
import type { Voucher, VoucherEntry } from '@/domain/types'
import { formatDate } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const router = useRouter()

const vouchers = ref<Voucher[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

const currency = computed(() => session.activeCompany?.baseCurrency ?? 'INR')

async function load() {
  const companyId = session.activeCompanyId
  if (!companyId) {
    vouchers.value = []
    loading.value = false
    return
  }
  loading.value = true
  error.value = null
  try {
    vouchers.value = await session.repository.listVouchers(companyId, { status: 'posted' })
  } catch (cause) {
    error.value =
      cause instanceof Error
        ? cause.message
        : 'The cash and bank balances could not be loaded.'
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => [session.activeCompanyId, session.activeYearId], load)

// ---------------------------------------------------------------------------
// Ledger balances
// ---------------------------------------------------------------------------

type CashAccountKind = 'cash' | 'bank'

interface CashAccountRow {
  id: string
  name: string
  kind: CashAccountKind
  opening: number
  debit: number
  credit: number
  closing: number
}

const cashAccounts = computed(() =>
  session.ledgers.filter((ledger) => ledger.type === 'cash' || ledger.type === 'bank'),
)

/** Every posted entry grouped by the ledger it belongs to. */
const entriesByLedger = computed(() => {
  const map = new Map<string, VoucherEntry[]>()
  for (const voucher of vouchers.value) {
    if (voucher.status !== 'posted') continue
    for (const entry of voucher.entries) {
      const bucket = map.get(entry.ledgerId)
      if (bucket) bucket.push(entry)
      else map.set(entry.ledgerId, [entry])
    }
  }
  return map
})

const accountRows = computed<CashAccountRow[]>(() =>
  cashAccounts.value.map((ledger) => {
    const balance = ledgerClosingBalance(ledger, entriesByLedger.value.get(ledger.id) ?? [])
    return {
      id: ledger.id,
      name: ledger.name,
      kind: ledger.type === 'bank' ? 'bank' : 'cash',
      opening: ledger.openingBalance,
      debit: balance.debitTotal,
      credit: balance.creditTotal,
      closing: balance.closing,
    }
  }),
)

const cashTotal = computed(() =>
  accountRows.value
    .filter((row) => row.kind === 'cash')
    .reduce((sum, row) => sum + row.closing, 0),
)

const bankTotal = computed(() =>
  accountRows.value
    .filter((row) => row.kind === 'bank')
    .reduce((sum, row) => sum + row.closing, 0),
)

const liquidity = computed(() => cashTotal.value + bankTotal.value)

const bankAccountCount = computed(
  () => accountRows.value.filter((row) => row.kind === 'bank').length,
)

const cashAccountCount = computed(
  () => accountRows.value.filter((row) => row.kind === 'cash').length,
)

// ---------------------------------------------------------------------------
// Recent bank movements
// ---------------------------------------------------------------------------

interface BankMovement {
  id: string
  voucherId: string
  ledgerId: string
  date: string
  number: string
  voucherType: string
  ledgerName: string
  description: string
  debit: number
  credit: number
  balance: number
}

const ledgerNames = computed(() => {
  const map = new Map<string, string>()
  for (const ledger of session.ledgers) map.set(ledger.id, ledger.name)
  return map
})

/** Bank movements in date order, each carrying the balance after that entry. */
const allBankMovements = computed<BankMovement[]>(() => {
  const bankIds = new Set(
    accountRows.value.filter((row) => row.kind === 'bank').map((row) => row.id),
  )
  const rows: BankMovement[] = []

  for (const voucher of vouchers.value) {
    if (voucher.status !== 'posted') continue
    for (const entry of voucher.entries) {
      if (!bankIds.has(entry.ledgerId)) continue
      if (entry.debit === 0 && entry.credit === 0) continue
      rows.push({
        id: `${voucher.id}:${entry.id}`,
        voucherId: voucher.id,
        ledgerId: entry.ledgerId,
        date: voucher.date,
        number: voucher.number,
        voucherType: voucher.type,
        ledgerName: ledgerNames.value.get(entry.ledgerId) ?? 'Unknown ledger',
        description: voucher.narration || entry.narration || '—',
        debit: entry.debit,
        credit: entry.credit,
        balance: 0,
      })
    }
  }

  rows.sort((left, right) =>
    left.date === right.date ? left.id.localeCompare(right.id) : left.date < right.date ? -1 : 1,
  )

  const running = new Map<string, number>()
  for (const row of rows) {
    const opening =
      accountRows.value.find((account) => account.id === row.ledgerId)?.opening ?? 0
    const next = (running.get(row.ledgerId) ?? opening) + row.debit - row.credit
    running.set(row.ledgerId, next)
    row.balance = next
  }

  return rows
})

const recentMovements = computed(() => {
  const { from, to } = session.activePeriod
  return allBankMovements.value
    .filter((row) => row.date >= from && row.date <= to)
    .slice()
    .reverse()
    .slice(0, 100)
})
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      title="Cash and bank"
      subtitle="Balances held by each cash and bank account"
      icon="account_balance_wallet"
    >
      <template #actions>
        <BaseButton
          size="sm"
          variant="outlined"
          icon="upload_file"
          @click="router.push('/banking/import')"
        >
          Import statement
        </BaseButton>
        <BaseButton
          size="sm"
          variant="primary"
          icon="fact_check"
          @click="router.push('/banking/reconciliation')"
        >
          Reconcile
        </BaseButton>
      </template>
    </PageHeader>

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
        <p class="font-semibold">Cash and bank could not be loaded</p>
        <p class="mt-0.5">{{ error }}</p>
      </div>

      <template v-else>
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Cash in hand"
            :value="formatMoney(cashTotal, currency)"
            icon="payments"
            :hint="`${cashAccountCount} cash account${cashAccountCount === 1 ? '' : 's'}`"
          />
          <StatTile
            label="Bank balance"
            :value="formatMoney(bankTotal, currency)"
            icon="account_balance"
            :hint="`${bankAccountCount} bank account${bankAccountCount === 1 ? '' : 's'}`"
          />
          <StatTile
            label="Combined liquidity"
            :value="formatMoney(liquidity, currency)"
            icon="savings"
            tone="info"
            hint="Cash in hand plus bank balance"
          />
          <StatTile
            label="Bank accounts"
            :value="String(bankAccountCount)"
            icon="account_balance_wallet"
            hint="Ledger type: bank"
          />
        </div>

        <div class="mt-space-md grid grid-cols-1 gap-space-md xl:grid-cols-12">
          <!-- Cash and bank ledger balances -->
          <section
            class="overflow-hidden rounded-md bg-surface-container-lowest shadow-sm xl:col-span-7"
          >
            <header class="flex items-center justify-between gap-3 px-space-md py-space-sm">
              <div class="flex items-center gap-space-sm">
                <MaterialIcon name="account_balance" :size="20" class="text-primary" />
                <h2 class="text-headline-sm text-on-surface">Cash and bank ledgers</h2>
              </div>
              <span class="text-label-xs text-outline">Opening to closing, posted vouchers only</span>
            </header>

            <div v-if="accountRows.length" class="overflow-x-auto">
              <table class="w-full text-left text-body-sm">
                <thead
                  class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline"
                >
                  <tr>
                    <th scope="col" class="px-space-md py-2.5">Account</th>
                    <th scope="col" class="px-space-sm py-2.5 text-right">Opening</th>
                    <th scope="col" class="px-space-sm py-2.5 text-right">Debits</th>
                    <th scope="col" class="px-space-sm py-2.5 text-right">Credits</th>
                    <th scope="col" class="px-space-md py-2.5 text-right">Closing</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-surface-container-low">
                  <tr
                    v-for="row in accountRows"
                    :key="row.id"
                    class="transition-colors hover:bg-surface-container-low/60"
                  >
                    <td class="px-space-md py-2.5">
                      <span class="block font-medium text-on-surface">{{ row.name }}</span>
                      <span class="text-label-xs uppercase tracking-wide text-outline">
                        {{ row.kind === 'bank' ? 'Bank' : 'Cash' }}
                      </span>
                    </td>
                    <td class="px-space-sm py-2.5 text-right text-numeric-sm tabular text-on-surface-variant">
                      {{ formatMoney(row.opening, currency) }}
                    </td>
                    <td class="px-space-sm py-2.5 text-right text-numeric-sm tabular text-on-surface-variant">
                      {{ formatMoney(row.debit, currency) }}
                    </td>
                    <td class="px-space-sm py-2.5 text-right text-numeric-sm tabular text-on-surface-variant">
                      {{ formatMoney(row.credit, currency) }}
                    </td>
                    <td
                      class="px-space-md py-2.5 text-right text-numeric-sm font-bold tabular"
                      :class="row.closing < 0 ? 'text-tertiary' : 'text-on-surface'"
                    >
                      {{ formatMoney(row.closing, currency) }}
                    </td>
                  </tr>
                </tbody>
                <tfoot class="bg-surface-container-low/60">
                  <tr class="text-numeric-sm font-bold">
                    <td class="px-space-md py-2.5 text-on-surface">Total</td>
                    <td class="px-space-sm py-2.5 text-right tabular text-on-surface-variant">
                      {{ formatMoney(cashTotal + bankTotal, currency) }}
                    </td>
                    <td class="px-space-sm py-2.5 text-right tabular text-on-surface-variant">—</td>
                    <td class="px-space-sm py-2.5 text-right tabular text-on-surface-variant">—</td>
                    <td class="px-space-md py-2.5 text-right tabular text-on-surface">
                      {{ formatMoney(liquidity, currency) }}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <BaseEmptyState
              v-else
              title="No cash or bank ledgers"
              description="This company has no cash or bank ledger, so no balances can be shown."
              :icon="MaterialIcon"
            />
          </section>

          <!-- Recent bank movements -->
          <section
            class="overflow-hidden rounded-md bg-surface-container-lowest shadow-sm xl:col-span-5"
          >
            <header class="flex items-center justify-between gap-3 px-space-md py-space-sm">
              <div class="flex items-center gap-space-sm">
                <MaterialIcon name="swap_vert" :size="20" class="text-primary" />
                <h2 class="text-headline-sm text-on-surface">Recent bank movements</h2>
              </div>
              <span class="text-label-xs text-outline">
                {{ recentMovements.length }} entr{{ recentMovements.length === 1 ? 'y' : 'ies' }}
              </span>
            </header>

            <div v-if="recentMovements.length" class="overflow-x-auto">
              <table class="w-full text-left text-body-sm">
                <thead
                  class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline"
                >
                  <tr>
                    <th scope="col" class="px-space-md py-2.5">Date</th>
                    <th scope="col" class="px-space-sm py-2.5">Voucher</th>
                    <th scope="col" class="px-space-sm py-2.5">Description</th>
                    <th scope="col" class="px-space-sm py-2.5 text-right">Debit</th>
                    <th scope="col" class="px-space-sm py-2.5 text-right">Credit</th>
                    <th scope="col" class="px-space-md py-2.5 text-right">Running balance</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-surface-container-low">
                  <tr
                    v-for="row in recentMovements"
                    :key="row.id"
                    class="cursor-pointer transition-colors hover:bg-surface-container-low/60"
                    @click="router.push(`/vouchers/${row.voucherId}`)"
                  >
                    <td class="whitespace-nowrap px-space-md py-2.5 text-numeric-sm tabular text-outline">
                      {{ formatDate(row.date) }}
                    </td>
                    <td class="px-space-sm py-2.5">
                      <span class="block text-numeric-sm font-semibold text-on-surface">
                        {{ row.number }}
                      </span>
                      <span class="block max-w-[150px] truncate text-label-xs text-outline">
                        {{ row.ledgerName }}
                      </span>
                    </td>
                    <td class="max-w-[220px] truncate px-space-sm py-2.5 text-on-surface-variant">
                      {{ row.description }}
                    </td>
                    <td class="px-space-sm py-2.5 text-right text-numeric-sm tabular text-on-surface-variant">
                      {{ formatMoney(row.debit, currency, { blankZero: true }) || '—' }}
                    </td>
                    <td class="px-space-sm py-2.5 text-right text-numeric-sm tabular text-on-surface-variant">
                      {{ formatMoney(row.credit, currency, { blankZero: true }) || '—' }}
                    </td>
                    <td
                      class="px-space-md py-2.5 text-right text-numeric-sm font-bold tabular"
                      :class="row.balance < 0 ? 'text-tertiary' : 'text-on-surface'"
                    >
                      {{ formatMoney(row.balance, currency) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <BaseEmptyState
              v-else
              title="No bank movements in this period"
              description="Post a receipt, payment or contra voucher against a bank ledger to see movement here."
              :icon="MaterialIcon"
            />

            <footer
              class="flex flex-wrap items-center justify-between gap-2 border-t border-surface-container bg-surface-container-low/60 px-space-md py-space-sm"
            >
              <span class="text-label-xs text-outline">
                Running balance is the bank ledger balance after each entry.
              </span>
              <button
                type="button"
                class="inline-flex items-center gap-1 text-label-md font-semibold text-primary hover:underline"
                @click="router.push('/banking/reconciliation')"
              >
                Reconcile against the statement
                <MaterialIcon name="arrow_forward" :size="14" />
              </button>
            </footer>
          </section>
        </div>
      </template>
    </div>
  </div>
</template>
