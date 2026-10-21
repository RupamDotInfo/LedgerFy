<script setup lang="ts">
import { computed, ref } from 'vue'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCheckbox from '@/components/ui/BaseCheckbox.vue'
import BaseEmptyState from '@/components/ui/BaseEmptyState.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import { formatDate } from '@/lib/datetime'
import { formatMoney, toMinor } from '@/lib/money'
import { useSessionStore } from '@/stores/session'
import { useToastStore } from '@/stores/toast'

const session = useSessionStore()
const toast = useToastStore()

const currency = computed(() => session.activeCompany?.baseCurrency ?? 'INR')

type TargetField = 'ignore' | 'date' | 'description' | 'reference' | 'debit' | 'credit'

interface ColumnMapping {
  index: number
  header: string
  target: TargetField
}

interface ParsedRow {
  lineNumber: number
  date: string
  description: string
  reference: string
  /** Money out of the bank, in minor units. */
  debit: number
  /** Money into the bank, in minor units. */
  credit: number
  reason: string | null
  raw: string
}

const step = ref<1 | 2 | 3>(1)
const fileName = ref('')
const fileError = ref<string | null>(null)
const headers = ref<string[]>([])
const dataRows = ref<string[][]>([])
const columns = ref<ColumnMapping[]>([])
const importValidOnly = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

const fieldOptions: Array<{ value: TargetField; label: string }> = [
  { value: 'ignore', label: 'Not used' },
  { value: 'date', label: 'Date' },
  { value: 'description', label: 'Description' },
  { value: 'reference', label: 'Reference' },
  { value: 'debit', label: 'Debit (money out)' },
  { value: 'credit', label: 'Credit (money in)' },
]

const steps = [
  { value: 1, label: 'Select source' },
  { value: 2, label: 'Map columns' },
  { value: 3, label: 'Preview and validate' },
] as const

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

/** Minimal RFC 4180 style parser: quoted fields, escaped quotes, CRLF or LF. */
function parseCsv(text: string): string[][] {
  const source = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!

    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
      continue
    }
    if (char === ',') {
      row.push(field)
      field = ''
      continue
    }
    if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      continue
    }
    field += char
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows.filter((candidate) => candidate.some((cell) => cell.trim() !== ''))
}

/** Guess the target field from a column heading. */
function detectTarget(header: string): TargetField {
  const name = header.toLowerCase().trim()
  if (!name) return 'ignore'
  if (/date|value date|txn date|transaction date/.test(name)) return 'date'
  if (/debit|withdrawal|withdraw|paid out|payment out|dr\b/.test(name)) return 'debit'
  if (/credit|deposit|paid in|payment in|cr\b/.test(name)) return 'credit'
  if (/description|narration|particular|details|remark|payee|transaction/.test(name)) {
    return 'description'
  }
  if (/reference|ref\b|utr|cheque|chq|instrument|txn id/.test(name)) return 'reference'
  return 'ignore'
}

function applyCsv(text: string, name: string) {
  fileError.value = null
  const rows = parseCsv(text)
  if (!rows.length) {
    fileError.value = 'That file has no readable rows.'
    headers.value = []
    dataRows.value = []
    columns.value = []
    return
  }

  const header = rows[0]!.map((cell, index) => cell.trim() || `Column ${index + 1}`)
  headers.value = header
  dataRows.value = rows.slice(1)
  columns.value = header.map((cell, index) => ({
    index,
    header: cell,
    target: detectTarget(cell),
  }))
  fileName.value = name
  importValidOnly.value = false
  step.value = 2
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  const reader = new FileReader()
  reader.onload = () => {
    const text = typeof reader.result === 'string' ? reader.result : ''
    applyCsv(text, file.name)
  }
  reader.onerror = () => {
    fileError.value = 'That file could not be read from disk.'
  }
  reader.readAsText(file)
}

function openFilePicker() {
  fileInput.value?.click()
}

const SAMPLE_CSV = [
  'Date,Description,Reference,Debit,Credit',
  '01/09/2026,NEFT credit from Anand Textiles Private Limited,UTR100234,,"12,500.00"',
  '02/09/2026,Cheque paid to Bharati Steel Traders,CHQ447120,8200.00,',
  '03/09/2026,NEFT credit from Shree Ganesh Hardware Stores,UTR100901,,4100.50',
  '04/09/2026,Bank charges - quarterly maintenance,STMT889,,150.00',
  '05/09/2026,RTGS receipt from Vertex Interiors,UTR101450,,75000.00',
  '06/09/2026,Cheque deposit towards sales,CHQ447188,15000.00,',
  ',Adjustment posted without a date,STMT890,,500.00',
  '08/09/2026,Transfer with an unreadable amount,STMT891,not-a-number,',
  '09/09/2026,Zero value line,STMT892,0,0',
].join('\n')

function loadSample() {
  applyCsv(SAMPLE_CSV, 'sample-bank-statement.csv')
}

// ---------------------------------------------------------------------------
// Column mapping
// ---------------------------------------------------------------------------

function setTarget(index: number, value: string | number | null) {
  const column = columns.value.find((candidate) => candidate.index === index)
  if (!column) return
  column.target = String(value) as TargetField
  importValidOnly.value = false
}

const mappingError = computed(() => {
  if (!columns.value.length) return 'No columns were detected in the file.'
  const targets = columns.value.map((column) => column.target)
  if (!targets.includes('date')) return 'Map one column to Date before continuing.'
  if (!targets.includes('debit') && !targets.includes('credit')) {
    return 'Map one column to Debit or Credit before continuing.'
  }
  return null
})

const mappedDate = computed(
  () => columns.value.find((column) => column.target === 'date')?.index ?? -1,
)
const mappedDescription = computed(
  () => columns.value.find((column) => column.target === 'description')?.index ?? -1,
)
const mappedReference = computed(
  () => columns.value.find((column) => column.target === 'reference')?.index ?? -1,
)
const mappedDebit = computed(
  () => columns.value.find((column) => column.target === 'debit')?.index ?? -1,
)
const mappedCredit = computed(
  () => columns.value.find((column) => column.target === 'credit')?.index ?? -1,
)

// ---------------------------------------------------------------------------
// Row validation
// ---------------------------------------------------------------------------

/** Parse a date cell into an ISO date, or return null when it is unusable. */
function parseDateCell(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null

  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(value)
  if (match) {
    return isoFrom(match[1]!, match[2]!, match[3]!)
  }
  match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(value)
  if (match) {
    return isoFrom(match[3]!, match[2]!, match[1]!)
  }
  return null
}

function isoFrom(year: string, month: string, day: string): string | null {
  const monthNumber = Number(month)
  const dayNumber = Number(day)
  if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31) return null
  const date = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00`)
  if (Number.isNaN(date.getTime())) return null
  if (date.getFullYear() !== Number(year)) return null
  if (date.getMonth() + 1 !== monthNumber) return null
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

/** Parse an amount cell. Returns null when the cell is not a number. */
function parseAmountCell(raw: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, '').replace(/^₹/, '').replace(/^INR/i, '').trim()
  if (!cleaned) return 0
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return null
  const value = Number(cleaned)
  if (!Number.isFinite(value)) return null
  return toMinor(value)
}

const parsedRows = computed<ParsedRow[]>(() =>
  dataRows.value.map((cells, index) => {
    const cell = (position: number) => (position >= 0 ? (cells[position] ?? '') : '')

    const dateRaw = cell(mappedDate.value)
    const description = cell(mappedDescription.value).trim()
    const reference = cell(mappedReference.value).trim()
    const debitRaw = cell(mappedDebit.value)
    const creditRaw = cell(mappedCredit.value)

    const debitValue = parseAmountCell(debitRaw)
    const creditValue = parseAmountCell(creditRaw)

    let debit = 0
    let credit = 0
    if (debitValue !== null && debitValue < 0) credit += -debitValue
    else if (debitValue !== null) debit += debitValue
    if (creditValue !== null && creditValue < 0) debit += -creditValue
    else if (creditValue !== null) credit += creditValue

    const date = parseDateCell(dateRaw)

    let reason: string | null = null
    if (!dateRaw.trim()) {
      reason = 'No date in the mapped date column'
    } else if (!date) {
      reason = `Date "${dateRaw.trim()}" is not a valid date`
    } else if (debitValue === null) {
      reason = `Debit "${debitRaw.trim()}" is not a number`
    } else if (creditValue === null) {
      reason = `Credit "${creditRaw.trim()}" is not a number`
    } else if (debit === 0 && credit === 0) {
      reason = 'Debit and credit are both empty or zero'
    }

    return {
      lineNumber: index + 2,
      date: date ?? '',
      description,
      reference,
      debit,
      credit,
      reason,
      raw: cells.join(', '),
    }
  }),
)

const validRows = computed(() => parsedRows.value.filter((row) => row.reason === null))
const rejectedRows = computed(() => parsedRows.value.filter((row) => row.reason !== null))

const importBlocked = computed(() => rejectedRows.value.length > 0 && !importValidOnly.value)

const importCount = computed(() => validRows.value.length)

const importSummary = computed(() => {
  if (!parsedRows.value.length) return 'No rows to import.'
  if (rejectedRows.value.length && !importValidOnly.value) {
    return `${rejectedRows.value.length} row${rejectedRows.value.length === 1 ? '' : 's'} would be rejected. Resolve them, or choose to import the valid rows only.`
  }
  if (rejectedRows.value.length) {
    return `${importCount.value} row${importCount.value === 1 ? '' : 's'} will be imported. ${rejectedRows.value.length} rejected row${rejectedRows.value.length === 1 ? '' : 's'} will be skipped.`
  }
  return `${importCount.value} row${importCount.value === 1 ? '' : 's'} will be imported.`
})

function runImport() {
  if (importBlocked.value || !importCount.value) return
  toast.info(
    'Statement ready to import',
    `${importCount.value} row${importCount.value === 1 ? '' : 's'} validated. Nothing was saved: the repository has no statement-import method yet.`,
  )
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      title="Statement import"
      subtitle="Read a bank statement CSV, map its columns and validate the rows"
      icon="upload_file"
    />

    <div class="min-h-0 flex-1 overflow-auto p-space-lg">
      <!-- Step indicator -->
      <ol class="mb-space-md flex flex-wrap items-center gap-space-sm" aria-label="Import steps">
        <li v-for="entry in steps" :key="entry.value" class="flex items-center gap-space-sm">
          <span
            class="flex size-7 items-center justify-center rounded-full text-label-sm font-bold"
            :class="
              step === entry.value
                ? 'bg-primary text-on-primary'
                : step > entry.value
                  ? 'bg-secondary-container text-on-secondary-container'
                  : 'bg-surface-container text-on-surface-variant'
            "
            :aria-current="step === entry.value ? 'step' : undefined"
          >
            <MaterialIcon v-if="step > entry.value" name="check" :size="15" />
            <span v-else>{{ entry.value }}</span>
          </span>
          <span
            class="text-label-md"
            :class="step === entry.value ? 'font-semibold text-on-surface' : 'text-outline'"
          >
            {{ entry.label }}
          </span>
          <MaterialIcon
            v-if="entry.value < 3"
            name="chevron_right"
            :size="16"
            class="text-outline-variant"
          />
        </li>
      </ol>

      <!-- Step 1: source -->
      <section
        v-if="step === 1"
        class="rounded-md bg-surface-container-lowest p-space-lg shadow-sm"
      >
        <h2 class="text-headline-sm text-on-surface">Select a statement file</h2>
        <p class="mt-0.5 max-w-2xl text-body-sm text-outline">
          Choose a CSV exported from your bank. The file is read in the browser and never
          leaves this machine.
        </p>

        <div
          class="mt-space-md flex flex-col items-center gap-3 rounded-md border border-dashed border-outline-variant bg-surface-container-low/60 px-space-lg py-space-xl text-center"
        >
          <MaterialIcon name="description" :size="32" class="text-outline" />
          <p class="text-body-md font-semibold text-on-surface">
            {{ fileName || 'No file selected yet' }}
          </p>
          <p class="max-w-sm text-label-sm text-outline">
            CSV files only. The first row is read as the column headings.
          </p>
          <input
            ref="fileInput"
            type="file"
            accept=".csv,text/csv,text/plain"
            class="sr-only"
            aria-label="Bank statement CSV file"
            @change="onFileChange"
          />
          <div class="flex flex-wrap items-center justify-center gap-space-sm">
            <BaseButton variant="primary" icon="folder_open" @click="openFilePicker">
              Choose CSV file
            </BaseButton>
            <BaseButton variant="outlined" icon="science" @click="loadSample">
              Load sample statement
            </BaseButton>
          </div>
        </div>

        <p
          v-if="fileError"
          class="mt-space-md rounded-md border-l-4 border-l-error bg-error-container p-space-sm text-body-sm text-on-error-container"
          role="alert"
        >
          {{ fileError }}
        </p>

        <p class="mt-space-md text-label-sm text-outline">
          The sample statement contains five valid rows and three rows that fail validation
          (a missing date, an unreadable amount and a zero-value line) so the checks can be
          exercised.
        </p>
      </section>

      <!-- Step 2: mapping -->
      <section v-else-if="step === 2" class="rounded-md bg-surface-container-lowest shadow-sm">
        <header class="flex flex-wrap items-center justify-between gap-3 px-space-md py-space-sm">
          <div>
            <h2 class="text-headline-sm text-on-surface">Map the detected columns</h2>
            <p class="text-label-sm text-outline">{{ fileName }}</p>
          </div>
          <BaseButton size="sm" variant="text" icon="refresh" @click="step = 1">
            Choose another file
          </BaseButton>
        </header>

        <div class="px-space-md pb-space-md">
          <div v-if="columns.length" class="overflow-x-auto">
            <table class="w-full text-left text-body-sm">
              <thead
                class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline"
              >
                <tr>
                  <th scope="col" class="px-space-md py-2.5">Detected column</th>
                  <th scope="col" class="px-space-sm py-2.5">Sample value</th>
                  <th scope="col" class="px-space-md py-2.5">Map to field</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-surface-container-low">
                <tr v-for="column in columns" :key="column.index">
                  <td class="px-space-md py-2.5 font-medium text-on-surface">
                    {{ column.header }}
                  </td>
                  <td class="max-w-[240px] truncate px-space-sm py-2.5 text-on-surface-variant">
                    {{ dataRows[0]?.[column.index] ?? '—' }}
                  </td>
                  <td class="px-space-md py-2.5">
                    <BaseSelect
                      :model-value="column.target"
                      :options="fieldOptions"
                      size="sm"
                      class="w-56"
                      :name="`column-${column.index}`"
                      @update:model-value="(value) => setTarget(column.index, value)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <BaseEmptyState
            v-else
            title="No columns detected"
            description="The file did not contain a heading row. Choose a different file."
            :icon="MaterialIcon"
          />

          <p
            v-if="mappingError"
            class="mt-space-md rounded-md border-l-4 border-l-error bg-error-container p-space-sm text-body-sm text-on-error-container"
            role="alert"
          >
            {{ mappingError }}
          </p>

          <div class="mt-space-md flex flex-wrap items-center justify-between gap-2">
            <span class="text-label-sm text-outline">
              {{ dataRows.length }} data row{{ dataRows.length === 1 ? '' : 's' }} read from the
              file.
            </span>
            <div class="flex items-center gap-space-sm">
              <BaseButton variant="outlined" size="sm" @click="step = 1">Back</BaseButton>
              <BaseButton
                variant="primary"
                size="sm"
                trailing-icon="arrow_forward"
                :disabled="Boolean(mappingError)"
                @click="step = 3"
              >
                Preview and validate
              </BaseButton>
            </div>
          </div>
        </div>
      </section>

      <!-- Step 3: preview and validate -->
      <section v-else class="space-y-space-md">
        <div class="rounded-md bg-surface-container-lowest shadow-sm">
          <header class="flex flex-wrap items-center justify-between gap-3 px-space-md py-space-sm">
            <div>
              <h2 class="text-headline-sm text-on-surface">Preview and validate</h2>
              <p class="text-label-sm text-outline">{{ fileName }}</p>
            </div>
            <div class="flex items-center gap-space-sm">
              <BaseBadge tone="positive" size="xs" icon="check_circle">
                {{ validRows.length }} accepted
              </BaseBadge>
              <BaseBadge :tone="rejectedRows.length ? 'danger' : 'neutral'" size="xs" icon="error">
                {{ rejectedRows.length }} rejected
              </BaseBadge>
              <BaseButton size="sm" variant="text" icon="arrow_back" @click="step = 2">
                Back to mapping
              </BaseButton>
            </div>
          </header>

          <div class="px-space-md pb-space-md">
            <div v-if="parsedRows.length" class="overflow-x-auto">
              <table class="w-full text-left text-body-sm">
                <thead
                  class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline"
                >
                  <tr>
                    <th scope="col" class="px-space-md py-2.5">Line</th>
                    <th scope="col" class="px-space-sm py-2.5">Date</th>
                    <th scope="col" class="px-space-sm py-2.5">Description</th>
                    <th scope="col" class="px-space-sm py-2.5">Reference</th>
                    <th scope="col" class="px-space-sm py-2.5 text-right">Debit</th>
                    <th scope="col" class="px-space-sm py-2.5 text-right">Credit</th>
                    <th scope="col" class="px-space-md py-2.5">Result</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-surface-container-low">
                  <tr
                    v-for="row in parsedRows"
                    :key="row.lineNumber"
                    :class="row.reason ? 'bg-error-container/20' : ''"
                  >
                    <td class="px-space-md py-2.5 text-numeric-sm tabular text-outline">
                      {{ row.lineNumber }}
                    </td>
                    <td class="whitespace-nowrap px-space-sm py-2.5 text-numeric-sm tabular text-on-surface">
                      {{ row.date ? formatDate(row.date) : '—' }}
                    </td>
                    <td class="max-w-[260px] truncate px-space-sm py-2.5 text-on-surface-variant">
                      {{ row.description || '—' }}
                    </td>
                    <td class="px-space-sm py-2.5 text-label-sm text-outline">
                      {{ row.reference || '—' }}
                    </td>
                    <td class="px-space-sm py-2.5 text-right text-numeric-sm tabular text-on-surface-variant">
                      {{ row.debit ? formatMoney(row.debit, currency) : '—' }}
                    </td>
                    <td class="px-space-sm py-2.5 text-right text-numeric-sm tabular text-on-surface-variant">
                      {{ row.credit ? formatMoney(row.credit, currency) : '—' }}
                    </td>
                    <td class="px-space-md py-2.5">
                      <BaseBadge
                        v-if="!row.reason"
                        tone="positive"
                        size="xs"
                        icon="check_circle"
                      >
                        Accepted
                      </BaseBadge>
                      <span v-else class="flex items-start gap-1 text-label-sm text-error">
                        <MaterialIcon name="error" :size="14" class="mt-0.5 shrink-0" />
                        {{ row.reason }}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <BaseEmptyState
              v-else
              title="No rows to preview"
              description="The file contained a heading row but no data rows."
              :icon="MaterialIcon"
            />
          </div>
        </div>

        <!-- Rejected rows -->
        <div
          v-if="rejectedRows.length"
          class="rounded-md border-l-4 border-l-error bg-error-container p-space-md"
        >
          <h3 class="flex items-center gap-space-sm text-headline-sm text-on-error-container">
            <MaterialIcon name="report" :size="20" />
            {{ rejectedRows.length }} row{{ rejectedRows.length === 1 ? '' : 's' }} will be rejected
          </h3>
          <ul class="mt-space-sm space-y-1 text-body-sm text-on-error-container">
            <li v-for="row in rejectedRows" :key="row.lineNumber" class="flex flex-col gap-0.5">
              <span class="flex gap-2">
                <span class="num shrink-0 font-bold tabular">Line {{ row.lineNumber }}</span>
                <span>{{ row.reason }}</span>
              </span>
              <span class="pl-1 font-mono text-label-xs text-on-error-container/80">
                {{ row.raw }}
              </span>
            </li>
          </ul>
        </div>

        <!-- Import action -->
        <div class="rounded-md bg-surface-container-lowest p-space-md shadow-sm">
          <h3 class="text-headline-sm text-on-surface">Import</h3>
          <p class="mt-0.5 text-body-sm text-on-surface-variant">{{ importSummary }}</p>

          <p
            class="mt-space-sm flex items-start gap-space-sm rounded-sm bg-surface-container-low p-space-sm text-body-sm text-on-surface-variant"
          >
            <MaterialIcon name="info" :size="18" class="mt-0.5 shrink-0 text-outline" />
            <span>
              Nothing is written to the books. The repository has no statement-import method
              yet, so this screen validates the file and hands the rows over for a future
              import implementation. No statement line is saved by pressing the button.
            </span>
          </p>

          <div class="mt-space-md flex flex-wrap items-center justify-between gap-space-md">
            <BaseCheckbox
              v-if="rejectedRows.length"
              v-model="importValidOnly"
              class="max-w-sm"
              label="Import the valid rows only"
              description="Skips the rejected rows instead of blocking the import."
            />
            <div class="flex items-center gap-space-sm">
              <BaseButton variant="outlined" size="sm" @click="step = 1">Start over</BaseButton>
              <BaseButton
                variant="primary"
                size="sm"
                icon="download_done"
                :disabled="importBlocked || !importCount"
                @click="runImport"
              >
                Import {{ importCount }} row{{ importCount === 1 ? '' : 's' }}
              </BaseButton>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
