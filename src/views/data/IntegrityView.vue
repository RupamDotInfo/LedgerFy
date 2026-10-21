<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import StatTile from '@/components/ui/StatTile.vue'
import { useSessionStore } from '@/stores/session'
import { balanceSheet, isBalanced, ledgerClosingBalance, trialBalance } from '@/domain/accounting'
import { formatMoney } from '@/lib/money'
import type { Voucher } from '@/domain/types'

interface CheckResult {
  id: string
  title: string
  rule: string
  passed: boolean
  /** How many records the check looked at. */
  records: number
  /** The records that broke the rule, named in full. */
  failures: string[]
  note?: string
}

const session = useSessionStore()

const vouchers = ref<Voucher[]>([])
const loading = ref(true)
const running = ref(false)
const error = ref<string | null>(null)
const lastRun = ref<string | null>(null)

const companyId = computed(() => session.activeCompanyId)
const currency = computed(() => session.activeCompany?.baseCurrency ?? 'INR')

const postedVouchers = computed(() => vouchers.value.filter((voucher) => voucher.status === 'posted'))

async function load() {
  if (!companyId.value) {
    vouchers.value = []
    loading.value = false
    return
  }
  loading.value = true
  error.value = null
  try {
    vouchers.value = await session.repository.listVouchers(companyId.value)
    lastRun.value = new Date().toISOString()
  } catch (cause) {
    error.value =
      cause instanceof Error ? cause.message : 'The vouchers could not be read for the checks.'
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(companyId, load)

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

const checks = computed<CheckResult[]>(() => {
  const ledgers = session.ledgers
  const posted = postedVouchers.value
  const results: CheckResult[] = []

  // 1. Every posted voucher is balanced.
  const unbalanced = posted.filter((voucher) => !isBalanced(voucher))
  results.push({
    id: 'voucher-balance',
    title: 'Every posted voucher is balanced',
    rule: 'The debits of a posted voucher must equal its credits.',
    passed: unbalanced.length === 0,
    records: posted.length,
    failures: unbalanced.map((voucher) => `${voucher.number} (${voucher.date})`),
  })

  // 2. The trial balance nets to zero.
  const trial = trialBalance(ledgers, posted)
  results.push({
    id: 'trial-balance',
    title: 'The trial balance nets to zero',
    rule: 'Total debits must equal total credits across the whole book.',
    passed: trial.closingNet === 0,
    records: trial.rows.length,
    failures:
      trial.closingNet === 0
        ? []
        : [
            `Debits ${formatMoney(trial.totalDebit, currency.value)} against credits ${formatMoney(
              trial.totalCredit,
              currency.value,
            )}, a difference of ${formatMoney(trial.closingNet, currency.value, { signed: true })}.`,
          ],
    note: `Total debits ${formatMoney(trial.totalDebit, currency.value)} against total credits ${formatMoney(
      trial.totalCredit,
      currency.value,
    )}.`,
  })

  // 3. The balance sheet balances.
  const sheet = balanceSheet(ledgers, posted)
  results.push({
    id: 'balance-sheet',
    title: 'The balance sheet balances',
    rule: 'Assets must equal liabilities plus equity, including the profit of the period.',
    passed: sheet.difference === 0,
    records: sheet.assetRows.length + sheet.liabilityRows.length + sheet.equityRows.length,
    failures:
      sheet.difference === 0
        ? []
        : [
            `Assets ${formatMoney(sheet.assets, currency.value)} against liabilities and equity ${formatMoney(
              sheet.liabilities + sheet.totalEquity,
              currency.value,
            )}, a difference of ${formatMoney(sheet.difference, currency.value, { signed: true })}.`,
          ],
  })

  // 4. Ledger balances reconcile to the entries behind them.
  const entriesByLedger = new Map<string, Voucher['entries']>()
  for (const voucher of posted) {
    for (const entry of voucher.entries) {
      const bucket = entriesByLedger.get(entry.ledgerId)
      if (bucket) bucket.push(entry)
      else entriesByLedger.set(entry.ledgerId, [entry])
    }
  }
  const reconciliationFailures: string[] = []
  let reconciliationRecords = 0
  for (const row of trial.rows) {
    const ledger = ledgers.find((candidate) => candidate.id === row.ledgerId)
    if (!ledger) continue
    reconciliationRecords += 1
    const recomputed = ledgerClosingBalance(ledger, entriesByLedger.get(ledger.id) ?? [])
    if (
      recomputed.debitTotal !== row.debit ||
      recomputed.creditTotal !== row.credit ||
      recomputed.closing !== row.closing
    ) {
      reconciliationFailures.push(
        `${row.ledgerName}: trial balance shows ${formatMoney(row.closing, currency.value)} but the entries behind it give ${formatMoney(
          recomputed.closing,
          currency.value,
        )}.`,
      )
    }
  }
  const orphanEntries = posted.flatMap((voucher) =>
    voucher.entries
      .filter((entry) => !ledgers.some((ledger) => ledger.id === entry.ledgerId))
      .map((entry) => `${voucher.number} has a line on a ledger that no longer exists (${entry.ledgerId}).`),
  )
  results.push({
    id: 'ledger-reconciliation',
    title: 'Ledger balances reconcile to their entries',
    rule: 'Each ledger in the trial balance must equal the entries that were posted to it.',
    passed: reconciliationFailures.length === 0 && orphanEntries.length === 0,
    records: reconciliationRecords,
    failures: [...reconciliationFailures, ...orphanEntries],
  })

  // 5. No voucher number is used twice.
  const byNumber = new Map<string, Voucher[]>()
  for (const voucher of vouchers.value) {
    const bucket = byNumber.get(voucher.number)
    if (bucket) bucket.push(voucher)
    else byNumber.set(voucher.number, [voucher])
  }
  const duplicates: string[] = []
  for (const [number, group] of byNumber) {
    if (group.length > 1) {
      duplicates.push(
        `${number} is used by ${group.length} vouchers: ${group
          .map((voucher) => `${voucher.type} dated ${voucher.date}`)
          .join(', ')}.`,
      )
    }
  }
  results.push({
    id: 'duplicate-numbers',
    title: 'No voucher number is used twice',
    rule: 'Every voucher number must be unique inside the company.',
    passed: duplicates.length === 0,
    records: byNumber.size,
    failures: duplicates,
  })

  // 6. No unfinished work inside a closed financial year.
  const closedYears = session.financialYears.filter((year) => year.isClosed)
  const inClosedYear = vouchers.value.filter((voucher) =>
    closedYears.some((year) => voucher.date >= year.start && voucher.date <= year.end),
  )
  const openWork = inClosedYear.filter((voucher) => voucher.status === 'draft')
  results.push({
    id: 'closed-year',
    title: 'No unfinished work inside a closed financial year',
    rule: 'A closed financial year may hold posted vouchers, but nothing may still be sitting in draft.',
    passed: openWork.length === 0,
    records: inClosedYear.length,
    failures: openWork.map((voucher) => `${voucher.number} (${voucher.date}) is still a draft.`),
    note: closedYears.length
      ? `Closed years: ${closedYears.map((year) => year.label).join(', ')}. The demo repository does not implement period locking, so the vouchers of a closed year are not flagged as locked.`
      : 'No financial year of this company is closed.',
  })

  return results
})

const passedCount = computed(() => checks.value.filter((check) => check.passed).length)
const failedCount = computed(() => checks.value.filter((check) => !check.passed).length)
const failingRecords = computed(() =>
  checks.value.reduce((sum, check) => sum + check.failures.length, 0),
)

async function runChecks() {
  running.value = true
  await load()
  running.value = false
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      title="Integrity check"
      subtitle="Run the accounting rules over the books and see what fails"
      icon="fact_check"
      :breadcrumb="[{ label: 'Data and tools', to: '/data/integrity' }, { label: 'Integrity check' }]"
    >
      <template #actions>
        <BaseButton size="sm" variant="primary" icon="refresh" :loading="running" @click="runChecks">
          Run checks
        </BaseButton>
      </template>
    </PageHeader>

    <div class="min-h-0 flex-1 overflow-auto p-space-lg">
      <div v-if="loading && !vouchers.length" class="space-y-space-md">
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-4">
          <BaseSkeleton v-for="index in 4" :key="index" class="h-24" />
        </div>
        <BaseSkeleton class="h-72" />
      </div>

      <template v-else>
        <!-- Summary -->
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Checks run"
            :value="String(checks.length)"
            icon="fact_check"
            tone="info"
            :hint="`${passedCount} passed, ${failedCount} failed`"
          />
          <StatTile
            label="Checks passed"
            :value="String(passedCount)"
            icon="check_circle"
            :tone="failedCount ? 'warning' : 'positive'"
            :hint="failedCount ? `${failedCount} rule${failedCount === 1 ? '' : 's'} broken` : 'Every rule holds'"
          />
          <StatTile
            label="Records involved"
            :value="String(vouchers.length)"
            icon="receipt_long"
            hint="Vouchers read from the repository"
          />
          <StatTile
            label="Records at fault"
            :value="String(failingRecords)"
            icon="report"
            :tone="failingRecords ? 'danger' : 'positive'"
            hint="Named in the failing checks below"
          />
        </div>

        <p
          v-if="error"
          class="mt-space-md flex items-start gap-space-sm rounded-md border-l-4 border-l-error bg-error-container p-space-sm text-body-sm text-on-error-container"
          role="alert"
        >
          <MaterialIcon name="error" :size="18" class="mt-0.5 shrink-0" />
          {{ error }}
        </p>

        <!-- Checks -->
        <section class="mt-space-md space-y-space-md">
          <article
            v-for="check in checks"
            :key="check.id"
            class="overflow-hidden rounded-md bg-surface-container-lowest shadow-sm"
          >
            <header class="flex flex-wrap items-start justify-between gap-3 px-space-md py-space-sm">
              <div class="min-w-0">
                <h2 class="text-headline-sm text-on-surface">{{ check.title }}</h2>
                <p class="mt-0.5 text-label-sm text-outline">{{ check.rule }}</p>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <span class="text-label-xs text-outline">
                  {{ check.records }} record{{ check.records === 1 ? '' : 's' }} checked
                </span>
                <BaseBadge
                  v-if="check.passed"
                  tone="positive"
                  size="sm"
                  icon="check_circle"
                >
                  Pass
                </BaseBadge>
                <BaseBadge v-else tone="danger" size="sm" icon="cancel">Fail</BaseBadge>
              </div>
            </header>

            <div v-if="check.note" class="border-t border-surface-container px-space-md py-2">
              <p class="text-label-sm text-on-surface-variant">{{ check.note }}</p>
            </div>

            <div
              v-if="!check.passed"
              class="border-t border-surface-container bg-error-container/20 px-space-md py-space-sm"
            >
              <p class="flex items-center gap-1 text-label-md font-semibold text-on-error-container">
                <MaterialIcon name="error" :size="15" />
                {{ check.failures.length }} record{{ check.failures.length === 1 ? '' : 's' }} broke
                this rule
              </p>
              <ul class="mt-space-xs space-y-1">
                <li
                  v-for="(failure, index) in check.failures"
                  :key="index"
                  class="flex items-start gap-1.5 text-body-sm text-on-surface-variant"
                >
                  <MaterialIcon name="chevron_right" :size="15" class="mt-0.5 shrink-0 text-outline" />
                  <span>{{ failure }}</span>
                </li>
              </ul>
            </div>

            <p
              v-else
              class="border-t border-surface-container bg-surface-container-low/60 px-space-md py-2 text-label-sm text-on-surface-variant"
            >
              The rule holds across every record that was checked.
            </p>
          </article>
        </section>

        <!-- Scope -->
        <section class="mt-space-md rounded-md bg-surface-container-lowest p-space-md shadow-sm">
          <h2 class="text-headline-sm text-on-surface">What was checked</h2>
          <div class="mt-space-md grid grid-cols-1 gap-space-md md:grid-cols-2">
            <div class="rounded-sm bg-surface-container-low p-space-sm text-body-sm text-on-surface-variant">
              <p class="flex items-center gap-1 text-label-md font-semibold text-on-surface">
                <MaterialIcon name="info" :size="15" class="text-primary" />
                Scope of the run
              </p>
              <p class="mt-0.5">
                Every voucher of
                {{ session.activeCompany?.name ?? 'the company' }} was read from the repository
                ({{ vouchers.length }} in total, of which {{ postedVouchers.length }} are posted).
                The trial balance and the balance sheet are computed over the posted vouchers only,
                which is the same rule the reports use.
              </p>
            </div>
            <div class="rounded-sm bg-surface-container-low p-space-sm text-body-sm text-on-surface-variant">
              <p class="flex items-center gap-1 text-label-md font-semibold text-on-surface">
                <MaterialIcon name="info" :size="15" class="text-primary" />
                Where the figures come from
              </p>
              <p class="mt-0.5">
                The balances are produced by the accounting domain, not by this screen. This screen
                only compares the domain results with each other and names the records that
                disagree. Last run
                {{ lastRun ? new Date(lastRun).toLocaleTimeString('en-IN') : 'not yet' }}.
              </p>
            </div>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>
