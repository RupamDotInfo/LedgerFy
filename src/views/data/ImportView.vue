<script setup lang="ts">
import { computed, h, ref } from 'vue'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseEmptyState from '@/components/ui/BaseEmptyState.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import { useSessionStore } from '@/stores/session'
import { useToastStore } from '@/stores/toast'

type FieldType = 'text' | 'number' | 'boolean'

interface TargetField {
  key: string
  label: string
  type: FieldType
  required: boolean
  hint?: string
}

interface Target {
  id: string
  label: string
  description: string
  fields: TargetField[]
}

interface RejectedRow {
  rowNumber: number
  values: Record<string, string>
  reasons: string[]
}

interface WarningRow {
  rowNumber: number
  message: string
}

const TARGETS: Target[] = [
  {
    id: 'ledgers',
    label: 'Ledgers',
    description: 'Accounts, parties and control accounts',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      {
        key: 'group',
        label: 'Group',
        type: 'text',
        required: true,
        hint: 'assets, liabilities, equity, income or expenses',
      },
      {
        key: 'type',
        label: 'Type',
        type: 'text',
        required: true,
        hint: 'cash, bank, receivable, payable, sales …',
      },
      { key: 'openingBalance', label: 'Opening balance', type: 'number', required: false },
      { key: 'partyKind', label: 'Party kind', type: 'text', required: false, hint: 'customer, supplier or both' },
      { key: 'currency', label: 'Currency', type: 'text', required: false },
      { key: 'taxNumber', label: 'GSTIN / tax number', type: 'text', required: false },
      { key: 'email', label: 'Email', type: 'text', required: false },
      { key: 'phone', label: 'Phone', type: 'text', required: false },
      { key: 'address', label: 'Address', type: 'text', required: false },
    ],
  },
  {
    id: 'items',
    label: 'Items',
    description: 'Stock items and services',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'stockGroup', label: 'Stock group', type: 'text', required: true },
      { key: 'unit', label: 'Unit', type: 'text', required: true },
      { key: 'isInventory', label: 'Is inventory', type: 'boolean', required: false },
      { key: 'purchasePrice', label: 'Purchase price', type: 'number', required: false },
      { key: 'salesPrice', label: 'Sale price', type: 'number', required: false },
      { key: 'hsn', label: 'HSN code', type: 'text', required: false },
      { key: 'taxCategory', label: 'Tax category', type: 'text', required: false },
      { key: 'openingQuantity', label: 'Opening quantity', type: 'number', required: false },
      { key: 'reorderLevel', label: 'Reorder level', type: 'number', required: false },
    ],
  },
  {
    id: 'tax-categories',
    label: 'Tax categories',
    description: 'CGST, SGST, IGST, cess and TDS rates',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'rate', label: 'Rate', type: 'number', required: true, hint: 'A percentage, e.g. 9' },
      { key: 'type', label: 'Type', type: 'text', required: true, hint: 'cgst, sgst, igst, cess, tds or tcs' },
      { key: 'hsn', label: 'HSN code', type: 'text', required: false },
    ],
  },
]

const SAMPLE_CSV = `Name,Group,Type,Opening Balance,Party Kind,Currency
Cash,assets,cash,0,,INR
HDFC Bank,assets,bank,250000,,INR
Ramesh Traders,assets,receivable,0,customer,INR
Sundry Debtors,assets,receivable,0,customer,INR
Printer Paper,assets,current-assets,0,,INR`

const session = useSessionStore()
const toast = useToastStore()

/** `BaseEmptyState` renders the icon component without a name, so bind one here. */
const NoRowsIcon = () => h(MaterialIcon, { name: 'table_rows', size: 19 })

const step = ref<1 | 2 | 3>(1)
const targetId = ref<string>(TARGETS[0]!.id)
const fileName = ref('')
const fileSize = ref(0)
const columns = ref<string[]>([])
const rows = ref<string[][]>([])
const readError = ref<string | null>(null)
const mapping = ref<Record<string, string>>({})

const target = computed<Target>(
  () => TARGETS.find((candidate) => candidate.id === targetId.value) ?? TARGETS[0]!,
)

const mappingOptions = computed(() => [
  { value: '', label: 'Do not import' },
  ...columns.value.map((column) => ({ value: column, label: column })),
])

// ---------------------------------------------------------------------------
// Step 1 — file selection
// ---------------------------------------------------------------------------

function parseCsv(text: string): string[][] {
  const parsed: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        field += character
      }
      continue
    }
    if (character === '"') {
      inQuotes = true
      continue
    }
    if (character === ',') {
      row.push(field)
      field = ''
      continue
    }
    if (character === '\n') {
      row.push(field)
      parsed.push(row)
      row = []
      field = ''
      continue
    }
    if (character === '\r') continue
    field += character
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    parsed.push(row)
  }

  return parsed.filter((candidate) => candidate.some((cell) => cell.trim() !== ''))
}

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function guessMapping(detected: string[], fields: TargetField[]): Record<string, string> {
  const result: Record<string, string> = {}
  const used = new Set<string>()

  for (const field of fields) {
    const fieldKey = normalise(field.key)
    const fieldLabel = normalise(field.label)
    const match = detected.find((column) => {
      if (used.has(column)) return false
      const candidate = normalise(column)
      return candidate === fieldKey || candidate === fieldLabel || candidate.endsWith(fieldKey)
    })
    if (match) {
      result[field.key] = match
      used.add(match)
    }
  }

  return result
}

function reset() {
  columns.value = []
  rows.value = []
  mapping.value = {}
  readError.value = null
  fileName.value = ''
  fileSize.value = 0
}

function loadText(name: string, size: number, text: string) {
  reset()
  fileName.value = name
  fileSize.value = size
  readError.value = null

  const parsed = parseCsv(text)
  if (!parsed.length) {
    readError.value = 'The file has no rows in it.'
    return
  }

  const header = parsed[0]!.map((cell) => cell.trim())
  columns.value = header
  rows.value = parsed.slice(1)
  mapping.value = guessMapping(header, target.value.fields)
  step.value = 2
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  const reader = new FileReader()
  reader.onload = () => {
    loadText(file.name, file.size, String(reader.result ?? ''))
  }
  reader.onerror = () => {
    reset()
    readError.value = 'The file could not be read from disk.'
  }
  reader.readAsText(file)
}

function loadSample() {
  loadText('sample-ledgers.csv', new Blob([SAMPLE_CSV]).size, SAMPLE_CSV)
}

// ---------------------------------------------------------------------------
// Step 2 — column mapping
// ---------------------------------------------------------------------------

function onTargetChange() {
  mapping.value = guessMapping(columns.value, target.value.fields)
}

const mappingComplete = computed(() =>
  target.value.fields
    .filter((field) => field.required)
    .every((field) => Boolean(mapping.value[field.key])),
)

// ---------------------------------------------------------------------------
// Step 3 — preview and validation
// ---------------------------------------------------------------------------

interface PreviewRow {
  rowNumber: number
  values: Record<string, string>
  valid: boolean
  reasons: string[]
}

const preview = computed<PreviewRow[]>(() => {
  const fields = target.value.fields
  return rows.value.map((row, index) => {
    const values: Record<string, string> = {}
    const reasons: string[] = []

    for (const field of fields) {
      const column = mapping.value[field.key]
      const raw = column ? (row[columns.value.indexOf(column)] ?? '') : ''
      const value = raw.trim()
      values[field.key] = value

      if (field.required && value === '') {
        reasons.push(`${field.label} is required`)
        continue
      }
      if (field.type === 'number' && value !== '' && !Number.isFinite(Number(value))) {
        reasons.push(`${field.label} is not a number`)
      }
    }

    return { rowNumber: index + 2, values, valid: reasons.length === 0, reasons }
  })
})

const validRows = computed(() => preview.value.filter((row) => row.valid))
const rejectedRows = computed<RejectedRow[]>(() =>
  preview.value
    .filter((row) => !row.valid)
    .map((row) => ({ rowNumber: row.rowNumber, values: row.values, reasons: row.reasons })),
)

const warnings = computed<WarningRow[]>(() => {
  const seen = new Map<string, number>()
  const result: WarningRow[] = []
  const nameKey = target.value.fields.some((field) => field.key === 'name') ? 'name' : null
  if (!nameKey) return result

  for (const row of preview.value) {
    const name = row.values[nameKey] ?? ''
    if (!name) continue
    const key = name.toLowerCase()
    const first = seen.get(key)
    if (first === undefined) {
      seen.set(key, row.rowNumber)
    } else {
      result.push({
        rowNumber: row.rowNumber,
        message: `"${name}" also appears on row ${first}. Both rows would be imported.`,
      })
    }
  }
  return result
})

// ---------------------------------------------------------------------------
// Exporting the parsed result
// ---------------------------------------------------------------------------

function csvCell(value: string): string {
  if (value === '') return ''
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function buildCsv(): string {
  const fields = target.value.fields.filter((field) => mapping.value[field.key])
  const header = fields.map((field) => csvCell(field.label)).join(',')
  const body = validRows.value.map((row) =>
    fields.map((field) => csvCell(row.values[field.key] ?? '')).join(','),
  )
  return [header, ...body].join('\r\n')
}

function downloadCsv() {
  const csv = buildCsv()
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const companySlug = (session.activeCompany?.name ?? 'company')
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase()
  const name = `${companySlug}-${target.value.id}-parsed.csv`
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
  toast.success(
    'Parsed rows downloaded',
    `${validRows.value.length} rows were written to ${name}.`,
  )
}

function startOver() {
  reset()
  step.value = 1
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      title="Import data"
      subtitle="Read a CSV of masters, check it, and take the result away"
      icon="upload_file"
      :breadcrumb="[{ label: 'Data and tools', to: '/data/integrity' }, { label: 'Import data' }]"
    />

    <div class="min-h-0 flex-1 overflow-auto p-space-lg">
      <!-- Stepper -->
      <ol class="flex flex-wrap items-center gap-space-sm" aria-label="Import steps">
        <li v-for="item in 3" :key="item" class="flex items-center gap-space-sm">
          <span
            class="flex size-6 items-center justify-center rounded-full text-label-xs font-bold"
            :class="
              step > item
                ? 'bg-secondary-container text-on-secondary-container'
                : step === item
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container text-outline'
            "
          >
            <MaterialIcon v-if="step > item" name="check" :size="14" />
            <span v-else>{{ item }}</span>
          </span>
          <span
            class="text-label-sm"
            :class="step === item ? 'font-semibold text-on-surface' : 'text-outline'"
          >
            {{ ['Choose a file', 'Map the columns', 'Check the rows'][item - 1] }}
          </span>
          <MaterialIcon
            v-if="item < 3"
            name="chevron_right"
            :size="16"
            class="text-outline-variant"
            aria-hidden="true"
          />
        </li>
      </ol>

      <!-- Step 1 — file -->
      <section v-if="step === 1" class="mt-space-md rounded-md bg-surface-container-lowest p-space-md shadow-sm">
        <h2 class="text-headline-sm text-on-surface">Choose the file to import</h2>
        <p class="mt-0.5 text-label-sm text-outline">
          A comma separated file with a header row. The first row names the columns; the rows below
          it are the records.
        </p>

        <div class="mt-space-md grid grid-cols-1 gap-space-md lg:grid-cols-2">
          <div class="rounded-sm bg-surface-container-low p-space-md">
            <p class="section-label">What are you importing?</p>
            <BaseSelect
              v-model="targetId"
              class="mt-space-xs"
              label="Master"
              :options="TARGETS.map((entry) => ({ value: entry.id, label: entry.label }))"
              @update:model-value="onTargetChange"
            />
            <p class="mt-space-xs text-label-sm text-outline">
              {{ target.description }}. The required fields are
              {{ target.fields.filter((field) => field.required).map((field) => field.label).join(', ') }}.
            </p>
          </div>

          <div class="rounded-sm bg-surface-container-low p-space-md">
            <p class="section-label">Pick a file</p>
            <label
              class="mt-space-xs flex cursor-pointer flex-col items-center gap-2 rounded-sm border border-dashed border-outline-variant bg-surface-container-lowest p-space-lg text-center"
            >
              <MaterialIcon name="upload_file" :size="26" class="text-primary" />
              <span class="text-body-md font-semibold text-on-surface">Choose a CSV file</span>
              <span class="text-label-sm text-outline">
                The file is read in this window and is never uploaded anywhere.
              </span>
              <input
                type="file"
                accept=".csv,text/csv"
                class="sr-only"
                aria-label="Choose a CSV file to import"
                @change="onFileChange"
              />
            </label>
          </div>
        </div>

        <div class="mt-space-md flex flex-wrap items-center gap-2">
          <BaseButton size="sm" variant="outlined" icon="science" @click="loadSample">
            Load the sample file
          </BaseButton>
          <span class="text-label-xs text-outline">
            A five-row sample of ledgers, so the mapping and the checks can be tried out.
          </span>
        </div>

        <p
          v-if="readError"
          class="mt-space-md flex items-start gap-space-sm rounded-sm border-l-4 border-l-error bg-error-container p-space-sm text-body-sm text-on-error-container"
          role="alert"
        >
          <MaterialIcon name="error" :size="18" class="mt-0.5 shrink-0" />
          {{ readError }}
        </p>
      </section>

      <!-- Step 2 — mapping -->
      <section v-else-if="step === 2" class="mt-space-md rounded-md bg-surface-container-lowest p-space-md shadow-sm">
        <header class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="text-headline-sm text-on-surface">Map the columns</h2>
            <p class="mt-0.5 text-label-sm text-outline">
              {{ fileName }} · {{ columns.length }} columns · {{ rows.length }} rows read
            </p>
          </div>
          <div class="flex items-center gap-1.5">
            <BaseButton size="sm" variant="text" @click="startOver">Choose another file</BaseButton>
            <BaseButton size="sm" variant="primary" icon="arrow_forward" @click="step = 3">
              Check the rows
            </BaseButton>
          </div>
        </header>

        <p
          v-if="!mappingComplete"
          class="mt-space-md flex items-start gap-space-sm rounded-sm border-l-4 border-l-tertiary bg-tertiary-fixed p-space-sm text-body-sm text-on-tertiary-fixed"
          role="status"
        >
          <MaterialIcon name="warning" :size="18" class="mt-0.5 shrink-0" />
          <span>
            Some required fields have no column yet. They are
            {{ target.fields.filter((field) => field.required && !mapping[field.key]).map((field) => field.label).join(', ') }}.
            Rows that leave them empty are rejected on the next step.
          </span>
        </p>

        <div class="mt-space-md overflow-hidden rounded-sm border border-surface-container">
          <table class="w-full text-left text-body-sm">
            <thead class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline">
              <tr>
                <th scope="col" class="px-space-sm py-2">Target field</th>
                <th scope="col" class="px-space-sm py-2">Column in the file</th>
                <th scope="col" class="px-space-sm py-2">Kind</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-surface-container-low">
              <tr v-for="field in target.fields" :key="field.key">
                <td class="px-space-sm py-1.5">
                  <span class="font-semibold text-on-surface">{{ field.label }}</span>
                  <span v-if="field.required" class="text-error" aria-hidden="true">*</span>
                  <span class="ml-1 text-label-xs text-outline">{{ field.key }}</span>
                </td>
                <td class="px-space-sm py-1.5">
                  <label class="block">
                    <span class="sr-only">Column for {{ field.label }}</span>
                    <BaseSelect
                      v-model="mapping[field.key]"
                      size="sm"
                      :options="mappingOptions"
                    />
                  </label>
                </td>
                <td class="px-space-sm py-1.5 text-label-sm text-outline">
                  {{ field.type }}<span v-if="field.required"> · required</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p v-if="target.fields.some((field) => field.hint)" class="mt-space-xs text-label-xs text-outline">
          {{ target.fields.filter((field) => field.hint).map((field) => `${field.label}: ${field.hint}`).join(' · ') }}
        </p>
      </section>

      <!-- Step 3 — preview and validation -->
      <section v-else class="mt-space-md space-y-space-md">
        <div class="rounded-md bg-surface-container-lowest p-space-md shadow-sm">
          <header class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 class="text-headline-sm text-on-surface">Check the rows</h2>
              <p class="mt-0.5 text-label-sm text-outline">
                {{ fileName }} · {{ preview.length }} rows read
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-1.5">
              <BaseBadge tone="positive" size="xs" icon="check_circle">
                {{ validRows.length }} ready
              </BaseBadge>
              <BaseBadge :tone="rejectedRows.length ? 'danger' : 'neutral'" size="xs" icon="cancel">
                {{ rejectedRows.length }} rejected
              </BaseBadge>
              <BaseBadge v-if="warnings.length" tone="warning" size="xs" icon="warning">
                {{ warnings.length }} warning{{ warnings.length === 1 ? '' : 's' }}
              </BaseBadge>
            </div>
          </header>

          <div
            v-if="!preview.length"
            class="mt-space-md"
          >
            <BaseEmptyState
              title="No rows to import"
              description="The file had a header row but no records below it."
              :icon="NoRowsIcon"
            />
          </div>

          <template v-else>
            <!-- Preview -->
            <div class="mt-space-md overflow-hidden rounded-sm border border-surface-container">
              <table class="w-full text-left text-body-sm">
                <thead
                  class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline"
                >
                  <tr>
                    <th scope="col" class="px-space-sm py-2">Row</th>
                    <th
                      v-for="field in target.fields"
                      :key="field.key"
                      scope="col"
                      class="px-space-sm py-2"
                    >
                      {{ field.label }}
                    </th>
                    <th scope="col" class="px-space-sm py-2">Result</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-surface-container-low">
                  <tr
                    v-for="row in preview.slice(0, 12)"
                    :key="row.rowNumber"
                    class="align-top"
                    :class="row.valid ? '' : 'bg-error-container/25'"
                  >
                    <td class="px-space-sm py-1.5 tabular text-outline">{{ row.rowNumber }}</td>
                    <td
                      v-for="field in target.fields"
                      :key="field.key"
                      class="px-space-sm py-1.5"
                      :class="field.type === 'number' ? 'tabular' : ''"
                    >
                      {{ row.values[field.key] || '—' }}
                    </td>
                    <td class="px-space-sm py-1.5">
                      <BaseBadge v-if="row.valid" tone="positive" size="xs" icon="check">Ready</BaseBadge>
                      <span v-else class="text-label-xs font-semibold text-error">
                        {{ row.reasons.join('; ') }}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
              <p
                v-if="preview.length > 12"
                class="border-t border-surface-container bg-surface-container-low/60 px-space-sm py-1.5 text-label-xs text-outline"
              >
                Showing the first 12 of {{ preview.length }} rows.
              </p>
            </div>

            <!-- Rejected rows -->
            <div v-if="rejectedRows.length" class="mt-space-md">
              <h3 class="section-label">Rejected rows</h3>
              <ul class="mt-space-xs divide-y divide-surface-container-low rounded-sm border border-surface-container">
                <li
                  v-for="row in rejectedRows"
                  :key="row.rowNumber"
                  class="flex flex-wrap items-baseline gap-2 px-space-sm py-1.5"
                >
                  <span class="tabular text-label-sm font-semibold text-on-surface">
                    Row {{ row.rowNumber }}
                  </span>
                  <span class="text-label-sm text-error">{{ row.reasons.join('; ') }}</span>
                  <span class="truncate text-label-xs text-outline">
                    {{ row.values.name || '(no name)' }}
                  </span>
                </li>
              </ul>
            </div>

            <!-- Warnings -->
            <div v-if="warnings.length" class="mt-space-md">
              <h3 class="section-label">Warnings</h3>
              <ul class="mt-space-xs space-y-1">
                <li
                  v-for="warning in warnings"
                  :key="`${warning.rowNumber}-${warning.message}`"
                  class="flex items-start gap-1.5 text-label-sm text-on-surface-variant"
                >
                  <MaterialIcon name="warning" :size="14" class="mt-0.5 shrink-0 text-tertiary" />
                  <span>Row {{ warning.rowNumber }}: {{ warning.message }}</span>
                </li>
              </ul>
            </div>
          </template>
        </div>

        <!-- What happens next -->
        <div class="rounded-md bg-surface-container-lowest p-space-md shadow-sm">
          <h2 class="text-headline-sm text-on-surface">What happens next</h2>

          <div
            class="mt-space-md flex items-start gap-space-sm rounded-sm border-l-4 border-l-tertiary bg-tertiary-fixed p-space-sm text-body-sm text-on-tertiary-fixed"
            role="status"
          >
            <MaterialIcon name="block" :size="18" class="mt-0.5 shrink-0" />
            <p>
              The demo repository has no master-import endpoint, so these
              {{ validRows.length }} rows are <strong>not written to the books</strong>. The
              import button below is disabled for that reason. Take the parsed rows away as a CSV
              instead, and import them for real once the local database milestone lands.
            </p>
          </div>

          <div class="mt-space-md flex flex-wrap items-center gap-2">
            <BaseButton
              size="sm"
              variant="primary"
              icon="download"
              :disabled="!validRows.length"
              @click="downloadCsv"
            >
              Download the parsed CSV
            </BaseButton>
            <BaseButton size="sm" variant="neutral" icon="upload_file" disabled>
              Import into the books
            </BaseButton>
            <BaseButton size="sm" variant="text" icon="restart_alt" @click="startOver">
              Start over
            </BaseButton>
          </div>

          <p class="mt-space-xs text-label-xs text-outline">
            The downloaded file holds {{ validRows.length }} rows of
            {{ target.label.toLowerCase() }} with the column headings
            {{ target.fields.filter((field) => mapping[field.key]).map((field) => field.label).join(', ') }}.
            Nothing is left in the browser after the download.
          </p>
        </div>
      </section>
    </div>
  </div>
</template>
