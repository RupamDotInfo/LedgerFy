<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue'
import { invoke, isTauri } from '@tauri-apps/api/core'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCheckbox from '@/components/ui/BaseCheckbox.vue'
import BaseEmptyState from '@/components/ui/BaseEmptyState.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import { useSessionStore } from '@/stores/session'
import { useToastStore } from '@/stores/toast'
import { totalCredit, totalDebit } from '@/domain/accounting'
import { formatQuantity } from '@/domain/quantity'
import { todayIso } from '@/lib/datetime'

/**
 * The native shell is only present inside the Tauri webview. `isTauri()` reads
 * a global that is only injected when `withGlobalTauri` is enabled, so the IPC
 * bridge is probed as well — that is what `invoke` itself uses.
 */
function nativeAvailable(): boolean {
  if (isTauri()) return true
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

type DatasetId = 'ledgers' | 'items' | 'vouchers' | 'tax-categories'

interface Dataset {
  id: DatasetId
  label: string
  description: string
  icon: string
}

const DATASETS: Dataset[] = [
  {
    id: 'ledgers',
    label: 'Ledgers',
    description: 'Accounts, parties and control accounts with their opening balances',
    icon: 'account_balance',
  },
  {
    id: 'items',
    label: 'Items',
    description: 'Stock items and services with their prices and opening stock',
    icon: 'inventory_2',
  },
  {
    id: 'vouchers',
    label: 'Vouchers',
    description: 'Every voucher with its date, party, narration and double-entry totals',
    icon: 'receipt_long',
  },
  {
    id: 'tax-categories',
    label: 'Tax categories',
    description: 'Tax rates and the ledgers each tax is carried in',
    icon: 'percent',
  },
]

const session = useSessionStore()
const toast = useToastStore()

const native = ref(nativeAvailable())
const loading = ref(true)
const exporting = ref(false)
const error = ref<string | null>(null)

const selected = ref<Record<DatasetId, boolean>>({
  ledgers: true,
  items: false,
  vouchers: false,
  'tax-categories': false,
})

const vouchers = ref<Awaited<ReturnType<typeof session.repository.listVouchers>>>([])

const companyId = computed(() => session.activeCompanyId)
const companyName = computed(() => session.activeCompany?.name ?? 'company')
const stamp = computed(() => todayIso())

/** `BaseEmptyState` renders the icon component without a name, so bind one here. */
const NoCompanyIcon = () => h(MaterialIcon, { name: 'domain_disabled', size: 19 })

async function load() {
  loading.value = true
  error.value = null
  try {
    vouchers.value = companyId.value ? await session.repository.listVouchers(companyId.value) : []
  } catch (cause) {
    error.value =
      cause instanceof Error ? cause.message : 'The vouchers could not be read for the export.'
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(companyId, load)

// ---------------------------------------------------------------------------
// Row counts
// ---------------------------------------------------------------------------

const counts = computed<Record<DatasetId, number>>(() => ({
  ledgers: session.ledgers.length,
  items: session.items.length,
  vouchers: vouchers.value.length,
  'tax-categories': session.taxCategories.length,
}))

const selectedDatasets = computed(() => DATASETS.filter((dataset) => selected.value[dataset.id]))
const totalRows = computed(() =>
  selectedDatasets.value.reduce((sum, dataset) => sum + counts.value[dataset.id], 0),
)

function fileNameFor(dataset: Dataset): string {
  return `ledgerfy-${companyName.value.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${dataset.id}-${stamp.value}.csv`
}

// ---------------------------------------------------------------------------
// CSV building
// ---------------------------------------------------------------------------

function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  if (text === '') return ''
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function ledgerName(ledgerId: string | null): string {
  if (!ledgerId) return ''
  return session.ledgers.find((ledger) => ledger.id === ledgerId)?.name ?? ''
}

function buildCsv(dataset: DatasetId): string {
  const header: string[] = []
  const rows: string[][] = []

  if (dataset === 'ledgers') {
    header.push('Name', 'Group', 'Type', 'Opening Balance', 'Currency', 'Party Kind', 'Tax Number', 'Email', 'Phone', 'Address', 'System', 'Active')
    for (const ledger of session.ledgers) {
      rows.push([
        ledger.name,
        ledger.group,
        ledger.type,
        (ledger.openingBalance / 100).toFixed(2),
        ledger.currency,
        ledger.partyKind ?? '',
        ledger.taxNumber ?? '',
        ledger.email ?? '',
        ledger.phone ?? '',
        ledger.address ?? '',
        ledger.isSystem ? 'Yes' : 'No',
        ledger.isActive ? 'Yes' : 'No',
      ])
    }
  } else if (dataset === 'items') {
    header.push('Name', 'Stock Group', 'Unit', 'Kind', 'Purchase Price', 'Sale Price', 'HSN', 'Tax Category', 'Opening Quantity (units)', 'Opening Quantity (milli-units)', 'Opening Value', 'Reorder Level (units)', 'Reorder Level (milli-units)', 'Active')
    const groupName = (id: string) =>
      session.stockGroups.find((group) => group.id === id)?.name ?? ''
    const unitName = (id: string) => session.units.find((unit) => unit.id === id)?.name ?? ''
    const taxName = (id: string | null) =>
      id ? (session.taxCategories.find((tax) => tax.id === id)?.name ?? '') : ''
    for (const item of session.items) {
      rows.push([
        item.name,
        groupName(item.stockGroupId),
        unitName(item.unitId),
        item.isService ? 'Service' : item.isInventory ? 'Inventory' : 'Non stock',
        (item.purchasePrice / 100).toFixed(2),
        (item.salesPrice / 100).toFixed(2),
        item.hsn ?? '',
        taxName(item.taxCategoryId),
        formatQuantity(item.openingQuantityMilli),
        String(item.openingQuantityMilli),
        (item.openingValue / 100).toFixed(2),
        formatQuantity(item.reorderLevelMilli),
        String(item.reorderLevelMilli),
        item.isActive ? 'Yes' : 'No',
      ])
    }
  } else if (dataset === 'vouchers') {
    header.push('Number', 'Date', 'Type', 'Party', 'Narration', 'Reference', 'Status', 'Debit', 'Credit', 'Locked')
    for (const voucher of vouchers.value) {
      rows.push([
        voucher.number,
        voucher.date,
        voucher.type,
        ledgerName(voucher.partyId),
        voucher.narration,
        voucher.reference,
        voucher.status,
        (totalDebit(voucher) / 100).toFixed(2),
        (totalCredit(voucher) / 100).toFixed(2),
        voucher.isLocked ? 'Yes' : 'No',
      ])
    }
  } else {
    header.push('Name', 'Rate', 'Type', 'HSN', 'Tax Ledger', 'Input Ledger', 'Active')
    for (const tax of session.taxCategories) {
      rows.push([
        tax.name,
        String(tax.rate),
        tax.type,
        tax.hsn ?? '',
        ledgerName(tax.ledgerId),
        ledgerName(tax.inputLedgerId),
        tax.isActive ? 'Yes' : 'No',
      ])
    }
  }

  return [header.map(cell).join(','), ...rows.map((row) => row.map(cell).join(','))].join('\r\n')
}

// ---------------------------------------------------------------------------
// Exporting
// ---------------------------------------------------------------------------

function downloadText(name: string, content: string) {
  const blob = new Blob([`﻿${content}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function downloadAll() {
  if (!selectedDatasets.value.length) return
  for (const dataset of selectedDatasets.value) {
    downloadText(fileNameFor(dataset), buildCsv(dataset.id))
  }
  toast.success(
    'Export written',
    `${totalRows.value} rows were written to ${selectedDatasets.value.length} file${
      selectedDatasets.value.length === 1 ? '' : 's'
    } in the downloads folder.`,
  )
}

async function exportToFile() {
  if (!native.value || !selectedDatasets.value.length) return
  exporting.value = true
  error.value = null
  try {
    const written: string[] = []
    let cancelled = 0
    for (const dataset of selectedDatasets.value) {
      const path = await invoke<string | null>('export_to_file', {
        suggestedName: fileNameFor(dataset),
        payload: buildCsv(dataset.id),
      })
      if (path) written.push(path)
      else cancelled += 1
    }
    if (written.length) {
      toast.success('Export written', `${written.length} file(s) were written to disk.`)
    }
    if (cancelled) {
      toast.info('Export cancelled', `${cancelled} save dialog(s) were dismissed.`)
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'The file could not be written.'
    error.value = message
    toast.error('Export failed', message)
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      title="Export data"
      subtitle="Write the books out as comma separated files"
      icon="download"
      :breadcrumb="[{ label: 'Data and tools', to: '/data/integrity' }, { label: 'Export data' }]"
    >
      <template #actions>
        <BaseButton
          size="sm"
          variant="primary"
          icon="download"
          :disabled="!selectedDatasets.length"
          @click="downloadAll"
        >
          Download
        </BaseButton>
      </template>
    </PageHeader>

    <div class="min-h-0 flex-1 overflow-auto p-space-lg">
      <div class="grid grid-cols-1 items-start gap-space-md lg:grid-cols-3">
        <!-- What to export -->
        <section class="rounded-md bg-surface-container-lowest p-space-md shadow-sm lg:col-span-2">
          <header class="flex items-center gap-space-sm">
            <MaterialIcon name="checklist" :size="20" class="text-primary" />
            <h2 class="text-headline-sm text-on-surface">What to export</h2>
          </header>
          <p class="mt-0.5 text-label-sm text-outline">
            Each selection is written as its own file, named after the company, the dataset and
            today's date.
          </p>

          <div v-if="loading" class="mt-space-md space-y-space-sm">
            <BaseSkeleton v-for="index in 4" :key="index" class="h-14" />
          </div>

          <div v-else class="mt-space-md space-y-space-sm">
            <div
              v-for="dataset in DATASETS"
              :key="dataset.id"
              class="flex items-start justify-between gap-3 rounded-sm bg-surface-container-low p-space-sm"
            >
              <BaseCheckbox
                v-model="selected[dataset.id]"
                :label="dataset.label"
                :description="dataset.description"
              />
              <BaseBadge tone="neutral" size="xs" class="shrink-0">
                {{ counts[dataset.id] }} rows
              </BaseBadge>
            </div>
          </div>
        </section>

        <!-- Summary -->
        <section class="rounded-md bg-surface-container-lowest p-space-md shadow-sm">
          <header class="flex items-center gap-space-sm">
            <MaterialIcon name="summarize" :size="20" class="text-primary" />
            <h2 class="text-headline-sm text-on-surface">What will be written</h2>
          </header>

          <div class="mt-space-md rounded-sm bg-surface-container-low p-space-sm">
            <div class="flex items-baseline justify-between gap-2">
              <span class="section-label">Rows</span>
              <span class="num text-headline-lg font-bold text-on-surface">{{ totalRows }}</span>
            </div>
            <p class="mt-0.5 text-label-xs text-outline">
              Across {{ selectedDatasets.length }} file{{
                selectedDatasets.length === 1 ? '' : 's'
              }}, not counting the header row of each.
            </p>
          </div>

          <ul v-if="selectedDatasets.length" class="mt-space-md divide-y divide-surface-container-low">
            <li
              v-for="dataset in selectedDatasets"
              :key="dataset.id"
              class="flex items-start justify-between gap-2 py-1.5"
            >
              <span class="min-w-0">
                <span class="flex items-center gap-1">
                  <MaterialIcon :name="dataset.icon" :size="14" class="shrink-0 text-outline" />
                  <span class="truncate text-body-sm font-semibold text-on-surface">
                    {{ dataset.label }}
                  </span>
                </span>
                <span class="block truncate text-label-xs text-outline">
                  {{ fileNameFor(dataset) }}
                </span>
              </span>
              <span class="shrink-0 tabular text-label-sm text-on-surface-variant">
                {{ counts[dataset.id] }}
              </span>
            </li>
          </ul>

          <p v-else class="mt-space-md text-label-sm text-outline">
            Nothing is selected yet. Tick at least one dataset above.
          </p>

          <div class="mt-space-md space-y-2">
            <BaseButton
              size="sm"
              variant="primary"
              icon="download"
              block
              :disabled="!selectedDatasets.length"
              @click="downloadAll"
            >
              Download {{ selectedDatasets.length || 'no' }} file{{
                selectedDatasets.length === 1 ? '' : 's'
              }}
            </BaseButton>

            <BaseButton
              size="sm"
              variant="outlined"
              icon="save"
              block
              :disabled="!native || !selectedDatasets.length"
              :loading="exporting"
              @click="exportToFile"
            >
              Export to file
            </BaseButton>
          </div>

          <p
            v-if="!native"
            class="mt-space-md rounded-sm bg-tertiary-fixed/50 p-space-sm text-label-sm text-on-tertiary-fixed"
          >
            <MaterialIcon name="info" :size="14" class="mr-1 inline" />
            <strong>Export to file</strong> opens a native save dialog and is part of the desktop
            application. In the browser build the download button writes the same files to the
            browser's downloads folder.
          </p>
          <p v-else class="mt-space-md text-label-xs text-outline">
            <strong>Export to file</strong> opens the desktop save dialog for each dataset in turn.
          </p>
        </section>
      </div>

      <p
        v-if="error"
        class="mt-space-md flex items-start gap-space-sm rounded-md border-l-4 border-l-error bg-error-container p-space-sm text-body-sm text-on-error-container"
        role="alert"
      >
        <MaterialIcon name="error" :size="18" class="mt-0.5 shrink-0" />
        {{ error }}
      </p>

      <!-- Notes -->
      <section class="mt-space-md rounded-md bg-surface-container-lowest p-space-md shadow-sm">
        <h2 class="text-headline-sm text-on-surface">What the numbers mean</h2>
        <div class="mt-space-md grid grid-cols-1 gap-space-md md:grid-cols-2">
          <div class="rounded-sm bg-surface-container-low p-space-sm text-body-sm text-on-surface-variant">
            <p class="flex items-center gap-1 text-label-md font-semibold text-on-surface">
              <MaterialIcon name="info" :size="15" class="text-primary" />
              Amounts are in major units
            </p>
            <p class="mt-0.5">
              Every amount is stored in paise and written out in rupees with two decimals, so
              {{ companyName }}'s books can be opened in a spreadsheet without any conversion.
            </p>
          </div>
          <div class="rounded-sm bg-surface-container-low p-space-sm text-body-sm text-on-surface-variant">
            <p class="flex items-center gap-1 text-label-md font-semibold text-on-surface">
              <MaterialIcon name="info" :size="15" class="text-primary" />
              The export is a copy, not a backup
            </p>
            <p class="mt-0.5">
              These files are a copy of the books at this moment. They are not written by the
              desktop shell, they are not verified, and they do not replace the
              <RouterLink to="/data/backup" class="font-semibold text-primary hover:underline">
                backup folder
              </RouterLink>.
            </p>
          </div>
        </div>
      </section>

      <BaseEmptyState
        v-if="!loading && !session.activeCompanyId"
        title="No company is open"
        description="Open a company from the toolbar before exporting."
        :icon="NoCompanyIcon"
        class="mt-space-md"
      />
    </div>
  </div>
</template>
