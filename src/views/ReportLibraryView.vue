<script setup lang="ts">
import { computed } from 'vue'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()

type ReportCard = {
  id: string
  name: string
  description: string
  /** Route id of the implemented report, or null when the report is not built yet. */
  implementedId: string | null
  /** Why the report is not built yet. Only shown for unimplemented reports. */
  reason?: string
}

type ReportCategory = {
  id: string
  name: string
  description: string
  icon: string
  reports: ReportCard[]
}

const categories: ReportCategory[] = [
  {
    id: 'financial',
    name: 'Financial statements',
    description: 'The primary statements of the books.',
    icon: 'account_balance',
    reports: [
      {
        id: 'balance-sheet',
        name: 'Balance sheet',
        description: 'Assets, liabilities and equity at a date, with the difference shown.',
        implementedId: 'balance-sheet',
      },
      {
        id: 'profit-and-loss',
        name: 'Profit and loss',
        description: 'Income and expenses of a period, ending in the net profit.',
        implementedId: 'profit-and-loss',
      },
      {
        id: 'trial-balance',
        name: 'Trial balance',
        description: 'Every ledger with its opening, movement and closing balance.',
        implementedId: 'trial-balance',
      },
      {
        id: 'general-ledger',
        name: 'General ledger',
        description: 'The full ledger book with the running balance of each head.',
        implementedId: null,
        reason: 'A single scrolling general ledger across all heads is not built yet.',
      },
      {
        id: 'day-book',
        name: 'Day book',
        description: 'Vouchers of one day, grouped by type.',
        implementedId: null,
        reason: 'The day book is not built yet; use the voucher register for the full list.',
      },
      {
        id: 'cash-book',
        name: 'Cash book',
        description: 'Receipts and payments through the cash accounts.',
        implementedId: null,
        reason: 'The cash book is not built yet; use Cash and bank for live balances.',
      },
      {
        id: 'bank-book',
        name: 'Bank book',
        description: 'Receipts and payments through the bank accounts.',
        implementedId: null,
        reason: 'The bank book is not built yet; use Cash and bank for live balances.',
      },
    ],
  },
  {
    id: 'receivables',
    name: 'Receivables and payables',
    description: 'Who owes what, and for how long.',
    icon: 'handshake',
    reports: [
      {
        id: 'receivables',
        name: 'Receivables ageing',
        description: 'Money owed by customers, bucketed by how late it is.',
        implementedId: 'receivables',
      },
      {
        id: 'payables',
        name: 'Payables ageing',
        description: 'Money owed to suppliers, bucketed by how late it is.',
        implementedId: 'payables',
      },
      {
        id: 'outstanding-summary',
        name: 'Outstanding summary',
        description: 'One register of every open invoice on both sides of the books.',
        implementedId: null,
        reason: 'A combined customer and supplier outstanding register is not built yet.',
      },
      {
        id: 'supplier-analysis',
        name: 'Supplier analysis',
        description: 'Turnover, payment behaviour and concentration per supplier.',
        implementedId: null,
        reason: 'Supplier turnover and payment behaviour analysis is not built yet.',
      },
    ],
  },
  {
    id: 'tax',
    name: 'Tax',
    description: 'Tax collected, tax paid and what is left to pay.',
    icon: 'receipt_long',
    reports: [
      {
        id: 'gst-summary',
        name: 'GST summary',
        description: 'Output tax, input tax and the difference, by tax category.',
        implementedId: 'gst-summary',
      },
      {
        id: 'tax-liability',
        name: 'Tax liability',
        description: 'TDS and TCS collected and deducted, with the net liability.',
        implementedId: null,
        reason: 'TDS and TCS liability computation is not built yet.',
      },
    ],
  },
  {
    id: 'inventory',
    name: 'Inventory',
    description: 'What is in stock and what it is worth.',
    icon: 'inventory_2',
    reports: [
      {
        id: 'stock-summary',
        name: 'Stock summary',
        description: 'Closing quantity and value of every item, by group.',
        implementedId: null,
        reason: 'The stock summary report is not built yet; the Inventory screen covers it.',
      },
      {
        id: 'stock-register',
        name: 'Stock register',
        description: 'Every inward and outward movement of an item, running forward.',
        implementedId: null,
        reason: 'The stock register report is not built yet; the Inventory screen covers it.',
      },
      {
        id: 'inventory-valuation',
        name: 'Inventory valuation',
        description: 'Stock valued at the configured method, with the total value.',
        implementedId: null,
        reason: 'The valuation report is not built yet; the Inventory screen covers it.',
      },
      {
        id: 'item-movement',
        name: 'Item movement',
        description: 'Movement of one item between godowns over a period.',
        implementedId: null,
        reason: 'The item movement report is not built yet; the Inventory screen covers it.',
      },
    ],
  },
  {
    id: 'operational',
    name: 'Operational',
    description: 'Reports that follow the working of the business.',
    icon: 'query_stats',
    reports: [
      {
        id: 'cash-flow',
        name: 'Cash flow',
        description: 'Cash received and paid, grouped by activity.',
        implementedId: null,
        reason: 'The cash flow statement is not built yet.',
      },
      {
        id: 'cost-centre-report',
        name: 'Cost centre report',
        description: 'Income and expense by cost centre.',
        implementedId: null,
        reason: 'The cost centre report is not built yet; the Cost centres screen covers it.',
      },
      {
        id: 'budget-variance',
        name: 'Budget variance',
        description: 'Budget against actuals for the period.',
        implementedId: null,
        reason: 'Budgets are not implemented in this build, so there is nothing to compare against.',
      },
      {
        id: 'payroll-report',
        name: 'Payroll report',
        description: 'Payroll cost by employee and department.',
        implementedId: null,
        reason: 'The payroll report is not built yet; the Payroll screen covers it.',
      },
      {
        id: 'order-production',
        name: 'Order and production',
        description: 'Orders received, produced and pending.',
        implementedId: null,
        reason: 'Production tracking is not implemented in this build.',
      },
    ],
  },
]

const implementedCount = computed(
  () =>
    categories.reduce(
      (sum, category) => sum + category.reports.filter((report) => report.implementedId).length,
      0,
    ),
)

const totalCount = computed(() =>
  categories.reduce((sum, category) => sum + category.reports.length, 0),
)
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      title="Reports"
      subtitle="Every report of the books, grouped by what it is about"
      icon="summarize"
      :breadcrumb="[{ label: 'Home', to: '/' }, { label: 'Reports' }]"
    />

    <div class="min-h-0 flex-1 overflow-auto p-space-lg">
      <div
        class="flex flex-wrap items-center gap-space-sm rounded-md bg-surface-container-low p-space-md text-body-sm text-on-surface-variant"
      >
        <MaterialIcon name="info" :size="18" class="text-primary" />
        <p>
          {{ implementedCount }} of {{ totalCount }} reports are built and open directly. The rest are
          listed with the reason they are not available yet, so nothing here leads to a broken
          screen.
        </p>
      </div>

      <section
        v-for="category in categories"
        :key="category.id"
        class="mt-space-lg"
        :aria-labelledby="`category-${category.id}`"
      >
        <header class="flex items-center gap-space-sm">
          <div
            class="flex size-8 items-center justify-center rounded-full bg-primary-fixed text-on-primary-fixed"
          >
            <MaterialIcon :name="category.icon" :size="18" />
          </div>
          <div>
            <h2 :id="`category-${category.id}`" class="text-headline-md text-on-surface">
              {{ category.name }}
            </h2>
            <p class="text-label-sm text-outline">{{ category.description }}</p>
          </div>
        </header>

        <div class="mt-space-md grid grid-cols-1 gap-space-md md:grid-cols-2 xl:grid-cols-3">
          <RouterLink
            v-for="report in category.reports.filter((entry) => entry.implementedId)"
            :key="report.id"
            :to="{ name: 'report', params: { reportId: report.implementedId } }"
            class="group flex flex-col rounded-md bg-surface-container-lowest p-space-md shadow-sm transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            <span class="flex items-start justify-between gap-space-sm">
              <span class="text-headline-sm text-on-surface group-hover:text-primary">
                {{ report.name }}
              </span>
              <MaterialIcon
                name="arrow_forward"
                :size="18"
                class="mt-0.5 shrink-0 text-outline group-hover:text-primary"
              />
            </span>
            <span class="mt-1 text-body-sm leading-relaxed text-on-surface-variant">
              {{ report.description }}
            </span>
            <span class="mt-space-sm">
              <BaseBadge tone="primary" size="xs" icon="check_circle">Open report</BaseBadge>
            </span>
          </RouterLink>

          <div
            v-for="report in category.reports.filter((entry) => !entry.implementedId)"
            :key="report.id"
            class="flex flex-col rounded-md border border-dashed border-outline-variant bg-surface-container-low/40 p-space-md"
          >
            <span class="flex items-start justify-between gap-space-sm">
              <span class="text-headline-sm text-on-surface-variant">{{ report.name }}</span>
              <BaseBadge tone="neutral" size="xs" icon="hourglass_empty">
                Not implemented yet
              </BaseBadge>
            </span>
            <span class="mt-1 text-body-sm leading-relaxed text-on-surface-variant">
              {{ report.description }}
            </span>
            <span class="mt-space-sm flex items-start gap-1.5 text-label-sm text-outline">
              <MaterialIcon name="info" :size="14" class="mt-0.5 shrink-0" />
              {{ report.reason }}
            </span>
          </div>
        </div>
      </section>

      <p class="mt-space-lg text-label-xs text-outline">
        Company: {{ session.activeCompany?.name ?? '—' }} · Financial year:
        {{ session.activeFinancialYear?.label ?? '—' }}
      </p>
    </div>
  </div>
</template>
