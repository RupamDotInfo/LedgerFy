<script setup lang="ts">
import { computed, h, ref } from 'vue'
import { invoke, isTauri } from '@tauri-apps/api/core'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseEmptyState from '@/components/ui/BaseEmptyState.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import { useSessionStore } from '@/stores/session'
import { useToastStore } from '@/stores/toast'

/**
 * The native shell is only present inside the Tauri webview. `isTauri()` reads
 * a global that is only injected when `withGlobalTauri` is enabled, so the IPC
 * bridge is probed as well — that is what `invoke` itself uses.
 */
function nativeAvailable(): boolean {
  if (isTauri()) return true
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

type SourceFormat = 'tally-xml' | 'csv' | 'ledgerfy-json' | 'unknown'

interface SourceRecord {
  kind: 'Ledger' | 'Stock item' | 'Row'
  name: string
  group: string
  amount: string
  date: string
  extra: string
}

interface MappingRow {
  source: string
  target: string
  recognised: boolean
}

interface ValidationIssue {
  recordNumber: number
  severity: 'error' | 'warning'
  message: string
}

const TALLY_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
  <TALLYDATA>
    <REQUESTDESC>
      <REPORTNAME>Ledgers and Stock Items</REPORTNAME>
      <STATICVARIABLES>
        <SICODE>331</SICODE>
        <FROMDATE>20260401</FROMDATE>
        <TODATE>20261020</TODATE>
      </STATICVARIABLES>
    </REQUESTDESC>
    <REQUESTDATA>
      <TALLYMESSAGE>
        <LEDGERENTRIESLIST>
          <LEDGERNAME>Cash</LEDGERNAME>
          <GROUPNAME>Cash</GROUPNAME>
          <OPENINGBALANCE>0</OPENINGBALANCE>
          <AMOUNT>125000.00</AMOUNT>
          <DATE>2026-04-01</DATE>
        </LEDGERENTRIESLIST>
        <LEDGERENTRIESLIST>
          <LEDGERNAME>HDFC Bank</LEDGERNAME>
          <GROUPNAME>Bank</GROUPNAME>
          <OPENINGBALANCE>250000</OPENINGBALANCE>
          <AMOUNT>482150.75</AMOUNT>
          <DATE>2026-04-02</DATE>
        </LEDGERENTRIESLIST>
        <LEDGERENTRIESLIST>
          <LEDGERNAME>Ramesh Traders</LEDGERNAME>
          <GROUPNAME>Sundry Debtors</GROUPNAME>
          <OPENINGBALANCE>0</OPENINGBALANCE>
          <AMOUNT>96400</AMOUNT>
          <DATE>2026-04-05</DATE>
        </LEDGERENTRIESLIST>
        <STOCKITEMENTRIESLIST>
          <STOCKITEMNAME>Printer Paper A4</STOCKITEMNAME>
          <STOCKGROUPNAME>Stationery</STOCKGROUPNAME>
          <UOM>Nos</UOM>
          <OPENINGQTY>120</OPENINGQTY>
          <AMOUNT>48000</AMOUNT>
          <DATE>2026-04-03</DATE>
        </STOCKITEMENTRIESLIST>
        <STOCKITEMENTRIESLIST>
          <STOCKITEMNAME>Printer Toner</STOCKITEMNAME>
          <STOCKGROUPNAME>Stationery</STOCKGROUPNAME>
          <UOM>Nos</UOM>
          <OPENINGQTY>24</OPENINGQTY>
          <AMOUNT>96000</AMOUNT>
          <DATE>2026-04-06</DATE>
        </STOCKITEMENTRIESLIST>
      </TALLYMESSAGE>
    </REQUESTDATA>
  </TALLYDATA>
</ENVELOPE>`

const TALLY_ELEMENTS = [
  { tag: 'LEDGERNAME', target: 'Ledger name' },
  { tag: 'GROUPNAME', target: 'Account group' },
  { tag: 'OPENINGBALANCE', target: 'Opening balance' },
  { tag: 'STOCKITEMNAME', target: 'Item name' },
  { tag: 'STOCKGROUPNAME', target: 'Stock group' },
  { tag: 'UOM', target: 'Unit' },
  { tag: 'AMOUNT', target: 'Amount' },
  { tag: 'DATE', target: 'Date' },
]

const CSV_TARGETS = [
  { key: 'name', label: 'Ledger or item name' },
  { key: 'group', label: 'Account or stock group' },
  { key: 'amount', label: 'Amount' },
  { key: 'date', label: 'Date' },
]

const session = useSessionStore()
const toast = useToastStore()

const native = ref(nativeAvailable())
const step = ref(1)
const fileName = ref('')
const fileSize = ref(0)
const fileText = ref('')
const format = ref<SourceFormat>('unknown')
const readError = ref<string | null>(null)
const records = ref<SourceRecord[]>([])
const detectedColumns = ref<string[]>([])
const csvMapping = ref<Record<string, string>>({})

const STEPS = [
  { number: 1, title: 'File selection', note: 'Choose the file to migrate' },
  { number: 2, title: 'Source format', note: 'Recognise what the file is' },
  { number: 3, title: 'Field mapping', note: 'Match source fields to LedgerFy' },
  { number: 4, title: 'Preview', note: 'Look at the records that were read' },
  { number: 5, title: 'Validation', note: 'Check every record' },
  { number: 6, title: 'Errors and warnings', note: 'What would stop the import' },
  { number: 7, title: 'Import execution', note: 'Write the records to the books' },
  { number: 8, title: 'Reconciliation', note: 'Compare the books after the import' },
  { number: 9, title: 'Completion', note: 'What was done and what was not' },
]

const stepState = (number: number): 'done' | 'current' | 'pending' | 'blocked' => {
  if (number < step.value) return 'done'
  if (number === step.value) return 'current'
  if (number >= 7) return 'blocked'
  return 'pending'
}

/** `BaseEmptyState` renders the icon component without a name, so bind one here. */
const NoFileIcon = () => h(MaterialIcon, { name: 'upload_off', size: 19 })
const NoMappingIcon = () => h(MaterialIcon, { name: 'link_off', size: 19 })
const NoRecordsIcon = () => h(MaterialIcon, { name: 'search_off', size: 19 })

// ---------------------------------------------------------------------------
// Step 1 — file selection
// ---------------------------------------------------------------------------

function reset() {
  fileName.value = ''
  fileSize.value = 0
  fileText.value = ''
  format.value = 'unknown'
  records.value = []
  detectedColumns.value = []
  csvMapping.value = {}
  readError.value = null
}

function detectFormat(name: string): SourceFormat {
  const lower = name.toLowerCase()
  if (lower.endsWith('.xml')) return 'tally-xml'
  if (lower.endsWith('.csv')) return 'csv'
  if (lower.endsWith('.json')) return 'ledgerfy-json'
  return 'unknown'
}

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function readText(name: string, size: number, text: string) {
  reset()
  fileName.value = name
  fileSize.value = size
  fileText.value = text
  format.value = detectFormat(name)
  if (format.value === 'unknown') {
    readError.value =
      'The file type was not recognised. Migration reads .xml, .csv and .json files in this build.'
  }
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => readText(file.name, file.size, String(reader.result ?? ''))
  reader.onerror = () => {
    reset()
    readError.value = 'The file could not be read from disk.'
  }
  reader.readAsText(file)
}

async function pickWithDesktopDialog() {
  if (!native.value) return
  try {
    const content = await invoke<string | null>('import_from_file')
    if (content === null) return
    readText('desktop-selection', content.length, content)
    toast.info('File read', 'The desktop dialog does not report the file name, so it is shown as a desktop selection.')
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'The file could not be read.'
    readError.value = message
    toast.error('Could not read the file', message)
  }
}

function loadTallySample() {
  readText('tally-sample.xml', new Blob([TALLY_SAMPLE]).size, TALLY_SAMPLE)
}

// ---------------------------------------------------------------------------
// Step 2 — recognition
// ---------------------------------------------------------------------------

const formatLabel = computed(() => {
  switch (format.value) {
    case 'tally-xml':
      return 'Tally-style XML'
    case 'csv':
      return 'Comma separated values'
    case 'ledgerfy-json':
      return 'LedgerFy JSON'
    default:
      return 'Not recognised'
  }
})

const formatConfidence = computed(() => {
  switch (format.value) {
    case 'tally-xml':
      return 'Recognised by the .xml extension'
    case 'csv':
      return 'Recognised by the .csv extension'
    case 'ledgerfy-json':
      return 'Recognised by the .json extension'
    default:
      return 'The extension is not one this build reads'
  }
})

// ---------------------------------------------------------------------------
// Step 3 — mapping, and reading the records
// ---------------------------------------------------------------------------

const mappingRows = computed<MappingRow[]>(() => {
  if (format.value === 'tally-xml') {
    return TALLY_ELEMENTS.map((element) => ({
      source: `<${element.tag}>`,
      target: element.target,
      recognised: fileText.value.includes(`<${element.tag}>`),
    }))
  }
  if (format.value === 'csv') {
    return CSV_TARGETS.map((target) => ({
      source: csvMapping.value[target.key] || 'Not mapped',
      target: target.label,
      recognised: Boolean(csvMapping.value[target.key]),
    }))
  }
  return []
})

const csvColumnOptions = computed(() => [
  { value: '', label: 'Not mapped' },
  ...detectedColumns.value.map((column) => ({ value: column, label: column })),
])

function guessCsvMapping(columns: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  const used = new Set<string>()
  for (const target of CSV_TARGETS) {
    const key = normalise(target.key)
    const label = normalise(target.label)
    const match = columns.find((column) => {
      if (used.has(column)) return false
      const candidate = normalise(column)
      return candidate === key || candidate === label || candidate.endsWith(key)
    })
    if (match) {
      result[target.key] = match
      used.add(match)
    }
  }
  return result
}

function parseCsvRows(text: string): string[][] {
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
        } else inQuotes = false
      } else field += character
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
  return parsed.filter((candidate) => candidate.some((value) => value.trim() !== ''))
}

function textOf(node: Element | null): string {
  return node?.textContent?.trim() ?? ''
}

function readTallyRecords(text: string): SourceRecord[] {
  const result: SourceRecord[] = []
  const document = new DOMParser().parseFromString(text, 'application/xml')
  if (document.querySelector('parsererror')) {
    throw new Error('The XML could not be parsed.')
  }

  const nodes = document.querySelectorAll('LEDGERENTRIESLIST, STOCKITEMENTRIESLIST')
  for (const node of Array.from(nodes)) {
    const isLedger = node.querySelector('LEDGERNAME') !== null
    result.push({
      kind: isLedger ? 'Ledger' : 'Stock item',
      name: textOf(node.querySelector(isLedger ? 'LEDGERNAME' : 'STOCKITEMNAME')),
      group: textOf(node.querySelector(isLedger ? 'GROUPNAME' : 'STOCKGROUPNAME')),
      amount: textOf(node.querySelector('AMOUNT')),
      date: textOf(node.querySelector('DATE')),
      extra: isLedger ? textOf(node.querySelector('OPENINGBALANCE')) : textOf(node.querySelector('UOM')),
    })
  }
  return result
}

function readCsvRecords(text: string): SourceRecord[] {
  const parsed = parseCsvRows(text)
  if (!parsed.length) return []
  const header = parsed[0]!.map((value) => value.trim())
  const value = (row: string[], key: string) => {
    const column = csvMapping.value[key]
    if (!column) return ''
    const index = header.indexOf(column)
    return index >= 0 ? (row[index] ?? '').trim() : ''
  }
  return parsed.slice(1).map((row) => ({
    kind: 'Row',
    name: value(row, 'name'),
    group: value(row, 'group'),
    amount: value(row, 'amount'),
    date: value(row, 'date'),
    extra: '',
  }))
}

/** Records are read when the wizard advances past the mapping step. */
function ensureRecords() {
  if (records.value.length || !fileText.value) return
  if (format.value === 'tally-xml') {
    records.value = readTallyRecords(fileText.value)
  } else if (format.value === 'csv') {
    const parsed = parseCsvRows(fileText.value)
    detectedColumns.value = parsed[0]?.map((value) => value.trim()) ?? []
    if (!Object.keys(csvMapping.value).length) {
      csvMapping.value = guessCsvMapping(detectedColumns.value)
    }
    records.value = readCsvRecords(fileText.value)
  } else if (format.value === 'ledgerfy-json') {
    try {
      const parsed = JSON.parse(fileText.value) as {
        ledgers?: Array<Record<string, unknown>>
        items?: Array<Record<string, unknown>>
      }
      const ledgers = (parsed.ledgers ?? []).map((entry) => ({
        kind: 'Ledger' as const,
        name: String(entry.name ?? ''),
        group: String(entry.group ?? ''),
        amount: String(entry.openingBalance ?? ''),
        date: String(entry.openingDate ?? ''),
        extra: String(entry.type ?? ''),
      }))
      const items = (parsed.items ?? []).map((entry) => ({
        kind: 'Stock item' as const,
        name: String(entry.name ?? ''),
        group: String(entry.stockGroupId ?? ''),
        amount: String(entry.openingValue ?? ''),
        date: String(entry.createdAt ?? '').slice(0, 10),
        extra: String(entry.hsn ?? ''),
      }))
      records.value = [...ledgers, ...items]
    } catch {
      records.value = []
    }
  }
}

/** Re-read the CSV records after the user changes the column mapping. */
function onCsvMappingChange() {
  if (format.value !== 'csv') return
  records.value = []
  ensureRecords()
}

// ---------------------------------------------------------------------------
// Steps 4 to 6 — preview, validation, summary
// ---------------------------------------------------------------------------

const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)

const issues = computed<ValidationIssue[]>(() => {
  const result: ValidationIssue[] = []
  const seen = new Set<string>()

  records.value.forEach((record, index) => {
    const number = index + 1
    if (!record.name) {
      result.push({ recordNumber: number, severity: 'error', message: 'The name is missing.' })
    } else if (seen.has(record.name.toLowerCase())) {
      result.push({
        recordNumber: number,
        severity: 'warning',
        message: `"${record.name}" appears more than once in the source.`,
      })
    } else {
      seen.add(record.name.toLowerCase())
    }

    if (record.amount !== '' && !Number.isFinite(Number(record.amount))) {
      result.push({
        recordNumber: number,
        severity: 'error',
        message: `"${record.amount}" is not a number.`,
      })
    } else if (record.amount !== '' && Number(record.amount) < 0) {
      result.push({
        recordNumber: number,
        severity: 'warning',
        message: 'The amount is negative.',
      })
    }

    if (record.date !== '' && !isIsoDate(record.date)) {
      result.push({
        recordNumber: number,
        severity: 'error',
        message: `"${record.date}" is not a date in the yyyy-mm-dd form.`,
      })
    } else if (record.date !== '') {
      const year = session.financialYears.find(
        (candidate) => record.date >= candidate.start && record.date <= candidate.end,
      )
      if (!year) {
        result.push({
          recordNumber: number,
          severity: 'warning',
          message: 'The date falls outside every financial year of this company.',
        })
      }
    }

    if (record.kind === 'Ledger' && !record.group) {
      result.push({
        recordNumber: number,
        severity: 'warning',
        message: 'No account group was given, so the ledger would have to be placed by hand.',
      })
    }
  })

  return result
})

const errors = computed(() => issues.value.filter((issue) => issue.severity === 'error'))
const warnings = computed(() => issues.value.filter((issue) => issue.severity === 'warning'))
const cleanRecords = computed(() => records.value.length - new Set(errors.value.map((e) => e.recordNumber)).size)

// ---------------------------------------------------------------------------
// Step 8 — the reconciliation plan
// ---------------------------------------------------------------------------

const reconciliationPlan = computed(() => [
  {
    check: 'Ledger count',
    detail: 'Compare the number of ledgers in the source with the number of ledgers in the company.',
    expected: `${records.value.filter((record) => record.kind === 'Ledger').length} ledgers in the source`,
  },
  {
    check: 'Item count',
    detail: 'Compare the number of stock items in the source with the number of items in the company.',
    expected: `${records.value.filter((record) => record.kind === 'Stock item').length} items in the source`,
  },
  {
    check: 'Opening balances',
    detail: 'Recompute every ledger balance from its entries and compare it with the opening balance carried in.',
    expected: 'Every ledger must net to its opening balance plus its entries',
  },
  {
    check: 'Trial balance',
    detail: 'Run the trial balance after the import and confirm that debits equal credits.',
    expected: 'A net of zero',
  },
  {
    check: 'Duplicate names',
    detail: 'Look for source records that would land on a name already in use in the company.',
    expected: 'No two ledgers or items with the same name',
  },
])

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function goToStep(number: number) {
  if (number > step.value && number <= 6) ensureRecords()
  step.value = number
}

function next() {
  if (step.value === 2) ensureRecords()
  if (step.value < 9) step.value += 1
}

function back() {
  if (step.value > 1) step.value -= 1
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      title="Migration"
      subtitle="Bring masters in from another accounting package"
      icon="moving"
      :breadcrumb="[{ label: 'Data and tools', to: '/data/integrity' }, { label: 'Migration' }]"
    />

    <div class="min-h-0 flex-1 overflow-auto p-space-lg">
      <div class="grid grid-cols-1 items-start gap-space-md lg:grid-cols-4">
        <!-- Stepper -->
        <ol class="rounded-md bg-surface-container-lowest p-space-md shadow-sm" aria-label="Migration steps">
          <li v-for="item in STEPS" :key="item.number">
            <button
              type="button"
              class="flex w-full items-start gap-space-sm rounded-sm p-space-xs text-left transition-colors hover:bg-surface-container-low"
              :aria-current="step === item.number ? 'step' : undefined"
              @click="goToStep(item.number)"
            >
              <span
                class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                :class="
                  stepState(item.number) === 'done'
                    ? 'bg-secondary-container text-on-secondary-container'
                    : stepState(item.number) === 'current'
                      ? 'bg-primary text-on-primary'
                      : stepState(item.number) === 'blocked'
                        ? 'bg-surface-container-highest text-outline'
                        : 'bg-surface-container text-outline'
                "
              >
                <MaterialIcon
                  v-if="stepState(item.number) === 'done'"
                  name="check"
                  :size="12"
                />
                <MaterialIcon
                  v-else-if="stepState(item.number) === 'blocked'"
                  name="block"
                  :size="11"
                />
                <span v-else>{{ item.number }}</span>
              </span>
              <span class="min-w-0">
                <span
                  class="block text-label-sm font-semibold"
                  :class="step === item.number ? 'text-on-surface' : 'text-on-surface-variant'"
                >
                  {{ item.title }}
                </span>
                <span class="block text-label-xs text-outline">{{ item.note }}</span>
              </span>
            </button>
          </li>
        </ol>

        <!-- Step body -->
        <div class="space-y-space-md lg:col-span-3">
          <!-- Step 1 -->
          <section v-if="step === 1" class="rounded-md bg-surface-container-lowest p-space-md shadow-sm">
            <h2 class="text-headline-sm text-on-surface">Choose the file to migrate</h2>
            <p class="mt-0.5 text-label-sm text-outline">
              The file is read in this window. Nothing is written to the books by the migration
              wizard in this build.
            </p>

            <div class="mt-space-md grid grid-cols-1 gap-space-md md:grid-cols-2">
              <label
                class="flex cursor-pointer flex-col items-center gap-2 rounded-sm border border-dashed border-outline-variant bg-surface-container-low p-space-lg text-center"
              >
                <MaterialIcon name="upload_file" :size="26" class="text-primary" />
                <span class="text-body-md font-semibold text-on-surface">Choose a file</span>
                <span class="text-label-sm text-outline">.xml, .csv or .json</span>
                <input
                  type="file"
                  accept=".xml,.csv,.json,text/csv,application/xml,application/json"
                  class="sr-only"
                  aria-label="Choose the file to migrate"
                  @change="onFileChange"
                />
              </label>

              <div class="rounded-sm bg-surface-container-low p-space-md">
                <p class="section-label">Or start from something known</p>
                <div class="mt-space-xs space-y-2">
                  <BaseButton size="sm" variant="outlined" icon="receipt_long" block @click="loadTallySample">
                    Load the Tally XML sample
                  </BaseButton>
                  <BaseButton
                    size="sm"
                    variant="outlined"
                    icon="folder_open"
                    block
                    :disabled="!native"
                    @click="pickWithDesktopDialog"
                  >
                    Choose with the desktop dialog
                  </BaseButton>
                </div>
                <p class="mt-space-xs text-label-xs text-outline">
                  The sample is a small Tally-style XML envelope with three ledgers and two stock
                  items. It is parsed with the browser's own XML parser.
                </p>
              </div>
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

          <!-- Step 2 -->
          <section v-else-if="step === 2" class="rounded-md bg-surface-container-lowest p-space-md shadow-sm">
            <h2 class="text-headline-sm text-on-surface">What kind of file is this?</h2>

            <div v-if="fileName" class="mt-space-md rounded-sm bg-surface-container-low p-space-sm">
              <p class="text-body-sm font-semibold text-on-surface">{{ fileName }}</p>
              <p class="text-label-xs text-outline">{{ fileSize }} bytes</p>
            </div>

            <div v-if="fileName" class="mt-space-md space-y-space-sm">
              <div class="flex items-center justify-between gap-3">
                <span class="text-body-sm text-on-surface-variant">Detected format</span>
                <BaseBadge
                  :tone="format === 'unknown' ? 'danger' : 'positive'"
                  size="xs"
                  :icon="format === 'unknown' ? 'cancel' : 'verified'"
                >
                  {{ formatLabel }}
                </BaseBadge>
              </div>
              <p class="text-label-sm text-outline">{{ formatConfidence }}</p>
            </div>

            <div
              v-if="format === 'tally-xml'"
              class="mt-space-md flex items-start gap-space-sm rounded-sm border-l-4 border-l-tertiary bg-tertiary-fixed p-space-sm text-body-sm text-on-tertiary-fixed"
              role="status"
            >
              <MaterialIcon name="warning" :size="18" class="mt-0.5 shrink-0" />
              <p>
                Tally XML compatibility in this build is <strong>partial</strong>. Only
                <span class="font-mono">LEDGERNAME</span>,
                <span class="font-mono">STOCKITEMNAME</span>,
                <span class="font-mono">AMOUNT</span> and
                <span class="font-mono">DATE</span> are mapped, along with a few supporting
                elements. A real Tally export carries many more request types, and every one of
                them must be checked against a genuine sample file before this path is relied on.
              </p>
            </div>

            <BaseEmptyState
              v-else-if="!fileName"
              title="No file chosen"
              description="Go back to the first step and choose a file, or load the Tally XML sample."
              :icon="NoFileIcon"
            />
          </section>

          <!-- Step 3 -->
          <section v-else-if="step === 3" class="rounded-md bg-surface-container-lowest p-space-md shadow-sm">
            <h2 class="text-headline-sm text-on-surface">Map the fields</h2>
            <p class="mt-0.5 text-label-sm text-outline">
              What the source file carries, and where it lands in LedgerFy.
            </p>

            <div v-if="format === 'csv'" class="mt-space-md space-y-space-sm">
              <div
                v-for="target in CSV_TARGETS"
                :key="target.key"
                class="flex flex-wrap items-center justify-between gap-2 rounded-sm bg-surface-container-low p-space-sm"
              >
                <span class="text-body-sm font-semibold text-on-surface">{{ target.label }}</span>
                <label class="block w-56">
                  <span class="sr-only">Source column for {{ target.label }}</span>
                  <BaseSelect
                    v-model="csvMapping[target.key]"
                    size="sm"
                    :options="csvColumnOptions"
                    @update:model-value="onCsvMappingChange"
                  />
                </label>
              </div>
            </div>

            <div v-else-if="mappingRows.length" class="mt-space-md overflow-hidden rounded-sm border border-surface-container">
              <table class="w-full text-left text-body-sm">
                <thead class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline">
                  <tr>
                    <th scope="col" class="px-space-sm py-2">Source element</th>
                    <th scope="col" class="px-space-sm py-2">LedgerFy field</th>
                    <th scope="col" class="px-space-sm py-2">Status</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-surface-container-low">
                  <tr v-for="row in mappingRows" :key="row.source">
                    <td class="px-space-sm py-1.5 font-mono text-label-sm">{{ row.source }}</td>
                    <td class="px-space-sm py-1.5">{{ row.target }}</td>
                    <td class="px-space-sm py-1.5">
                      <BaseBadge v-if="row.recognised" tone="positive" size="xs" icon="check">
                        Found
                      </BaseBadge>
                      <BaseBadge v-else tone="neutral" size="xs" icon="remove">Not in the file</BaseBadge>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <BaseEmptyState
              v-else
              title="Nothing to map yet"
              description="Choose a file first, then the source fields are listed here."
              :icon="NoMappingIcon"
            />
          </section>

          <!-- Step 4 -->
          <section v-else-if="step === 4" class="rounded-md bg-surface-container-lowest p-space-md shadow-sm">
            <h2 class="text-headline-sm text-on-surface">Preview</h2>
            <p class="mt-0.5 text-label-sm text-outline">
              {{ records.length }} record{{ records.length === 1 ? '' : 's' }} read from
              {{ fileName || 'the file' }}.
            </p>

            <div v-if="records.length" class="mt-space-md overflow-hidden rounded-sm border border-surface-container">
              <table class="w-full text-left text-body-sm">
                <thead class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline">
                  <tr>
                    <th scope="col" class="px-space-sm py-2">#</th>
                    <th scope="col" class="px-space-sm py-2">Kind</th>
                    <th scope="col" class="px-space-sm py-2">Name</th>
                    <th scope="col" class="px-space-sm py-2">Group</th>
                    <th scope="col" class="px-space-sm py-2 text-right">Amount</th>
                    <th scope="col" class="px-space-sm py-2">Date</th>
                    <th scope="col" class="px-space-sm py-2">Also read</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-surface-container-low">
                  <tr v-for="(record, index) in records" :key="index">
                    <td class="px-space-sm py-1.5 tabular text-outline">{{ index + 1 }}</td>
                    <td class="px-space-sm py-1.5">
                      <BaseBadge tone="neutral" size="xs">{{ record.kind }}</BaseBadge>
                    </td>
                    <td class="px-space-sm py-1.5 font-semibold text-on-surface">
                      {{ record.name || '—' }}
                    </td>
                    <td class="px-space-sm py-1.5 text-on-surface-variant">{{ record.group || '—' }}</td>
                    <td class="px-space-sm py-1.5 text-right tabular">
                      {{ record.amount || '—' }}
                    </td>
                    <td class="px-space-sm py-1.5 tabular text-on-surface-variant">
                      {{ record.date || '—' }}
                    </td>
                    <td class="px-space-sm py-1.5 text-on-surface-variant">{{ record.extra || '—' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <BaseEmptyState
              v-else
              title="No records were read"
              description="The file held nothing this build recognises. Check the format on the previous step."
              :icon="NoRecordsIcon"
            />
          </section>

          <!-- Step 5 -->
          <section v-else-if="step === 5" class="rounded-md bg-surface-container-lowest p-space-md shadow-sm">
            <h2 class="text-headline-sm text-on-surface">Validation</h2>
            <p class="mt-0.5 text-label-sm text-outline">
              Every record is checked for a name, a number where a number is expected, and a date in
              the yyyy-mm-dd form.
            </p>

            <div class="mt-space-md flex flex-wrap items-center gap-2">
              <BaseBadge tone="positive" size="xs" icon="check_circle">
                {{ cleanRecords }} clean record{{ cleanRecords === 1 ? '' : 's' }}
              </BaseBadge>
              <BaseBadge :tone="errors.length ? 'danger' : 'neutral'" size="xs" icon="cancel">
                {{ errors.length }} error{{ errors.length === 1 ? '' : 's' }}
              </BaseBadge>
              <BaseBadge :tone="warnings.length ? 'warning' : 'neutral'" size="xs" icon="warning">
                {{ warnings.length }} warning{{ warnings.length === 1 ? '' : 's' }}
              </BaseBadge>
            </div>

            <ul v-if="issues.length" class="mt-space-md divide-y divide-surface-container-low rounded-sm border border-surface-container">
              <li
                v-for="(issue, index) in issues"
                :key="index"
                class="flex flex-wrap items-baseline gap-2 px-space-sm py-1.5"
              >
                <BaseBadge
                  :tone="issue.severity === 'error' ? 'danger' : 'warning'"
                  size="xs"
                  :icon="issue.severity === 'error' ? 'cancel' : 'warning'"
                >
                  {{ issue.severity === 'error' ? 'Error' : 'Warning' }}
                </BaseBadge>
                <span class="tabular text-label-sm font-semibold text-on-surface">
                  Record {{ issue.recordNumber }}
                </span>
                <span class="text-label-sm text-on-surface-variant">{{ issue.message }}</span>
              </li>
            </ul>

            <p v-else class="mt-space-md text-body-sm text-on-surface-variant">
              Every record passed the checks.
            </p>
          </section>

          <!-- Step 6 -->
          <section v-else-if="step === 6" class="rounded-md bg-surface-container-lowest p-space-md shadow-sm">
            <h2 class="text-headline-sm text-on-surface">Error and warning summary</h2>
            <p class="mt-0.5 text-label-sm text-outline">
              What would have to be settled before these records could be written to the books.
            </p>

            <div class="mt-space-md grid grid-cols-1 gap-space-md sm:grid-cols-2">
              <div class="rounded-sm bg-error-container/30 p-space-sm">
                <p class="flex items-center gap-1 text-label-md font-semibold text-on-error-container">
                  <MaterialIcon name="cancel" :size="15" />
                  Errors ({{ errors.length }})
                </p>
                <ul v-if="errors.length" class="mt-space-xs space-y-1 text-body-sm text-on-surface-variant">
                  <li v-for="(issue, index) in errors" :key="index">
                    Record {{ issue.recordNumber }}: {{ issue.message }}
                  </li>
                </ul>
                <p v-else class="mt-space-xs text-body-sm text-on-surface-variant">
                  No errors. Every record can be read as it stands.
                </p>
              </div>

              <div class="rounded-sm bg-tertiary-fixed/40 p-space-sm">
                <p class="flex items-center gap-1 text-label-md font-semibold text-on-tertiary-fixed">
                  <MaterialIcon name="warning" :size="15" />
                  Warnings ({{ warnings.length }})
                </p>
                <ul v-if="warnings.length" class="mt-space-xs space-y-1 text-body-sm text-on-surface-variant">
                  <li v-for="(issue, index) in warnings" :key="index">
                    Record {{ issue.recordNumber }}: {{ issue.message }}
                  </li>
                </ul>
                <p v-else class="mt-space-xs text-body-sm text-on-surface-variant">
                  No warnings. Nothing needs a decision before the import.
                </p>
              </div>
            </div>
          </section>

          <!-- Step 7 -->
          <section v-else-if="step === 7" class="rounded-md bg-surface-container-lowest p-space-md shadow-sm">
            <h2 class="text-headline-sm text-on-surface">Import execution</h2>

            <div
              class="mt-space-md flex items-start gap-space-sm rounded-sm border-l-4 border-l-tertiary bg-tertiary-fixed p-space-sm text-body-sm text-on-tertiary-fixed"
              role="status"
            >
              <MaterialIcon name="block" :size="18" class="mt-0.5 shrink-0" />
              <p>
                Writing the source records into the books is <strong>not implemented in this
                build</strong>. The wizard reads, maps, previews and checks a file, and then stops
                there. Nothing has been written to
                {{ session.activeCompany?.name ?? 'the company' }}.
              </p>
            </div>

            <div class="mt-space-md rounded-sm bg-surface-container-low p-space-sm">
              <p class="section-label">What would run when it is implemented</p>
              <ul class="mt-space-xs space-y-1 text-body-sm text-on-surface-variant">
                <li>Create or match a ledger for every source ledger, by name and group</li>
                <li>Create or match a stock item for every source item, with its unit and group</li>
                <li>Write the opening balance carried in the source, in paise</li>
                <li>Write an audit event for every record that was created or changed</li>
                <li>Refuse the import if a record fails a check, and say which one</li>
              </ul>
            </div>

            <BaseButton size="sm" variant="neutral" icon="block" class="mt-space-md" disabled>
              Import into the books
            </BaseButton>
          </section>

          <!-- Step 8 -->
          <section v-else-if="step === 8" class="rounded-md bg-surface-container-lowest p-space-md shadow-sm">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h2 class="text-headline-sm text-on-surface">Reconciliation</h2>
              <BaseBadge tone="warning" size="xs" icon="science">Plan, not a result</BaseBadge>
            </div>
            <p class="mt-0.5 text-label-sm text-outline">
              The checks below are the plan for the reconciliation that follows an import. They have
              <strong>not been run</strong>, because no import has taken place.
            </p>

            <ul class="mt-space-md divide-y divide-surface-container-low rounded-sm border border-surface-container">
              <li
                v-for="item in reconciliationPlan"
                :key="item.check"
                class="flex flex-wrap items-start justify-between gap-2 px-space-sm py-2"
              >
                <span class="min-w-0">
                  <span class="block text-body-sm font-semibold text-on-surface">{{ item.check }}</span>
                  <span class="block text-label-sm text-outline">{{ item.detail }}</span>
                </span>
                <span class="shrink-0 text-label-xs text-on-surface-variant">{{ item.expected }}</span>
              </li>
            </ul>
          </section>

          <!-- Step 9 -->
          <section v-else class="rounded-md bg-surface-container-lowest p-space-md shadow-sm">
            <h2 class="text-headline-sm text-on-surface">Completion summary</h2>

            <div class="mt-space-md grid grid-cols-1 gap-space-md sm:grid-cols-3">
              <div class="rounded-sm bg-surface-container-low p-space-sm">
                <span class="section-label">File</span>
                <p class="mt-0.5 break-all text-body-sm text-on-surface">{{ fileName || 'None' }}</p>
                <p class="text-label-xs text-outline">{{ formatLabel }}</p>
              </div>
              <div class="rounded-sm bg-surface-container-low p-space-sm">
                <span class="section-label">Records read</span>
                <p class="mt-0.5 text-headline-lg text-on-surface">{{ records.length }}</p>
                <p class="text-label-xs text-outline">
                  {{ cleanRecords }} without an error
                </p>
              </div>
              <div class="rounded-sm bg-surface-container-low p-space-sm">
                <span class="section-label">Records written</span>
                <p class="mt-0.5 text-headline-lg text-on-surface">0</p>
                <p class="text-label-xs text-outline">
                  The import is not implemented in this build
                </p>
              </div>
            </div>

            <p class="mt-space-md text-body-sm text-on-surface-variant">
              The file was read and checked. No master, no voucher and no opening balance was
              changed in
              {{ session.activeCompany?.name ?? 'the company' }}. Run the migration again once
              import execution ships, and the reconciliation plan on the previous step becomes the
              real reconciliation.
            </p>

            <div class="mt-space-md flex flex-wrap gap-2">
              <BaseButton size="sm" variant="outlined" icon="restart_alt" @click="reset(); step = 1">
                Start over
              </BaseButton>
              <BaseButton size="sm" variant="text" icon="fact_check" @click="step = 6">
                Back to the summary
              </BaseButton>
            </div>
          </section>

          <!-- Step navigation -->
          <div class="flex items-center justify-between gap-2">
            <BaseButton size="sm" variant="text" icon="arrow_back" :disabled="step === 1" @click="back">
              Back
            </BaseButton>
            <p class="text-label-xs text-outline">Step {{ step }} of 9</p>
            <BaseButton
              size="sm"
              variant="primary"
              icon="arrow_forward"
              :disabled="step === 9"
              @click="next"
            >
              Next
            </BaseButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
