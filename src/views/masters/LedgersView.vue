<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseDrawer from '@/components/ui/BaseDrawer.vue'
import BaseEmptyState from '@/components/ui/BaseEmptyState.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseNumberInput from '@/components/ui/BaseNumberInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import DataTable from '@/components/ui/DataTable.vue'
import type { TableColumn } from '@/components/ui/DataTable.vue'
import FilterBar from '@/components/ui/FilterBar.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import StatTile from '@/components/ui/StatTile.vue'
import { ACCOUNT_GROUP_LABELS } from '@/app/labels'
import { balanceSheet, computeLedgerBalances, ledgerClosingBalance } from '@/domain/accounting'
import type {
  AccountGroup,
  AccountType,
  Ledger,
  PartyKind,
  Voucher,
  VoucherEntry,
} from '@/domain/types'
import { formatDate, todayIso } from '@/lib/datetime'
import { formatMoney, toMinor } from '@/lib/money'
import { useSessionStore } from '@/stores/session'
import { useToastStore } from '@/stores/toast'

const session = useSessionStore()
const toast = useToastStore()

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const periodVouchers = ref<Voucher[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

const search = ref('')
const groupFilter = ref<string>('all')

const currency = computed(() => session.activeCompany?.baseCurrency ?? 'INR')
const period = computed(() => session.activePeriod)

async function load() {
  const companyId = session.activeCompanyId
  if (!companyId) {
    periodVouchers.value = []
    loading.value = false
    return
  }
  loading.value = true
  error.value = null
  try {
    periodVouchers.value = await session.repository.listVouchers(companyId, {
      from: period.value.from,
      to: period.value.to,
      status: 'posted',
    })
  } catch (cause) {
    error.value =
      cause instanceof Error ? cause.message : 'The chart of accounts could not be loaded.'
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  if (!session.ready && !session.loading) await session.bootstrap()
  await load()
})
watch(() => [session.activeCompanyId, session.activeYearId], load)

// ---------------------------------------------------------------------------
// Ledger balances
// ---------------------------------------------------------------------------

/** Opening balance plus every posted entry of the active period. */
const balances = computed(() =>
  computeLedgerBalances(session.ledgers, periodVouchers.value, {
    from: period.value.from,
    to: period.value.to,
  }),
)

const sheet = computed(() =>
  balanceSheet(session.ledgers, periodVouchers.value, { asOf: period.value.to }),
)

type LedgerRow = {
  id: string
  name: string
  group: AccountGroup
  groupLabel: string
  type: AccountType
  typeLabel: string
  partyKind: PartyKind
  partyLabel: string
  opening: number
  closing: number
  isSystem: boolean
  isActive: boolean
}

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  capital: 'Capital',
  bank: 'Bank',
  cash: 'Cash',
  receivable: 'Receivable',
  payable: 'Payable',
  inventory: 'Inventory',
  'work-in-progress': 'Work in progress',
  'current-assets': 'Current assets',
  'fixed-assets': 'Fixed assets',
  'current-liabilities': 'Current liabilities',
  sales: 'Sales',
  purchase: 'Purchase',
  expenses: 'Expenses',
  tax: 'Tax',
  contra: 'Contra',
}

const PARTY_KIND_LABELS: Record<string, string> = {
  customer: 'Customer',
  supplier: 'Supplier',
  both: 'Customer and supplier',
}

const ledgerRows = computed<LedgerRow[]>(() =>
  balances.value
    .map((balance) => ({
      id: balance.ledger.id,
      name: balance.ledger.name,
      group: balance.ledger.group,
      groupLabel: ACCOUNT_GROUP_LABELS[balance.ledger.group],
      type: balance.ledger.type,
      typeLabel: ACCOUNT_TYPE_LABELS[balance.ledger.type] ?? balance.ledger.type,
      partyKind: balance.ledger.partyKind,
      partyLabel: balance.ledger.partyKind
        ? (PARTY_KIND_LABELS[balance.ledger.partyKind] ?? balance.ledger.partyKind)
        : 'Not a party',
      opening: balance.ledger.openingBalance,
      closing: balance.closing,
      isSystem: balance.ledger.isSystem,
      isActive: balance.ledger.isActive,
    }))
    .sort((left, right) => left.name.localeCompare(right.name)),
)

const groupOptions = computed(() => [
  { value: 'all', label: 'All groups' },
  ...(Object.keys(ACCOUNT_GROUP_LABELS) as AccountGroup[]).map((group) => ({
    value: group,
    label: ACCOUNT_GROUP_LABELS[group],
  })),
])

const visibleRows = computed(() => {
  const needle = search.value.trim().toLowerCase()
  return ledgerRows.value.filter((row) => {
    if (groupFilter.value !== 'all' && row.group !== groupFilter.value) return false
    if (!needle) return true
    return (
      row.name.toLowerCase().includes(needle) ||
      row.typeLabel.toLowerCase().includes(needle) ||
      row.groupLabel.toLowerCase().includes(needle)
    )
  })
})

const systemLedgerCount = computed(() => ledgerRows.value.filter((row) => row.isSystem).length)
const inactiveCount = computed(() => ledgerRows.value.filter((row) => !row.isActive).length)

const columns: TableColumn[] = [
  { key: 'name', label: 'Ledger', sortable: true },
  { key: 'groupLabel', label: 'Group', sortable: true },
  { key: 'typeLabel', label: 'Type', sortable: true },
  { key: 'partyLabel', label: 'Party kind' },
  { key: 'opening', label: 'Opening', align: 'right', numeric: true },
  { key: 'closing', label: 'Closing', align: 'right', numeric: true, sortable: true },
  { key: 'isSystem', label: 'System', align: 'center' },
  { key: 'isActive', label: 'State', align: 'center' },
  { key: 'actions', label: '', align: 'right', width: '96px' },
]

// ---------------------------------------------------------------------------
// Ledger statement drawer
// ---------------------------------------------------------------------------

const selectedLedger = ref<Ledger | null>(null)
const drawerOpen = ref(false)

type StatementRow = {
  id: string
  date: string
  number: string
  type: string
  narration: string
  debit: number
  credit: number
  balance: number
}

const statementRows = computed<StatementRow[]>(() => {
  const ledger = selectedLedger.value
  if (!ledger) return []

  const collected: Array<{ entry: VoucherEntry; date: string; number: string; type: string; narration: string }> = []
  for (const voucher of periodVouchers.value) {
    const entry = voucher.entries.find((candidate) => candidate.ledgerId === ledger.id)
    if (!entry) continue
    collected.push({
      entry,
      date: voucher.date,
      number: voucher.number,
      type: voucher.type,
      narration: entry.narration || voucher.narration || '—',
    })
  }

  collected.sort((left, right) =>
    left.date === right.date
      ? left.number.localeCompare(right.number)
      : left.date < right.date
        ? -1
        : 1,
  )

  let running = ledger.openingBalance
  return collected.map((item) => {
    running += item.entry.debit - item.entry.credit
    return {
      id: item.entry.id,
      date: item.date,
      number: item.number,
      type: item.type,
      narration: item.narration,
      debit: item.entry.debit,
      credit: item.entry.credit,
      balance: running,
    }
  })
})

const statementTotals = computed(() => {
  const ledger = selectedLedger.value
  if (!ledger) return { closing: 0, debitTotal: 0, creditTotal: 0 }
  const entries = statementRows.value.map((row) => ({
    id: row.id,
    ledgerId: ledger.id,
    debit: row.debit,
    credit: row.credit,
  }))
  return ledgerClosingBalance(ledger, entries)
})

function openLedger(row: LedgerRow) {
  selectedLedger.value = session.ledgers.find((ledger) => ledger.id === row.id) ?? null
  drawerOpen.value = true
}

// ---------------------------------------------------------------------------
// Create and deactivate
// ---------------------------------------------------------------------------

const ACCOUNT_TYPE_VALUES = Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]
const ACCOUNT_GROUP_VALUES = Object.keys(ACCOUNT_GROUP_LABELS) as AccountGroup[]

const createOpen = ref(false)
const saving = ref(false)
const formError = ref<string | null>(null)
const fieldErrors = ref<Record<string, string>>({})

const form = ref({
  name: '',
  group: '' as AccountGroup | '',
  type: '' as AccountType | '',
  openingBalance: '',
  partyKind: '' as PartyKind | '',
  currency: '',
  taxNumber: '',
  email: '',
  phone: '',
  address: '',
})

const typeOptions = computed(() =>
  ACCOUNT_TYPE_VALUES.map((type) => ({ value: type, label: ACCOUNT_TYPE_LABELS[type] })),
)

const createGroupOptions = computed(() =>
  ACCOUNT_GROUP_VALUES.map((group) => ({ value: group, label: ACCOUNT_GROUP_LABELS[group] })),
)

const partyKindOptions = [
  { value: '', label: 'Not a party' },
  { value: 'customer', label: 'Customer' },
  { value: 'supplier', label: 'Supplier' },
  { value: 'both', label: 'Customer and supplier' },
]

const currencyOptions = computed(() => [
  { value: '', label: 'Company currency' },
  ...session.currencies.map((entry) => ({ value: entry.code, label: `${entry.code} — ${entry.name}` })),
])

function resetForm() {
  form.value = {
    name: '',
    group: '',
    type: '',
    openingBalance: '',
    partyKind: '',
    currency: currency.value,
    taxNumber: '',
    email: '',
    phone: '',
    address: '',
  }
  fieldErrors.value = {}
  formError.value = null
}

function openCreate() {
  resetForm()
  createOpen.value = true
}

function validateForm(): boolean {
  const errors: Record<string, string> = {}
  const name = form.value.name.trim()
  if (!name) errors.name = 'A ledger name is required.'
  else if (
    session.ledgers.some(
      (ledger) => ledger.name.trim().toLowerCase() === name.toLowerCase(),
    )
  ) {
    errors.name = 'A ledger with this name already exists.'
  }
  if (!form.value.group) errors.group = 'Choose an account group.'
  if (!form.value.type) errors.type = 'Choose an account type.'
  if (form.value.email && !/^\S+@\S+\.\S+$/.test(form.value.email.trim())) {
    errors.email = 'Enter a valid email address.'
  }
  fieldErrors.value = errors
  return Object.keys(errors).length === 0
}

async function saveLedger() {
  const companyId = session.activeCompanyId
  if (!companyId) return
  if (!validateForm()) return

  saving.value = true
  formError.value = null
  try {
    const partyKind: PartyKind | null = form.value.partyKind || null
    const ledger: Ledger = {
      id: `led-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      companyId,
      name: form.value.name.trim(),
      group: form.value.group as AccountGroup,
      type: form.value.type as AccountType,
      parentId: null,
      openingBalance: toMinor(form.value.openingBalance || '0'),
      openingDate: session.activeFinancialYear?.start ?? todayIso(),
      partyKind,
      currency: form.value.currency || currency.value,
      taxNumber: form.value.taxNumber.trim() || undefined,
      email: form.value.email.trim() || undefined,
      phone: form.value.phone.trim() || undefined,
      address: form.value.address.trim() || undefined,
      isSystem: false,
      isActive: true,
      createdAt: new Date().toISOString(),
    }

    await session.repository.saveLedger(ledger)
    await session.loadMasters(companyId)
    createOpen.value = false
    toast.success('Ledger created', `${ledger.name} was added to the chart of accounts.`)
  } catch (cause) {
    formError.value =
      cause instanceof Error ? cause.message : 'The ledger could not be saved. Try again.'
  } finally {
    saving.value = false
  }
}

// Deactivation — records are never permanently deleted.
const deactivateTarget = ref<Ledger | null>(null)
const deactivateOpen = ref(false)
const deactivateSaving = ref(false)

function askDeactivate(row: LedgerRow) {
  deactivateTarget.value = session.ledgers.find((ledger) => ledger.id === row.id) ?? null
  deactivateOpen.value = true
}

async function confirmDeactivate() {
  const companyId = session.activeCompanyId
  const ledger = deactivateTarget.value
  if (!companyId || !ledger) return
  deactivateSaving.value = true
  try {
    await session.repository.saveLedger({ ...ledger, isActive: false })
    await session.loadMasters(companyId)
    deactivateOpen.value = false
    deactivateTarget.value = null
    toast.info(
      'Ledger deactivated',
      `${ledger.name} was deactivated. Its posted vouchers are kept and it can be reactivated.`,
    )
  } catch (cause) {
    toast.error(
      'Ledger could not be deactivated',
      cause instanceof Error ? cause.message : 'Try again.',
    )
  } finally {
    deactivateSaving.value = false
  }
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      title="Chart of accounts"
      subtitle="Every ledger, its group and its balance for the active period"
      icon="account_balance"
    >
      <template #actions>
        <BaseButton size="sm" variant="primary" icon="add" @click="openCreate">
          New ledger
        </BaseButton>
      </template>
    </PageHeader>

    <FilterBar>
      <BaseInput
        v-model="search"
        label="Search"
        placeholder="Search ledgers"
        type="search"
        size="sm"
        class="w-56"
      />
      <BaseSelect
        v-model="groupFilter"
        label="Group"
        :options="groupOptions"
        size="sm"
        class="w-48"
      />
      <template #trailing>
        <span class="text-label-sm text-outline">
          {{ visibleRows.length }} of {{ ledgerRows.length }} ledgers ·
          {{ formatDate(period.from) }} to {{ formatDate(period.to) }}
        </span>
      </template>
    </FilterBar>

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
        <p class="font-semibold">The chart of accounts could not be loaded</p>
        <p class="mt-0.5">{{ error }}</p>
      </div>

      <template v-else>
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Ledgers"
            :value="String(ledgerRows.length)"
            icon="account_balance"
            hint="Active and inactive ledgers in this company"
          />
          <StatTile
            label="Total assets"
            :value="formatMoney(sheet.assets, currency)"
            icon="savings"
            tone="info"
            hint="Closing balance of every asset ledger"
          />
          <StatTile
            label="Total liabilities"
            :value="formatMoney(sheet.liabilities, currency)"
            icon="credit_card"
            hint="Closing balance of every liability ledger"
          />
          <StatTile
            label="System ledgers"
            :value="String(systemLedgerCount)"
            icon="lock"
            :tone="systemLedgerCount ? 'warning' : 'default'"
            :hint="`${inactiveCount} inactive · system ledgers cannot be deleted`"
          />
        </div>

        <section
          class="mt-space-md overflow-hidden rounded-md bg-surface-container-lowest shadow-sm"
        >
          <header class="flex flex-wrap items-center justify-between gap-3 px-space-md py-space-sm">
            <div class="flex items-center gap-space-sm">
              <MaterialIcon name="table_view" :size="20" class="text-primary" />
              <h2 class="text-headline-sm text-on-surface">Ledger list</h2>
            </div>
            <span class="text-label-xs text-outline">
              Click a row to open the ledger statement
            </span>
          </header>

          <DataTable
            v-if="visibleRows.length"
            :columns="columns"
            :rows="visibleRows"
            row-key="id"
            empty-title="No ledgers match"
            empty-description="Change the search term or the group filter."
            @row-click="openLedger"
          >
            <template #cell:name="{ row }">
              <span class="flex items-center gap-1.5 font-medium text-on-surface">
                <MaterialIcon
                  v-if="row.isSystem"
                  name="lock"
                  :size="14"
                  label="System ledger"
                />
                {{ row.name }}
              </span>
            </template>
            <template #cell:opening="{ row }">
              {{ formatMoney(row.opening, currency) }}
            </template>
            <template #cell:closing="{ row }">
              <span class="font-bold" :class="row.closing < 0 ? 'text-tertiary' : ''">
                {{ formatMoney(row.closing, currency) }}
              </span>
            </template>
            <template #cell:isSystem="{ row }">
              <BaseBadge v-if="row.isSystem" tone="neutral" size="xs" icon="lock">
                System
              </BaseBadge>
              <span v-else class="text-label-sm text-outline">—</span>
            </template>
            <template #cell:isActive="{ row }">
              <BaseBadge
                :tone="row.isActive ? 'positive' : 'warning'"
                size="xs"
                :icon="row.isActive ? 'check_circle' : 'pause_circle'"
              >
                {{ row.isActive ? 'Active' : 'Inactive' }}
              </BaseBadge>
            </template>
            <template #cell:actions="{ row }">
              <BaseButton
                v-if="!row.isSystem"
                size="xs"
                variant="outlined"
                icon="pause_circle"
                :aria-label="`Deactivate ${row.name}`"
                :title="`Deactivate ${row.name}`"
                @click.stop="askDeactivate(row)"
              >
                Deactivate
              </BaseButton>
              <span v-else class="text-label-xs text-outline" :title="`${row.name} is a system ledger and cannot be deleted.`">
                Locked
              </span>
            </template>
          </DataTable>

          <BaseEmptyState
            v-else
            title="No ledgers match"
            description="Change the search term or the group filter, or create a new ledger."
            :icon="MaterialIcon"
          >
            <BaseButton size="sm" variant="primary" icon="add" @click="openCreate">
              New ledger
            </BaseButton>
          </BaseEmptyState>

          <footer
            class="border-t border-surface-container bg-surface-container-low/60 px-space-md py-space-sm text-label-xs text-outline"
          >
            Closing balance is the opening balance plus every posted entry of the active period.
            Drafts and cancelled vouchers are excluded.
          </footer>
        </section>
      </template>
    </div>

    <!-- Ledger statement -->
    <BaseDrawer
      :open="drawerOpen"
      :title="selectedLedger?.name ?? 'Ledger'"
      :description="
        selectedLedger
          ? `${ACCOUNT_GROUP_LABELS[selectedLedger.group]} · ${ACCOUNT_TYPE_LABELS[selectedLedger.type]}`
          : ''
      "
      width="560px"
      @close="drawerOpen = false"
    >
      <div v-if="statementRows.length" class="space-y-space-sm">
        <table class="w-full text-left text-body-sm">
          <thead class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline">
            <tr>
              <th scope="col" class="px-space-sm py-2">Date</th>
              <th scope="col" class="px-space-sm py-2">Voucher</th>
              <th scope="col" class="px-space-sm py-2">Narration</th>
              <th scope="col" class="px-space-sm py-2 text-right">Debit</th>
              <th scope="col" class="px-space-sm py-2 text-right">Credit</th>
              <th scope="col" class="px-space-sm py-2 text-right">Balance</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-surface-container-low">
            <tr v-for="row in statementRows" :key="row.id">
              <td class="whitespace-nowrap px-space-sm py-1.5 text-numeric-sm tabular text-outline">
                {{ formatDate(row.date) }}
              </td>
              <td class="px-space-sm py-1.5 text-numeric-sm font-semibold text-on-surface">
                {{ row.number }}
              </td>
              <td class="max-w-[160px] truncate px-space-sm py-1.5 text-on-surface-variant">
                {{ row.narration }}
              </td>
              <td class="px-space-sm py-1.5 text-right text-numeric-sm tabular text-on-surface-variant">
                {{ formatMoney(row.debit, currency, { blankZero: true }) || '—' }}
              </td>
              <td class="px-space-sm py-1.5 text-right text-numeric-sm tabular text-on-surface-variant">
                {{ formatMoney(row.credit, currency, { blankZero: true }) || '—' }}
              </td>
              <td
                class="px-space-sm py-1.5 text-right text-numeric-sm font-bold tabular"
                :class="row.balance < 0 ? 'text-tertiary' : 'text-on-surface'"
              >
                {{ formatMoney(row.balance, currency) }}
              </td>
            </tr>
          </tbody>
          <tfoot class="bg-surface-container-low/60">
            <tr class="text-numeric-sm font-bold">
              <td class="px-space-sm py-2 text-on-surface" colspan="3">Total</td>
              <td class="px-space-sm py-2 text-right tabular text-on-surface-variant">
                {{ formatMoney(statementTotals.debitTotal, currency) }}
              </td>
              <td class="px-space-sm py-2 text-right tabular text-on-surface-variant">
                {{ formatMoney(statementTotals.creditTotal, currency) }}
              </td>
              <td class="px-space-sm py-2 text-right tabular text-on-surface">
                {{ formatMoney(statementTotals.closing, currency) }}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <BaseEmptyState
        v-else
        size="sm"
        title="No entries in this period"
        description="This ledger has no posted entry between the start and the end of the active period."
        :icon="MaterialIcon"
      />
    </BaseDrawer>

    <!-- New ledger -->
    <BaseModal
      :open="createOpen"
      title="New ledger"
      description="A ledger is a head in the chart of accounts. Posted vouchers flow into it."
      size="md"
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

        <BaseInput
          v-model="form.name"
          label="Ledger name"
          required
          placeholder="e.g. Sundaram Traders"
          :error="fieldErrors.name"
        />

        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2">
          <BaseSelect
            v-model="form.group"
            label="Account group"
            required
            :options="createGroupOptions"
            :error="fieldErrors.group"
          />
          <BaseSelect
            v-model="form.type"
            label="Account type"
            required
            :options="typeOptions"
            :error="fieldErrors.type"
          />
        </div>

        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2">
          <BaseNumberInput
            v-model="form.openingBalance"
            label="Opening balance"
            :currency="currency"
            placeholder="0.00"
            hint="Debit positive, credit negative."
          />
          <BaseSelect
            v-model="form.partyKind"
            label="Party kind"
            :options="partyKindOptions"
          />
        </div>

        <BaseSelect
          v-model="form.currency"
          label="Currency"
          :options="currencyOptions"
        />

        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2">
          <BaseInput
            v-model="form.taxNumber"
            label="GSTIN / tax number"
            placeholder="Optional"
          />
          <BaseInput v-model="form.phone" label="Phone" placeholder="Optional" />
        </div>

        <BaseInput
          v-model="form.email"
          label="Email"
          type="email"
          placeholder="Optional"
          :error="fieldErrors.email"
        />

        <BaseInput v-model="form.address" label="Address" placeholder="Optional" />
      </div>

      <template #footer>
        <BaseButton size="sm" variant="text" @click="createOpen = false">Cancel</BaseButton>
        <BaseButton size="sm" variant="primary" icon="save" :loading="saving" @click="saveLedger">
          Save ledger
        </BaseButton>
      </template>
    </BaseModal>

    <!-- Deactivate confirmation -->
    <BaseModal
      :open="deactivateOpen"
      title="Deactivate ledger"
      description="A ledger with posted vouchers is never permanently deleted."
      size="sm"
      @close="deactivateOpen = false"
    >
      <p class="pt-space-xs text-body-md text-on-surface-variant">
        <span class="font-semibold text-on-surface">{{ deactivateTarget?.name }}</span> will stop
        appearing in new vouchers. Its posted vouchers and balances stay in the books, and the
        ledger can be reactivated later.
      </p>

      <template #footer>
        <BaseButton size="sm" variant="text" @click="deactivateOpen = false">Cancel</BaseButton>
        <BaseButton
          size="sm"
          variant="danger"
          icon="pause_circle"
          :loading="deactivateSaving"
          @click="confirmDeactivate"
        >
          Deactivate
        </BaseButton>
      </template>
    </BaseModal>
  </div>
</template>
