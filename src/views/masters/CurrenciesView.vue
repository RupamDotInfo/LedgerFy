<script setup lang="ts">
import { computed, ref } from 'vue'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseEmptyState from '@/components/ui/BaseEmptyState.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import DataTable from '@/components/ui/DataTable.vue'
import type { TableColumn } from '@/components/ui/DataTable.vue'
import FilterBar from '@/components/ui/FilterBar.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import StatTile from '@/components/ui/StatTile.vue'
import type { Currency } from '@/domain/types'
import { useSessionStore } from '@/stores/session'
import { useToastStore } from '@/stores/toast'

const session = useSessionStore()
const toast = useToastStore()

const search = ref('')

const baseCurrency = computed(() => session.activeCompany?.baseCurrency ?? 'INR')

type CurrencyRow = {
  id: string
  code: string
  name: string
  symbol: string
  rate: number
  isBase: boolean
}

const currencyRows = computed<CurrencyRow[]>(() =>
  session.currencies.map((currency) => ({
    id: currency.id,
    code: currency.code,
    name: currency.name,
    symbol: currency.symbol,
    rate: currency.rate,
    isBase: currency.code === baseCurrency.value,
  })),
)

const visibleRows = computed(() => {
  const needle = search.value.trim().toLowerCase()
  if (!needle) return currencyRows.value
  return currencyRows.value.filter(
    (row) =>
      row.code.toLowerCase().includes(needle) || row.name.toLowerCase().includes(needle),
  )
})

const baseRow = computed(
  () => currencyRows.value.find((row) => row.isBase) ?? null,
)

const columns: TableColumn[] = [
  { key: 'code', label: 'Code', sortable: true },
  { key: 'name', label: 'Currency', sortable: true },
  { key: 'symbol', label: 'Symbol' },
  { key: 'rate', label: 'Rate against base', align: 'right', numeric: true, sortable: true },
  { key: 'isBase', label: 'Role', align: 'center' },
]

// ---------------------------------------------------------------------------
// New currency
// ---------------------------------------------------------------------------
//
// The currency is written through saveCurrency and the list is refreshed from
// the repository.

const createOpen = ref(false)
const saving = ref(false)
const formError = ref<string | null>(null)
const fieldErrors = ref<Record<string, string>>({})
const form = ref({ code: '', name: '', symbol: '', rate: '' })

/** True in the browser preview, where the workspace is held in memory only. */
const isPreviewWorkspace = computed(() => session.repository.info.kind === 'demo')

/** Where the saved record goes, stated plainly for the current runtime. */
const storageNotice = computed(() =>
  isPreviewWorkspace.value
    ? 'This is a browser preview. The currency is held in the in-memory sample workspace only and is lost when the window closes.'
    : 'The currency is written to the local database on this computer. It becomes part of the company master and survives a restart.',
)

function openCreate() {
  form.value = { code: '', name: '', symbol: '', rate: '' }
  fieldErrors.value = {}
  formError.value = null
  createOpen.value = true
}

function validateForm(): boolean {
  const errors: Record<string, string> = {}
  const code = form.value.code.trim().toUpperCase()
  if (!code) errors.code = 'A currency code is required.'
  else if (
    session.currencies.some((currency) => currency.code.trim().toUpperCase() === code)
  ) {
    errors.code = 'A currency with this code already exists.'
  }
  if (!form.value.name.trim()) errors.name = 'A currency name is required.'
  const rate = Number(form.value.rate)
  if (!form.value.rate.trim()) errors.rate = 'Enter the rate.'
  else if (!Number.isFinite(rate) || rate <= 0) {
    errors.rate = 'Enter a rate greater than zero.'
  }
  fieldErrors.value = errors
  return Object.keys(errors).length === 0
}

async function saveCurrency() {
  const companyId = session.activeCompanyId
  if (!companyId) {
    formError.value = 'Open a company before adding a currency.'
    return
  }
  if (!validateForm()) return

  saving.value = true
  formError.value = null
  try {
    const code = form.value.code.trim().toUpperCase()
    const currency: Currency = {
      id: `cur-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      companyId,
      code,
      name: form.value.name.trim(),
      rate: Number(form.value.rate),
      symbol: form.value.symbol.trim(),
    }

    await session.repository.saveCurrency(currency)
    await session.loadMasters(companyId)
    createOpen.value = false
    toast.success(
      'Currency created',
      isPreviewWorkspace.value
        ? `${code} was added to the sample workspace in memory only. It is lost when the window closes.`
        : `${code} was written to the local database and survives a restart.`,
    )
  } catch (cause) {
    formError.value =
      cause instanceof Error ? cause.message : 'The currency could not be saved. Try again.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      title="Currencies"
      subtitle="The currencies this company is configured to trade in"
      icon="currency_exchange"
    >
      <template #actions>
        <BaseButton size="sm" variant="primary" icon="add" @click="openCreate">
          New currency
        </BaseButton>
      </template>
    </PageHeader>

    <FilterBar>
      <BaseInput
        v-model="search"
        label="Search"
        placeholder="Search code or currency"
        type="search"
        size="sm"
        class="w-64"
      />
      <template #trailing>
        <span class="text-label-sm text-outline">
          {{ visibleRows.length }} of {{ currencyRows.length }} currencies
        </span>
      </template>
    </FilterBar>

    <div class="min-h-0 flex-1 overflow-auto p-space-lg">
      <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2">
        <StatTile
          label="Base currency"
          :value="baseRow ? `${baseRow.code} — ${baseRow.name}` : baseCurrency"
          icon="payments"
          tone="info"
          hint="All books are kept in this currency"
        />
        <StatTile
          label="Configured currencies"
          :value="String(currencyRows.length)"
          icon="public"
          hint="Currencies on the company master"
        />
      </div>

      <div
        class="mt-space-md flex items-start gap-space-sm rounded-md border-l-4 border-l-tertiary bg-tertiary-fixed p-space-md text-body-sm text-on-tertiary-fixed"
      >
        <MaterialIcon name="info" :size="18" class="mt-0.5 shrink-0" />
        <p>
          Foreign-currency transactions, realised and unrealised exchange differences and period-end
          revaluation are <span class="font-semibold">not implemented</span> in this build. The rate
          below is a configuration value only: every amount in the books is recorded and reported in
          the base currency.
        </p>
      </div>

      <section class="mt-space-md overflow-hidden rounded-md bg-surface-container-lowest shadow-sm">
        <header class="flex flex-wrap items-center justify-between gap-3 px-space-md py-space-sm">
          <div class="flex items-center gap-space-sm">
            <MaterialIcon name="table_view" :size="20" class="text-primary" />
            <h2 class="text-headline-sm text-on-surface">Currency list</h2>
          </div>
          <span class="text-label-xs text-outline">
            Rate is one unit of the currency in {{ baseCurrency }}
          </span>
        </header>

        <DataTable
          v-if="visibleRows.length"
          :columns="columns"
          :rows="visibleRows"
          row-key="id"
          empty-title="No currencies match"
          empty-description="Change the search term."
        >
          <template #cell:code="{ row }">
            <span class="font-semibold text-on-surface">{{ row.code }}</span>
          </template>
          <template #cell:symbol="{ row }">
            <span class="text-on-surface-variant">{{ row.symbol || '—' }}</span>
          </template>
          <template #cell:rate="{ row }">
            <span class="font-semibold">{{ row.rate }}</span>
          </template>
          <template #cell:isBase="{ row }">
            <BaseBadge v-if="row.isBase" tone="primary" size="xs" icon="star">Base</BaseBadge>
            <span v-else class="text-label-xs text-outline">Secondary</span>
          </template>
        </DataTable>

        <BaseEmptyState
          v-else
          title="No currencies match"
          description="Change the search term."
          :icon="MaterialIcon"
        />

        <footer
          class="border-t border-surface-container bg-surface-container-low/60 px-space-md py-space-sm text-label-xs text-outline"
        >
          The base currency is the currency of the company record. Changing the exchange rate here
          does not restate any historical voucher: the books are kept in the base currency.
        </footer>
      </section>
    </div>

    <!-- New currency -->
    <BaseModal
      :open="createOpen"
      title="New currency"
      description="Add a currency this company may trade in."
      size="sm"
      @close="createOpen = false"
    >
      <div class="space-y-space-md pt-space-xs">
        <div
          v-if="formError"
          class="rounded-sm border-l-4 border-l-error bg-error-container p-space-sm text-body-sm text-on-error-container"
          role="alert"
        >
          {{ formError }}
        </div>

        <div
          class="flex items-start gap-space-sm rounded-sm border-l-4 border-l-tertiary bg-tertiary-fixed p-space-sm text-body-sm text-on-tertiary-fixed"
          role="status"
        >
          <MaterialIcon name="info" :size="18" class="mt-0.5 shrink-0" />
          <p>{{ storageNotice }}</p>
        </div>

        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2">
          <BaseInput
            v-model="form.code"
            label="Code"
            required
            placeholder="e.g. USD"
            :error="fieldErrors.code"
          />
          <BaseInput v-model="form.symbol" label="Symbol" placeholder="e.g. $" />
        </div>
        <BaseInput
          v-model="form.name"
          label="Currency name"
          required
          placeholder="e.g. US Dollar"
          :error="fieldErrors.name"
        />
        <BaseInput
          v-model="form.rate"
          label="Rate against base"
          required
          type="number"
          placeholder="1.0000"
          :hint="`One unit in ${baseCurrency}.`"
          :error="fieldErrors.rate"
        />
      </div>

      <template #footer>
        <BaseButton size="sm" variant="text" @click="createOpen = false">Close</BaseButton>
        <BaseButton
          size="sm"
          variant="primary"
          icon="save"
          :loading="saving"
          @click="saveCurrency"
        >
          Save currency
        </BaseButton>
      </template>
    </BaseModal>
  </div>
</template>
