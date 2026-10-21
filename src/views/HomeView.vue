<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import TrendChart from '@/components/charts/TrendChart.vue'
import { useSessionStore } from '@/stores/session'
import { voucherTypeLabel } from '@/app/labels'
import { totalDebit } from '@/domain/accounting'
import { formatQuantity } from '@/domain/quantity'
import { formatMoney } from '@/lib/money'
import { formatDate, formatPeriod } from '@/lib/datetime'
import type { DashboardSnapshot } from '@/repositories/contracts'

const session = useSessionStore()
const router = useRouter()

const snapshot = ref<DashboardSnapshot | null>(null)
const loading = ref(true)

const currency = computed(() => session.activeCompany?.baseCurrency ?? 'INR')

async function load() {
  if (!session.activeCompanyId) return
  loading.value = true
  snapshot.value = await session.repository.getDashboard(
    session.activeCompanyId,
    session.activePeriod,
  )
  loading.value = false
}

onMounted(load)
watch(() => [session.activeCompanyId, session.activeYearId], load)

const periodLabel = computed(() => {
  const period = session.activePeriod
  return `${formatDate(period.from)} to ${formatDate(period.to)}`
})

const closedYear = computed(
  () => session.financialYears.find((year) => year.isClosed)?.end ?? null,
)

const quickActions = [
  { label: 'Sales Inv', icon: 'add', to: '/vouchers/new/sales', key: 'F8', tone: 'primary' },
  { label: 'Purchase', icon: 'shopping_bag', to: '/vouchers/new/purchase', key: 'F9', tone: 'primary' },
  { label: 'Payment', icon: 'arrow_outward', to: '/vouchers/new/payment', key: 'F5', tone: 'tertiary' },
  { label: 'Receipt', icon: 'arrow_downward', to: '/vouchers/new/receipt', key: 'F6', tone: 'secondary' },
  { label: 'Day Book', icon: 'menu_book', to: '/vouchers', key: 'F3', tone: 'outline' },
  { label: 'Trial Balance', icon: 'balance', to: '/reports/trial-balance', key: 'T', tone: 'filled' },
] as const

const iconTone: Record<string, string> = {
  primary: 'text-primary',
  tertiary: 'text-tertiary',
  secondary: 'text-secondary',
  outline: 'text-outline',
  filled: '',
}

function voucherTone(type: string): string {
  if (type === 'sales') return 'bg-primary-container text-on-primary-container'
  if (type === 'purchase') return 'bg-primary-fixed text-on-primary-fixed'
  if (type === 'receipt') return 'bg-secondary-container text-on-secondary-container'
  if (type === 'payment') return 'bg-tertiary-fixed text-on-tertiary-fixed'
  return 'bg-surface-container-highest text-on-surface'
}
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="mx-auto w-full max-w-[1600px] space-y-space-md px-space-lg py-space-md">
      <!-- Operating period and rapid actions -->
      <header class="relative overflow-hidden rounded-md bg-surface-container-lowest p-space-md shadow-sm">
        <div class="flex flex-col justify-between gap-space-md lg:flex-row lg:items-center">
          <div class="flex min-w-0 flex-col">
            <div class="flex flex-wrap items-center gap-space-sm">
              <h1 class="text-headline-md tracking-tight text-on-surface">Executive Operating Dashboard</h1>
              <span
                class="rounded-sm bg-secondary-container px-space-xs py-0.5 text-label-xs font-bold uppercase tracking-wide text-on-secondary-container"
              >
                Q3 Active
              </span>
              <span
                class="rounded-sm bg-surface-container-high px-space-xs py-0.5 text-numeric-sm text-on-surface-variant"
              >
                FY {{ session.activeFinancialYear?.label ?? '—' }}
              </span>
              <BaseBadge
            v-if="session.activeCompany?.isDemo"
            tone="warning"
            size="xs"
            icon="science"
          >
            Sample books
          </BaseBadge>
          <BaseBadge
            v-else-if="session.activeCompany"
            tone="neutral"
            size="xs"
            icon="database"
          >
            Saved locally
          </BaseBadge>
            </div>
            <div class="mt-0.5 flex flex-wrap items-center gap-space-sm text-body-sm text-outline">
              <span class="text-label-md text-on-surface-variant">
                {{ session.activeCompany?.name ?? 'No company open' }}
              </span>
              <span>•</span>
              <span>Period: {{ periodLabel }}</span>
              <span v-if="closedYear">•</span>
              <span
                v-if="closedYear"
                class="flex items-center gap-1 text-numeric-sm font-semibold text-secondary"
              >
                <MaterialIcon name="lock" :size="14" />
                Books Closed: {{ formatDate(closedYear) }}
              </span>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-1.5">
            <button
              v-for="action in quickActions"
              :key="action.key"
              type="button"
              class="flex items-center gap-1 rounded-sm px-space-sm py-1.5 shadow-sm transition-all active:scale-95"
              :class="
                action.tone === 'filled'
                  ? 'bg-primary text-on-primary hover:bg-primary-container'
                  : 'bg-surface-container-low text-on-surface hover:bg-surface-container-high'
              "
              @click="router.push(action.to)"
            >
              <MaterialIcon
                :name="action.icon"
                :size="16"
                :class="action.tone === 'filled' ? '' : iconTone[action.tone]"
              />
              <span class="text-label-sm">{{ action.label }}</span>
              <span
                class="rounded-sm px-1 text-label-xs font-bold"
                :class="
                  action.tone === 'filled'
                    ? 'bg-on-primary-fixed-variant/40 text-on-primary'
                    : action.tone === 'primary'
                      ? 'bg-primary-fixed text-on-primary-fixed'
                      : 'bg-surface-container-high text-outline'
                "
              >
                {{ action.key }}
              </span>
            </button>
          </div>
        </div>
      </header>

      <div v-if="loading && !snapshot" class="space-y-space-md">
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-4">
          <BaseSkeleton v-for="index in 4" :key="index" class="h-44" />
        </div>
        <BaseSkeleton class="h-72" />
      </div>

      <template v-else-if="snapshot">
        <!-- Working capital cards -->
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-4">
          <!-- Liquidity -->
          <div class="group relative overflow-hidden rounded-md bg-surface-container-lowest p-space-md shadow-sm transition-shadow hover:shadow-md">
            <div class="flex items-center justify-between text-outline">
              <span class="section-label">Cash &amp; Bank Liquidity</span>
              <MaterialIcon name="account_balance" :size="18" class="text-primary" />
            </div>
            <div class="mt-space-xs flex items-baseline justify-between gap-2">
              <span class="num truncate text-headline-lg font-bold tracking-tight text-on-surface">
                {{ formatMoney(snapshot.cash.total, currency) }}
              </span>
            </div>
            <p class="mt-0.5 text-label-xs text-outline">
              {{ snapshot.cashBreakdown.length }} cash and bank accounts
            </p>
            <div class="mt-space-md space-y-1 rounded-sm bg-surface-container-low/70 p-space-xs text-body-sm">
              <div
                v-for="line in snapshot.cashBreakdown.slice(0, 4)"
                :key="line.ledgerId"
                class="flex items-center justify-between text-on-surface-variant"
              >
                <span class="min-w-0 truncate">{{ line.name }}</span>
                <span class="num shrink-0 font-bold text-on-surface">
                  {{ formatMoney(line.amount, currency) }}
                </span>
              </div>
              <p v-if="!snapshot.cashBreakdown.length" class="text-outline">No cash or bank ledgers.</p>
            </div>
          </div>

          <!-- Debtors -->
          <div class="group relative overflow-hidden rounded-md bg-surface-container-lowest p-space-md shadow-sm transition-shadow hover:shadow-md">
            <div class="flex items-center justify-between text-outline">
              <span class="section-label">Accounts Receivable (Debtors)</span>
              <MaterialIcon name="assignment_turned_in" :size="18" class="text-secondary" />
            </div>
            <div class="mt-space-xs flex items-baseline justify-between gap-2">
              <span class="num truncate text-headline-lg font-bold tracking-tight text-on-surface">
                {{ formatMoney(snapshot.receivables, currency) }}
              </span>
            </div>
            <p class="mt-0.5 text-label-xs text-outline">
              {{ snapshot.overdueReceivables.count }} invoices past the due date
            </p>
            <div class="mt-space-md space-y-1 rounded-sm bg-surface-container-low/70 p-space-xs text-body-sm">
              <div class="flex items-center justify-between font-medium text-tertiary">
                <span class="flex items-center gap-1">
                  <span class="size-1.5 rounded-full bg-tertiary" aria-hidden="true" />
                  Overdue receivables
                </span>
                <span class="num font-bold">
                  {{ formatMoney(snapshot.overdueReceivables.amount, currency) }}
                </span>
              </div>
              <div class="flex items-center justify-between text-on-surface-variant">
                <span>Not yet due</span>
                <span class="num font-bold text-on-surface">
                  {{
                    formatMoney(
                      Math.max(0, snapshot.receivables - snapshot.overdueReceivables.amount),
                      currency,
                    )
                  }}
                </span>
              </div>
              <button
                type="button"
                class="flex items-center gap-1 pt-0.5 text-label-xs text-primary hover:underline"
                @click="router.push('/reports/receivables')"
              >
                Debtor ageing ledger
                <MaterialIcon name="arrow_forward" :size="14" />
              </button>
            </div>
          </div>

          <!-- Creditors -->
          <div class="group relative overflow-hidden rounded-md bg-surface-container-lowest p-space-md shadow-sm transition-shadow hover:shadow-md">
            <div class="flex items-center justify-between text-outline">
              <span class="section-label">Accounts Payable (Creditors)</span>
              <MaterialIcon name="schedule" :size="18" class="text-tertiary" />
            </div>
            <div class="mt-space-xs flex items-baseline justify-between gap-2">
              <span class="num truncate text-headline-lg font-bold tracking-tight text-on-surface">
                {{ formatMoney(snapshot.payables, currency) }}
              </span>
            </div>
            <p class="mt-0.5 text-label-xs text-outline">
              {{ snapshot.pendingBills.count }} purchase bills awaiting payment
            </p>
            <div class="mt-space-md space-y-1 rounded-sm bg-surface-container-low/70 p-space-xs text-body-sm">
              <div class="flex items-center justify-between font-medium text-tertiary">
                <span>Awaiting payment</span>
                <span class="num font-bold">
                  {{ formatMoney(snapshot.pendingBills.amount, currency) }}
                </span>
              </div>
              <div class="flex items-center justify-between text-on-surface-variant">
                <span>Open purchase bills</span>
                <span class="num font-bold text-on-surface">
                  {{ snapshot.pendingBills.count }}
                </span>
              </div>
              <button
                type="button"
                class="flex items-center gap-1 pt-0.5 text-label-xs text-primary hover:underline"
                @click="router.push('/reports/payables')"
              >
                Creditor ageing ledger
                <MaterialIcon name="arrow_forward" :size="14" />
              </button>
            </div>
          </div>

          <!-- Revenue and margin -->
          <div class="group relative overflow-hidden rounded-md bg-surface-container-lowest p-space-md shadow-sm transition-shadow hover:shadow-md">
            <div class="flex items-center justify-between text-outline">
              <span class="section-label">Revenue &amp; Margin (Period)</span>
              <MaterialIcon name="trending_up" :size="18" class="text-secondary" />
            </div>
            <div class="mt-space-xs flex items-baseline justify-between gap-2">
              <span class="num truncate text-headline-lg font-bold tracking-tight text-on-surface">
                {{ formatMoney(snapshot.sales, currency) }}
              </span>
            </div>
            <p class="mt-0.5 text-label-xs text-outline">
              {{ snapshot.marginPercent.toFixed(1) }}% net margin for the period
            </p>
            <div class="mt-space-md space-y-1 rounded-sm bg-surface-container-low/70 p-space-xs text-body-sm">
              <div class="flex items-center justify-between text-on-surface-variant">
                <span>Net operating profit</span>
                <span class="num font-bold text-secondary">
                  {{ formatMoney(snapshot.profit, currency) }}
                </span>
              </div>
              <div class="flex items-center justify-between text-on-surface-variant">
                <span>Total operating expenses</span>
                <span class="num font-bold text-on-surface">
                  {{ formatMoney(snapshot.expenses, currency) }}
                </span>
              </div>
              <div class="flex items-center justify-between text-outline">
                <span>Purchases</span>
                <span class="num font-bold text-primary">
                  {{ formatMoney(snapshot.purchases, currency) }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Command centre -->
        <div class="grid grid-cols-1 items-start gap-space-md lg:grid-cols-12">
          <div class="flex flex-col gap-space-md lg:col-span-7">
            <!-- Cash flow -->
            <div class="rounded-md bg-surface-container-lowest p-space-md shadow-sm">
              <div class="mb-space-sm flex items-center justify-between">
                <div class="flex items-center gap-space-sm">
                  <MaterialIcon name="show_chart" :size="20" class="text-primary" />
                  <span class="text-headline-sm text-on-surface">Cash Flow &amp; Liquidity Velocity</span>
                </div>
                <div class="flex items-center gap-space-sm">
                  <span class="flex items-center gap-1 text-label-xs text-outline">
                    <span class="size-2.5 rounded bg-primary" aria-hidden="true" />Inflows
                  </span>
                  <span class="flex items-center gap-1 text-label-xs text-outline">
                    <span class="size-2.5 rounded bg-tertiary" aria-hidden="true" />Outflows
                  </span>
                  <span
                    class="rounded-sm bg-surface-container-high px-2 py-0.5 text-label-xs font-bold text-on-surface-variant"
                  >
                    Last {{ snapshot.monthly.length }} months
                  </span>
                </div>
              </div>

              <TrendChart :points="snapshot.monthly" :currency="currency" />

              <div class="mt-space-sm grid grid-cols-3 gap-space-sm pt-space-xs text-center">
                <div class="rounded-sm bg-surface-container-low p-2">
                  <span class="block text-label-xs text-outline">Average monthly income</span>
                  <span class="num text-numeric-md font-bold text-on-surface">
                    {{
                      formatMoney(
                        Math.round(
                          snapshot.monthly.reduce((sum, point) => sum + point.income, 0) /
                            Math.max(1, snapshot.monthly.length),
                        ),
                        currency,
                      )
                    }}
                  </span>
                </div>
                <div class="rounded-sm bg-surface-container-low p-2">
                  <span class="block text-label-xs text-outline">Average monthly expense</span>
                  <span class="num text-numeric-md font-bold text-tertiary">
                    {{
                      formatMoney(
                        Math.round(
                          snapshot.monthly.reduce((sum, point) => sum + point.expense, 0) /
                            Math.max(1, snapshot.monthly.length),
                        ),
                        currency,
                      )
                    }}
                  </span>
                </div>
                <div class="rounded-sm bg-secondary-container/40 p-2">
                  <span class="block text-label-xs text-on-secondary-container">
                    Operating free cash flow
                  </span>
                  <span class="num text-numeric-md font-bold text-on-secondary-container">
                    {{
                      formatMoney(
                        snapshot.monthly.reduce(
                          (sum, point) => sum + point.income - point.expense,
                          0,
                        ),
                        currency,
                        { signed: true },
                      )
                    }}
                  </span>
                </div>
              </div>
            </div>

            <!-- Recent vouchers -->
            <div class="overflow-hidden rounded-md bg-surface-container-lowest shadow-sm">
              <div class="flex items-center justify-between p-space-md">
                <div class="flex items-center gap-space-sm">
                  <MaterialIcon name="receipt_long" :size="20" class="text-on-surface" />
                  <span class="text-headline-sm text-on-surface">Live Voucher Log &amp; Day Entries</span>
                </div>
                <button
                  type="button"
                  class="inline-flex items-center gap-1 text-label-md text-primary transition-colors hover:text-on-primary-fixed-variant hover:underline"
                  @click="router.push('/vouchers')"
                >
                  View all vouchers in the day book
                  <span class="kbd ml-1">Ctrl D</span>
                </button>
              </div>

              <div class="overflow-x-auto">
                <table class="w-full text-left text-body-sm">
                  <thead
                    class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline"
                  >
                    <tr>
                      <th class="px-space-md py-2.5">Type &amp; Ref #</th>
                      <th class="px-space-sm py-2.5">Date</th>
                      <th class="px-space-md py-2.5">Particulars / Ledger Entity</th>
                      <th class="px-space-md py-2.5 text-right">Debit (Dr)</th>
                      <th class="px-space-md py-2.5 text-right">Credit (Cr)</th>
                      <th class="px-space-md py-2.5 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-surface-container-low">
                    <tr
                      v-for="voucher in snapshot.recentVouchers"
                      :key="voucher.id"
                      class="cursor-pointer transition-colors hover:bg-surface-container-low/60"
                      @click="router.push(`/vouchers/${voucher.id}`)"
                    >
                      <td class="px-space-md py-2.5 text-numeric-sm">
                        <span
                          class="mr-1.5 inline-block rounded-sm px-1.5 py-0.5 text-[10px] font-bold"
                          :class="voucherTone(voucher.type)"
                        >
                          {{ voucherTypeLabel(voucher.type).toUpperCase() }}
                        </span>
                        <span class="font-bold text-on-surface">{{ voucher.number }}</span>
                      </td>
                      <td class="px-space-sm py-2.5 text-numeric-sm text-outline">
                        {{ formatDate(voucher.date).slice(0, 6) }}
                      </td>
                      <td class="max-w-[260px] truncate px-space-md py-2.5 font-medium text-on-surface">
                        {{ voucher.narration }}
                      </td>
                      <td class="px-space-md py-2.5 text-right text-numeric-sm text-outline">—</td>
                      <td
                        class="px-space-md py-2.5 text-right text-numeric-sm font-bold text-secondary"
                      >
                        {{ formatMoney(totalDebit(voucher), currency) }}
                      </td>
                      <td class="px-space-md py-2.5 text-center">
                        <span
                          class="inline-flex items-center gap-1 rounded-full bg-surface-container-high px-2 py-0.5 text-label-xs font-semibold text-on-surface-variant"
                        >
                          <MaterialIcon
                            :name="voucher.status === 'posted' ? 'task_alt' : 'edit_note'"
                            :size="12"
                          />
                          {{ voucher.status === 'posted' ? 'Posted' : 'Draft' }}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div
                class="flex items-center justify-between bg-surface-container-low/60 px-space-sm py-space-sm text-numeric-sm text-outline"
              >
                <span>Showing the latest {{ snapshot.recentVouchers.length }} entries in this period</span>
                <span>
                  Trial balance check:
                  <strong class="text-on-surface">balanced</strong>
                </span>
              </div>
            </div>
          </div>

          <div class="flex flex-col gap-space-md lg:col-span-5">
            <!-- GST readiness -->
            <div class="rounded-md bg-surface-container-lowest p-space-md shadow-sm">
              <div class="mb-space-sm flex items-center justify-between">
                <div class="flex items-center gap-space-sm">
                  <MaterialIcon name="verified_user" :size="20" class="text-secondary" />
                  <span class="text-headline-sm text-on-surface">GST &amp; Statutory Compliance</span>
                </div>
                <span class="shrink-0 whitespace-nowrap text-numeric-sm text-outline">
                  GSTIN: {{ session.activeCompany?.gstin ?? 'Not configured' }}
                </span>
              </div>

              <div class="space-y-space-sm">
                <div class="flex items-center justify-between rounded-sm bg-surface-container-low p-space-sm">
                  <div class="flex items-center gap-space-sm">
                    <MaterialIcon name="task_alt" :size="22" class="text-secondary" />
                    <div>
                      <div class="flex items-center gap-2">
                        <span class="text-label-md font-bold text-on-surface">
                          GSTR-1 ({{ formatPeriod(snapshot.gst.period + '-01') }})
                        </span>
                        <span
                          class="rounded-sm bg-surface-container-high px-1.5 py-0.2 text-label-xs font-bold text-on-surface-variant"
                        >
                          PREPARED
                        </span>
                      </div>
                      <span class="block text-body-sm text-outline">
                        {{ snapshot.gst.salesVoucherCount }} sales invoices summarised locally.
                        Filing needs the GST portal.
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    class="text-label-sm font-semibold text-primary hover:underline"
                    @click="router.push('/compliance/gstr-1')"
                  >
                    Open
                  </button>
                </div>

                <div
                  class="rounded-sm border-l-4 border-l-tertiary bg-surface-container-low p-space-sm"
                >
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-space-xs">
                      <MaterialIcon name="notification_important" :size="20" class="text-tertiary" />
                      <span class="text-label-md font-bold text-on-surface">
                        GSTR-3B ({{ formatPeriod(snapshot.gst.period + '-01') }})
                      </span>
                    </div>
                    <span
                      class="rounded-sm bg-tertiary-fixed px-2 py-0.5 text-label-xs font-bold text-on-tertiary-fixed"
                    >
                      NOT FILED
                    </span>
                  </div>
                  <div
                    class="mt-space-xs grid grid-cols-3 gap-space-xs rounded-sm bg-surface-container-lowest/80 p-space-xs text-center"
                  >
                    <div>
                      <span class="block text-label-xs text-outline">Total tax output</span>
                      <span class="num text-numeric-sm font-bold text-on-surface">
                        {{ formatMoney(snapshot.gst.outputTax, currency) }}
                      </span>
                    </div>
                    <div>
                      <span class="block text-label-xs text-outline">ITC eligible</span>
                      <span class="num text-numeric-sm font-bold text-secondary">
                        {{ formatMoney(snapshot.gst.itcEligible, currency) }}
                      </span>
                    </div>
                    <div>
                      <span class="block text-label-xs text-outline">Challan due</span>
                      <span class="num text-numeric-sm font-bold text-tertiary">
                        {{ formatMoney(snapshot.gst.cashChallanDue, currency) }}
                      </span>
                    </div>
                  </div>
                </div>

                <div class="flex items-center justify-between rounded-sm bg-surface-container-low p-space-sm">
                  <div class="flex items-center gap-space-sm">
                    <MaterialIcon name="local_shipping" :size="20" class="text-primary" />
                    <span class="text-body-sm text-on-surface">
                      <strong>{{ snapshot.gst.invoicesAboveEwayThreshold }} invoices</strong>
                      exceed the e-way threshold
                    </span>
                  </div>
                  <span
                    class="rounded-sm bg-secondary-container/40 px-2 py-0.5 text-label-xs font-bold text-secondary"
                  >
                    Not generated
                  </span>
                </div>
              </div>
            </div>

            <!-- Stock alerts -->
            <div class="rounded-md bg-surface-container-lowest p-space-md shadow-sm">
              <div class="mb-space-sm flex items-center justify-between">
                <div class="flex items-center gap-space-sm">
                  <MaterialIcon name="warning" :size="20" class="text-tertiary" />
                  <span class="text-headline-sm text-on-surface">Critical Stock &amp; Reorder Alerts</span>
                </div>
                <span
                  class="rounded-sm bg-error-container px-2 py-0.5 text-label-xs font-bold text-on-error-container"
                >
                  {{ snapshot.lowStock.length }} under min level
                </span>
              </div>

              <div class="space-y-space-xs text-body-sm">
                <div
                  v-for="item in snapshot.lowStock"
                  :key="item.itemId"
                  class="flex items-center justify-between rounded-sm bg-surface-container-low p-space-sm"
                >
                  <div class="min-w-0">
                    <span class="block truncate text-label-md font-semibold text-on-surface">
                      {{ item.name }}
                    </span>
                    <span class="num text-numeric-sm font-bold text-tertiary">
                      {{ formatQuantity(item.quantity) }} {{ item.unit }} remaining
                    </span>
                    <span class="num text-numeric-sm text-outline">
                      (safety buffer: {{ formatQuantity(item.reorderLevel) }} {{ item.unit }})
                    </span>
                  </div>
                  <span
                    class="shrink-0 rounded-sm bg-surface-container-high px-2 py-1 text-numeric-sm font-bold text-primary"
                  >
                    {{
                      item.reorderLevel === 0
                        ? '—'
                        : `${Math.round((item.quantity / item.reorderLevel) * 100)}% of buffer`
                    }}
                  </span>
                </div>
                <p v-if="!snapshot.lowStock.length" class="py-3 text-center text-label-sm text-outline">
                  Every item is above its reorder level.
                </p>
              </div>

              <div class="mt-space-sm pt-space-xs">
                <button
                  type="button"
                  class="flex w-full items-center justify-center gap-2 rounded-sm bg-surface-container px-space-md py-2 text-label-md text-on-surface shadow-sm transition-colors hover:bg-surface-container-high"
                  @click="router.push('/vouchers/new/purchase-order')"
                >
                  <MaterialIcon name="add_shopping_cart" :size="18" class="text-primary" />
                  Raise a purchase order
                  <span class="kbd">Alt P</span>
                </button>
              </div>
            </div>

            <!-- Bank reconciliation -->
            <div class="rounded-md bg-surface-container-lowest p-space-md shadow-sm">
              <div class="mb-space-sm flex items-center justify-between">
                <div class="flex items-center gap-space-sm">
                  <MaterialIcon name="account_balance_wallet" :size="20" class="text-primary" />
                  <span class="text-headline-sm text-on-surface">Bank Statement Sync</span>
                </div>
                <span class="text-label-xs text-outline">Local statements</span>
              </div>

              <div class="space-y-space-xs rounded-sm bg-surface-container-low p-space-sm">
                <div
                  v-for="account in snapshot.bankReconciliation"
                  :key="account.ledgerId"
                  class="border-b border-surface-container pb-space-xs last:border-0 last:pb-0"
                >
                  <div class="flex items-center justify-between">
                    <span class="text-label-md font-semibold text-on-surface">
                      {{ account.ledgerName }}
                    </span>
                    <span
                      class="rounded-sm bg-surface-container-high px-2 py-0.5 text-numeric-sm font-bold text-on-surface-variant"
                    >
                      {{ account.unmatched }} unmatched
                    </span>
                  </div>
                  <div class="flex items-baseline justify-between pt-1">
                    <span class="text-body-sm text-outline">Unreconciled amount</span>
                    <span class="num text-numeric-sm font-bold text-tertiary">
                      {{ formatMoney(account.unmatchedAmount, currency) }}
                    </span>
                  </div>
                  <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-container-high">
                    <div
                      class="h-1.5 rounded-full bg-primary"
                      :style="{ width: `${Math.round(account.percentage)}%` }"
                    />
                  </div>
                  <div class="flex items-center justify-between pt-0.5 text-[11px] text-outline">
                    <span>Reconciled: {{ Math.round(account.percentage) }}%</span>
                    <span>{{ account.reconciled }} of {{ account.total }} cleared</span>
                  </div>
                </div>
                <p v-if="!snapshot.bankReconciliation.length" class="text-outline">
                  No bank ledgers in this company.
                </p>
              </div>

              <div class="mt-space-sm">
                <button
                  type="button"
                  class="flex w-full items-center justify-center gap-2 rounded-sm bg-primary px-space-md py-2 text-label-md text-on-primary shadow-sm transition-all hover:bg-primary-container"
                  @click="router.push('/banking/reconciliation')"
                >
                  <MaterialIcon name="sync_alt" :size="18" />
                  Reconcile now
                  <span class="kbd bg-on-primary-fixed-variant/40 text-on-primary">B</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Status bar -->
        <footer
          class="flex flex-col items-center justify-between gap-space-sm rounded-md bg-surface-container-lowest px-space-md py-space-sm text-label-xs text-outline shadow-sm md:flex-row"
        >
          <div class="flex flex-wrap items-center gap-space-md">
            <div class="flex items-center gap-1.5 font-medium text-on-surface-variant">
              <span class="size-2 rounded-full bg-secondary" aria-hidden="true" />
              <span>Storage: <strong class="text-on-surface">Demo workspace (in memory)</strong></span>
            </div>
            <span>•</span>
            <span>Working offline: <strong class="text-on-surface">yes</strong></span>
            <span>•</span>
            <span class="font-bold text-secondary">0 sync conflicts</span>
          </div>
          <div class="flex flex-wrap items-center gap-space-sm">
            <span class="text-on-surface-variant">Global hotkeys:</span>
            <span class="flex items-center gap-1">
              <span class="kbd">F1</span><span>Help</span>
            </span>
            <span class="flex items-center gap-1">
              <span class="kbd">Ctrl</span><span class="kbd">K</span><span>Commands</span>
            </span>
            <span class="flex items-center gap-1">
              <span class="kbd">F8</span><span>Sales</span>
            </span>
            <span class="flex items-center gap-1">
              <span class="kbd">F3</span><span>Day book</span>
            </span>
          </div>
        </footer>
      </template>
    </div>
  </div>
</template>
