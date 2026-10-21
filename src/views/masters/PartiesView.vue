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
import BaseTabs from '@/components/ui/BaseTabs.vue'
import DataTable from '@/components/ui/DataTable.vue'
import type { TableColumn } from '@/components/ui/DataTable.vue'
import FilterBar from '@/components/ui/FilterBar.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import StatTile from '@/components/ui/StatTile.vue'
import { allocateOutstanding } from '@/domain/accounting'
import type { Allocation } from '@/domain/accounting'
import type { Ledger, PartyKind, Voucher, VoucherEntry } from '@/domain/types'
import { formatDate } from '@/lib/datetime'
import { formatMoney, toMinor } from '@/lib/money'
import { useSessionStore } from '@/stores/session'
import { useToastStore } from '@/stores/toast'

const session = useSessionStore()
const toast = useToastStore()

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

/** Every posted voucher, so receipts and payments are allocated correctly. */
const allVouchers = ref<Voucher[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

const search = ref('')
const tab = ref('all')

const currency = computed(() => session.activeCompany?.baseCurrency ?? 'INR')
const period = computed(() => session.activePeriod)

async function load() {
  const companyId = session.activeCompanyId
  if (!companyId) {
    allVouchers.value = []
    loading.value = false
    return
  }
  loading.value = true
  error.value = null
  try {
    allVouchers.value = await session.repository.listVouchers(companyId, { status: 'posted' })
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'The party list could not be loaded.'
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
// Outstanding allocation
// ---------------------------------------------------------------------------

const allocations = computed<Allocation[]>(() =>
  allocateOutstanding(allVouchers.value, session.ledgers, { asOf: period.value.to }),
)

const outstandingByParty = computed(() => {
  const map = new Map<string, number>()
  for (const allocation of allocations.value) {
    if (allocation.outstanding <= 0) continue
    map.set(allocation.partyId, (map.get(allocation.partyId) ?? 0) + allocation.outstanding)
  }
  return map
})

const lastTransactionByParty = computed(() => {
  const map = new Map<string, string>()
  for (const voucher of allVouchers.value) {
    if (!voucher.partyId) continue
    const current = map.get(voucher.partyId)
    if (!current || voucher.date > current) map.set(voucher.partyId, voucher.date)
  }
  return map
})

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

type PartyRow = {
  id: string
  name: string
  kind: PartyKind
  kindLabel: string
  taxNumber: string
  phone: string
  email: string
  address: string
  outstanding: number
  lastTransaction: string
  isActive: boolean
}

const PARTY_KIND_LABELS: Record<string, string> = {
  customer: 'Customer',
  supplier: 'Supplier',
  both: 'Customer and supplier',
}

const partyRows = computed<PartyRow[]>(() =>
  session.partyLedgers
    .map((ledger) => ({
      id: ledger.id,
      name: ledger.name,
      kind: ledger.partyKind,
      kindLabel: ledger.partyKind
        ? (PARTY_KIND_LABELS[ledger.partyKind] ?? ledger.partyKind)
        : 'Not a party',
      taxNumber: ledger.taxNumber ?? '',
      phone: ledger.phone ?? '',
      email: ledger.email ?? '',
      address: ledger.address ?? '',
      outstanding: outstandingByParty.value.get(ledger.id) ?? 0,
      lastTransaction: lastTransactionByParty.value.get(ledger.id) ?? '',
      isActive: ledger.isActive,
    }))
    .sort((left, right) => left.name.localeCompare(right.name)),
)

const customerRows = computed(() =>
  partyRows.value.filter(
    (row) => row.kind === 'customer' || row.kind === 'both',
  ),
)

const supplierRows = computed(() =>
  partyRows.value.filter(
    (row) => row.kind === 'supplier' || row.kind === 'both',
  ),
)

const tabs = computed(() => [
  { value: 'all', label: 'All', count: partyRows.value.length, icon: 'groups' },
  { value: 'customers', label: 'Customers', count: customerRows.value.length, icon: 'person' },
  { value: 'suppliers', label: 'Suppliers', count: supplierRows.value.length, icon: 'local_shipping' },
])

const visibleRows = computed(() => {
  const scoped =
    tab.value === 'customers'
      ? customerRows.value
      : tab.value === 'suppliers'
        ? supplierRows.value
        : partyRows.value
  const needle = search.value.trim().toLowerCase()
  if (!needle) return scoped
  return scoped.filter(
    (row) =>
      row.name.toLowerCase().includes(needle) ||
      row.taxNumber.toLowerCase().includes(needle) ||
      row.email.toLowerCase().includes(needle) ||
      row.phone.toLowerCase().includes(needle),
  )
})

const receivableTotal = computed(() =>
  customerRows.value.reduce((sum, row) => sum + row.outstanding, 0),
)

const payableTotal = computed(() =>
  supplierRows.value.reduce((sum, row) => sum + row.outstanding, 0),
)

const columns: TableColumn[] = [
  { key: 'name', label: 'Party', sortable: true },
  { key: 'kindLabel', label: 'Kind', sortable: true },
  { key: 'taxNumber', label: 'GSTIN' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'outstanding', label: 'Outstanding', align: 'right', numeric: true, sortable: true },
  { key: 'lastTransaction', label: 'Last transaction', sortable: true },
  { key: 'isActive', label: 'State', align: 'center' },
]

// ---------------------------------------------------------------------------
// Party drawer
// ---------------------------------------------------------------------------

const selectedParty = ref<Ledger | null>(null)
const drawerOpen = ref(false)

type StatementRow = {
  id: string
  date: string
  number: string
  narration: string
  debit: number
  credit: number
  balance: number
}

const statementRows = computed<StatementRow[]>(() => {
  const party = selectedParty.value
  if (!party) return []

  const collected: Array<{
    entry: VoucherEntry
    date: string
    number: string
    narration: string
  }> = []

  for (const voucher of allVouchers.value) {
    if (voucher.date > period.value.to) continue
    const entry = voucher.entries.find((candidate) => candidate.ledgerId === party.id)
    if (!entry) continue
    collected.push({
      entry,
      date: voucher.date,
      number: voucher.number,
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

  let running = party.openingBalance
  return collected.map((item) => {
    running += item.entry.debit - item.entry.credit
    return {
      id: item.entry.id,
      date: item.date,
      number: item.number,
      narration: item.narration,
      debit: item.entry.debit,
      credit: item.entry.credit,
      balance: running,
    }
  })
})

const openInvoices = computed<Allocation[]>(() =>
  allocations.value
    .filter(
      (allocation) =>
        allocation.partyId === selectedParty.value?.id && allocation.outstanding > 0,
    )
    .sort((left, right) => (left.dueDate < right.dueDate ? -1 : 1)),
)

const openInvoiceTotal = computed(() =>
  openInvoices.value.reduce((sum, allocation) => sum + allocation.outstanding, 0),
)

const selectedPartyRow = computed(
  () => partyRows.value.find((row) => row.id === selectedParty.value?.id) ?? null,
)

function openParty(row: PartyRow) {
  selectedParty.value = session.ledgers.find((ledger) => ledger.id === row.id) ?? null
  drawerOpen.value = true
}

// ---------------------------------------------------------------------------
// New party
// ---------------------------------------------------------------------------

const createOpen = ref(false)
const saving = ref(false)
const formError = ref<string | null>(null)
const fieldErrors = ref<Record<string, string>>({})

const form = ref({
  name: '',
  kind: 'customer' as 'customer' | 'supplier' | 'both',
  openingBalance: '',
  taxNumber: '',
  phone: '',
  email: '',
  address: '',
})

const kindOptions = [
  { value: 'customer', label: 'Customer' },
  { value: 'supplier', label: 'Supplier' },
  { value: 'both', label: 'Customer and supplier' },
]

function resetForm() {
  form.value = {
    name: '',
    kind: 'customer',
    openingBalance: '',
    taxNumber: '',
    phone: '',
    email: '',
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
  if (!name) errors.name = 'A party name is required.'
  else if (
    session.ledgers.some(
      (ledger) => ledger.name.trim().toLowerCase() === name.toLowerCase(),
    )
  ) {
    errors.name = 'A ledger with this name already exists.'
  }
  if (form.value.email && !/^\S+@\S+\.\S+$/.test(form.value.email.trim())) {
    errors.email = 'Enter a valid email address.'
  }
  fieldErrors.value = errors
  return Object.keys(errors).length === 0
}

async function saveParty() {
  const companyId = session.activeCompanyId
  if (!companyId) return
  if (!validateForm()) return

  saving.value = true
  formError.value = null
  try {
    const partyKind: PartyKind = form.value.kind
    const isSupplier = partyKind === 'supplier'
    const ledger: Ledger = {
      id: `led-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      companyId,
      name: form.value.name.trim(),
      group: isSupplier ? 'liabilities' : 'assets',
      type: isSupplier ? 'payable' : 'receivable',
      parentId: null,
      openingBalance: toMinor(form.value.openingBalance || '0'),
      openingDate: session.activeFinancialYear?.start ?? period.value.from,
      partyKind,
      currency: currency.value,
      taxNumber: form.value.taxNumber.trim() || undefined,
      phone: form.value.phone.trim() || undefined,
      email: form.value.email.trim() || undefined,
      address: form.value.address.trim() || undefined,
      isSystem: false,
      isActive: true,
      createdAt: new Date().toISOString(),
    }

    await session.repository.saveLedger(ledger)
    await session.loadMasters(companyId)
    createOpen.value = false
    toast.success('Party created', `${ledger.name} was added to ${partyKind} masters.`)
  } catch (cause) {
    formError.value =
      cause instanceof Error ? cause.message : 'The party could not be saved. Try again.'
  } finally {
    saving.value = false
  }
}

// ---------------------------------------------------------------------------
// Deactivate
// ---------------------------------------------------------------------------

const deactivateTarget = ref<Ledger | null>(null)
const deactivateOpen = ref(false)
const deactivateSaving = ref(false)

function askDeactivate(row: PartyRow) {
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
      'Party deactivated',
      `${ledger.name} was deactivated. Its vouchers are kept and it can be reactivated.`,
    )
  } catch (cause) {
    toast.error(
      'Party could not be deactivated',
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
      title="Parties"
      subtitle="Customers and suppliers, their balances and their statements"
      icon="contacts"
    >
      <template #actions>
        <BaseButton size="sm" variant="primary" icon="person_add" @click="openCreate">
          New party
        </BaseButton>
      </template>
    </PageHeader>

    <BaseTabs v-model="tab" :tabs="tabs" class="px-space-lg" />

    <FilterBar>
      <BaseInput
        v-model="search"
        label="Search"
        placeholder="Search name, GSTIN, phone or email"
        type="search"
        size="sm"
        class="w-72"
      />
      <template #trailing>
        <span class="text-label-sm text-outline">
          {{ visibleRows.length }} of {{ partyRows.length }} parties
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
        <p class="font-semibold">The party list could not be loaded</p>
        <p class="mt-0.5">{{ error }}</p>
      </div>

      <template v-else>
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Customers"
            :value="String(customerRows.length)"
            icon="person"
            hint="Ledgers with a customer party kind"
          />
          <StatTile
            label="Suppliers"
            :value="String(supplierRows.length)"
            icon="local_shipping"
            hint="Ledgers with a supplier party kind"
          />
          <StatTile
            label="Receivables outstanding"
            :value="formatMoney(receivableTotal, currency)"
            icon="assignment_turned_in"
            tone="info"
            hint="Money owed by customers"
          />
          <StatTile
            label="Payables outstanding"
            :value="formatMoney(payableTotal, currency)"
            icon="schedule"
            hint="Money owed to suppliers"
          />
        </div>

        <div
          class="mt-space-md flex items-start gap-space-sm rounded-md border-l-4 border-l-primary bg-primary-fixed p-space-md text-body-sm text-on-primary-fixed"
        >
          <MaterialIcon name="info" :size="18" class="mt-0.5 shrink-0" />
          <p>
            A party ledger that already carries vouchers is never permanently deleted. Deactivate it
            instead: it stops appearing in new vouchers, its posted history stays in the books, and
            it can be reactivated at any time.
          </p>
        </div>

        <section
          class="mt-space-md overflow-hidden rounded-md bg-surface-container-lowest shadow-sm"
        >
          <header class="flex flex-wrap items-center justify-between gap-3 px-space-md py-space-sm">
            <div class="flex items-center gap-space-sm">
              <MaterialIcon name="table_view" :size="20" class="text-primary" />
              <h2 class="text-headline-sm text-on-surface">Party list</h2>
            </div>
            <span class="text-label-xs text-outline">
              Click a row to open the statement and outstanding invoices
            </span>
          </header>

          <DataTable
            v-if="visibleRows.length"
            :columns="columns"
            :rows="visibleRows"
            row-key="id"
            empty-title="No parties match"
            empty-description="Change the search term or switch tabs."
            @row-click="openParty"
          >
            <template #cell:name="{ row }">
              <span class="block font-medium text-on-surface">{{ row.name }}</span>
              <span class="block text-label-xs text-outline">{{ row.address || '—' }}</span>
            </template>
            <template #cell:taxNumber="{ row }">
              <span class="num text-numeric-sm text-on-surface-variant">
                {{ row.taxNumber || '—' }}
              </span>
            </template>
            <template #cell:phone="{ row }">
              <span class="num text-numeric-sm text-on-surface-variant">{{ row.phone || '—' }}</span>
            </template>
            <template #cell:email="{ row }">
              <span class="text-label-sm text-on-surface-variant">{{ row.email || '—' }}</span>
            </template>
            <template #cell:outstanding="{ row }">
              <span
                class="font-bold"
                :class="row.outstanding > 0 ? 'text-tertiary' : 'text-on-surface-variant'"
              >
                {{ formatMoney(row.outstanding, currency) }}
              </span>
            </template>
            <template #cell:lastTransaction="{ row }">
              <span class="text-numeric-sm tabular text-outline">
                {{ row.lastTransaction ? formatDate(row.lastTransaction) : 'No transaction' }}
              </span>
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
          </DataTable>

          <BaseEmptyState
            v-else
            title="No parties match"
            description="Change the search term, switch tabs, or create a new party."
            :icon="MaterialIcon"
          >
            <BaseButton size="sm" variant="primary" icon="person_add" @click="openCreate">
              New party
            </BaseButton>
          </BaseEmptyState>

          <footer
            class="border-t border-surface-container bg-surface-container-low/60 px-space-md py-space-sm text-label-xs text-outline"
          >
            Outstanding is allocated from posted vouchers only: receipts and payments are applied
            to the oldest unpaid invoice of each party. Amounts are shown as a positive magnitude.
          </footer>
        </section>
      </template>
    </div>

    <!-- Party drawer -->
    <BaseDrawer
      :open="drawerOpen"
      :title="selectedParty?.name ?? 'Party'"
      :description="selectedParty ? (PARTY_KIND_LABELS[selectedParty.partyKind ?? ''] ?? 'Party') : ''"
      width="600px"
      @close="drawerOpen = false"
    >
      <div class="space-y-space-md">
        <section>
          <h3 class="section-label mb-space-sm">Statement</h3>
          <div
            v-if="statementRows.length"
            class="overflow-hidden rounded-sm border border-surface-container"
          >
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
                  <td class="max-w-[150px] truncate px-space-sm py-1.5 text-on-surface-variant">
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
            </table>
          </div>
          <BaseEmptyState
            v-else
            size="sm"
            title="No statement entries"
            description="Nothing has been posted against this party yet."
            :icon="MaterialIcon"
          />
        </section>

        <section>
          <h3 class="section-label mb-space-sm">Outstanding invoices</h3>
          <div
            v-if="openInvoices.length"
            class="overflow-hidden rounded-sm border border-surface-container"
          >
            <table class="w-full text-left text-body-sm">
              <thead class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline">
                <tr>
                  <th scope="col" class="px-space-sm py-2">Invoice</th>
                  <th scope="col" class="px-space-sm py-2">Date</th>
                  <th scope="col" class="px-space-sm py-2">Due</th>
                  <th scope="col" class="px-space-sm py-2 text-right">Amount</th>
                  <th scope="col" class="px-space-sm py-2 text-right">Settled</th>
                  <th scope="col" class="px-space-sm py-2 text-right">Outstanding</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-surface-container-low">
                <tr v-for="allocation in openInvoices" :key="allocation.voucherId">
                  <td class="px-space-sm py-1.5 text-numeric-sm font-semibold text-on-surface">
                    {{ allocation.voucherNumber }}
                  </td>
                  <td class="whitespace-nowrap px-space-sm py-1.5 text-numeric-sm tabular text-outline">
                    {{ formatDate(allocation.date) }}
                  </td>
                  <td class="whitespace-nowrap px-space-sm py-1.5 text-numeric-sm tabular text-outline">
                    {{ formatDate(allocation.dueDate) }}
                  </td>
                  <td class="px-space-sm py-1.5 text-right text-numeric-sm tabular text-on-surface-variant">
                    {{ formatMoney(allocation.amount, currency) }}
                  </td>
                  <td class="px-space-sm py-1.5 text-right text-numeric-sm tabular text-on-surface-variant">
                    {{ formatMoney(allocation.allocated, currency) }}
                  </td>
                  <td class="px-space-sm py-1.5 text-right text-numeric-sm font-bold tabular text-tertiary">
                    {{ formatMoney(allocation.outstanding, currency) }}
                  </td>
                </tr>
              </tbody>
              <tfoot class="bg-surface-container-low/60">
                <tr class="text-numeric-sm font-bold">
                  <td class="px-space-sm py-2 text-on-surface" colspan="5">Total outstanding</td>
                  <td class="px-space-sm py-2 text-right tabular text-on-surface">
                    {{ formatMoney(openInvoiceTotal, currency) }}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <BaseEmptyState
            v-else
            size="sm"
            title="Nothing outstanding"
            description="Every invoice of this party has been settled."
            :icon="MaterialIcon"
          />
        </section>
      </div>

      <template #footer>
        <BaseButton
          v-if="selectedPartyRow"
          size="sm"
          variant="outlined"
          icon="pause_circle"
          @click="askDeactivate(selectedPartyRow)"
        >
          Deactivate
        </BaseButton>
      </template>
    </BaseDrawer>

    <!-- New party -->
    <BaseModal
      :open="createOpen"
      title="New party"
      description="A party is a ledger with a customer or supplier kind, so its vouchers and balances are tracked."
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
          label="Party name"
          required
          placeholder="e.g. Sundaram Traders"
          :error="fieldErrors.name"
        />

        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2">
          <BaseSelect v-model="form.kind" label="Party kind" required :options="kindOptions" />
          <BaseNumberInput
            v-model="form.openingBalance"
            label="Opening balance"
            :currency="currency"
            placeholder="0.00"
            hint="Debit positive, credit negative."
          />
        </div>

        <BaseInput v-model="form.taxNumber" label="GSTIN / tax number" placeholder="Optional" />

        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2">
          <BaseInput v-model="form.phone" label="Phone" placeholder="Optional" />
          <BaseInput
            v-model="form.email"
            label="Email"
            type="email"
            placeholder="Optional"
            :error="fieldErrors.email"
          />
        </div>

        <BaseInput v-model="form.address" label="Address" placeholder="Optional" />
      </div>

      <template #footer>
        <BaseButton size="sm" variant="text" @click="createOpen = false">Cancel</BaseButton>
        <BaseButton size="sm" variant="primary" icon="save" :loading="saving" @click="saveParty">
          Save party
        </BaseButton>
      </template>
    </BaseModal>

    <!-- Deactivate confirmation -->
    <BaseModal
      :open="deactivateOpen"
      title="Deactivate party"
      description="A party with vouchers is never permanently deleted."
      size="sm"
      @close="deactivateOpen = false"
    >
      <p class="pt-space-xs text-body-md text-on-surface-variant">
        <span class="font-semibold text-on-surface">{{ deactivateTarget?.name }}</span> will stop
        appearing in new vouchers. Its posted vouchers and balances stay in the books, and it can
        be reactivated later.
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
