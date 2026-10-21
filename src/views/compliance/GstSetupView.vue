<script setup lang="ts">
import { computed, onMounted } from 'vue'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import DataTable from '@/components/ui/DataTable.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import { useSessionStore } from '@/stores/session'
import type { TaxType } from '@/domain/types'
import { formatPercent } from '@/lib/money'

const session = useSessionStore()

/** The workspace is only usable once the session store has been opened. */
const ready = computed(() => session.ready && !session.loading)

const TAX_TYPE_LABELS: Record<TaxType, string> = {
  cgst: 'CGST',
  sgst: 'SGST',
  igst: 'IGST',
  cess: 'Cess',
  tds: 'TDS',
  tcs: 'TCS',
}

type TableColumnSpec = {
  key: string
  label: string
  align?: 'left' | 'right' | 'center'
  numeric?: boolean
  sortable?: boolean
  width?: string
}

type TaxRow = {
  id: string
  name: string
  type: string
  rate: number
  hsn: string
  ledger: string
  isActive: boolean
}

const columns: TableColumnSpec[] = [
  { key: 'name', label: 'Tax category', sortable: true },
  { key: 'type', label: 'Type', sortable: true },
  { key: 'rate', label: 'Rate', align: 'right', numeric: true, sortable: true },
  { key: 'hsn', label: 'HSN / SAC' },
  { key: 'ledger', label: 'Posts to ledger' },
  { key: 'status', label: 'State' },
]

const company = computed(() => session.activeCompany)
const gstin = computed(() => company.value?.gstin?.trim() ?? '')
const isConfigured = computed(() => gstin.value.length > 0)
const currency = computed(() => company.value?.baseCurrency ?? 'INR')

function rateLabel(rate: number): string {
  return formatPercent(rate, Number.isInteger(rate) ? 0 : 2)
}

function resolveLedgerName(ledgerId: string | null): string {
  if (!ledgerId) return 'Not linked to a ledger'
  const ledger = session.ledgers.find((candidate) => candidate.id === ledgerId)
  return ledger ? ledger.name : 'Linked ledger not found'
}

const taxRows = computed<TaxRow[]>(() =>
  session.taxCategories.map((category) => ({
    id: category.id,
    name: category.name,
    type: TAX_TYPE_LABELS[category.type] ?? category.type,
    rate: category.rate,
    hsn: category.hsn ?? 'Not recorded',
    ledger: resolveLedgerName(category.ledgerId),
    isActive: category.isActive,
  })),
)

const gstCount = computed(
  () => taxRows.value.filter((row) => row.type !== 'TDS' && row.type !== 'TCS').length,
)

const withholdCount = computed(() => taxRows.value.length - gstCount.value)

const limitations = [
  'Validation of the GSTIN against the GST portal registry.',
  'Any connection to the GST portal — no return can be filed from this build.',
  'E-invoice and e-way bill portal credentials, IRN and e-way bill numbers.',
  'HSN / SAC validation against the GST rate schedule.',
  'Reconciliation of the tax master against the rate slabs in force.',
]

onMounted(async () => {
  if (!session.ready && !session.loading) await session.bootstrap()
})
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      title="GST setup"
      subtitle="Registration details and the tax categories this company posts against"
      icon="verified_user"
      :breadcrumb="[{ label: 'Tax and compliance' }]"
    >
      <template #title-meta>
        <BaseBadge tone="warning" size="xs" icon="cloud_off">No portal connection</BaseBadge>
      </template>
    </PageHeader>

    <div class="min-h-0 flex-1 overflow-auto p-space-lg">
      <div v-if="!ready" class="space-y-space-md">
        <BaseSkeleton class="h-40" />
        <BaseSkeleton class="h-56" />
      </div>

      <template v-else>
        <div class="grid grid-cols-1 items-start gap-space-md lg:grid-cols-3">
          <!-- Registration -->
          <BaseCard
            class="lg:col-span-2"
            title="Company registration"
            description="The values recorded in the company profile"
          >
            <template #actions>
              <BaseBadge :tone="isConfigured ? 'positive' : 'warning'" icon="badge">
                {{ isConfigured ? 'Configured' : 'Not configured' }}
              </BaseBadge>
            </template>

            <dl class="grid grid-cols-1 gap-space-sm sm:grid-cols-2">
              <div class="rounded-sm bg-surface-container-low p-space-sm">
                <dt class="section-label">GSTIN</dt>
                <dd class="num mt-0.5 text-body-md font-semibold text-on-surface">
                  {{ isConfigured ? gstin : 'Not configured' }}
                </dd>
              </div>
              <div class="rounded-sm bg-surface-container-low p-space-sm">
                <dt class="section-label">PAN</dt>
                <dd class="num mt-0.5 text-body-md font-semibold text-on-surface">
                  {{ company?.pan?.trim() || 'Not configured' }}
                </dd>
              </div>
              <div class="rounded-sm bg-surface-container-low p-space-sm">
                <dt class="section-label">State</dt>
                <dd class="mt-0.5 text-body-md font-semibold text-on-surface">
                  {{ company?.state?.trim() || 'Not recorded' }}
                </dd>
              </div>
              <div class="rounded-sm bg-surface-container-low p-space-sm">
                <dt class="section-label">Base currency</dt>
                <dd class="mt-0.5 text-body-md font-semibold text-on-surface">
                  {{ company?.baseCurrency ?? currency }}
                </dd>
              </div>
              <div class="rounded-sm bg-surface-container-low p-space-sm">
                <dt class="section-label">Financial year</dt>
                <dd class="mt-0.5 text-body-md font-semibold text-on-surface">
                  {{ session.activeFinancialYear?.label ?? 'Not selected' }}
                </dd>
              </div>
              <div class="rounded-sm bg-surface-container-low p-space-sm">
                <dt class="section-label">Tax categories</dt>
                <dd class="num mt-0.5 text-body-md font-semibold text-on-surface">
                  {{ taxRows.length }} configured
                </dd>
                <p class="mt-0.5 text-label-xs text-outline">
                  {{ gstCount }} GST · {{ withholdCount }} TDS/TCS
                </p>
              </div>
            </dl>

            <div class="mt-space-md rounded-sm border-l-4 border-l-tertiary bg-surface-container-low p-space-md">
              <div class="flex items-start gap-space-sm">
                <MaterialIcon name="info" :size="18" class="mt-0.5 shrink-0 text-tertiary" />
                <div class="min-w-0">
                  <p class="text-label-md font-bold text-on-surface">Not a verified registration</p>
                  <p class="mt-0.5 text-body-sm text-on-surface-variant">
                    Registration validation against the GST portal is not implemented in this build.
                    The GSTIN shown above is the value entered in the company profile — it has not
                    been checked against the portal registry, and no confirmation of the
                    registration status exists here.
                  </p>
                </div>
              </div>
            </div>
          </BaseCard>

          <!-- Limitations -->
          <BaseCard title="Not implemented yet" description="What this module does not do">
            <ul class="space-y-space-sm">
              <li
                v-for="item in limitations"
                :key="item"
                class="flex items-start gap-space-sm text-body-sm text-on-surface-variant"
              >
                <MaterialIcon
                  name="block"
                  :size="16"
                  class="mt-0.5 shrink-0 text-outline"
                />
                <span>{{ item }}</span>
              </li>
            </ul>
          </BaseCard>
        </div>

        <!-- Tax category master -->
        <BaseCard
          class="mt-space-md"
          title="Tax category master"
          description="Every tax this company can post, with the ledger it is charged to"
          padded
        >
          <DataTable
            :columns="columns"
            :rows="taxRows"
            row-key="id"
            :clickable="false"
            empty-title="No tax categories configured"
            empty-description="Add GST tax categories from the tax master to post tax on vouchers."
          >
            <template #cell:rate="{ row }">
              <span class="num font-semibold text-on-surface">{{ rateLabel(row.rate) }}</span>
            </template>

            <template #cell:status="{ row }">
              <BaseBadge
                :tone="row.isActive ? 'positive' : 'neutral'"
                size="xs"
                :icon="row.isActive ? 'check_circle' : 'pause'"
              >
                {{ row.isActive ? 'Active' : 'Inactive' }}
              </BaseBadge>
            </template>
          </DataTable>
        </BaseCard>
      </template>
    </div>
  </div>
</template>
