<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import { useSessionStore } from '@/stores/session'
import { useToastStore } from '@/stores/toast'
import { formatDate } from '@/lib/datetime'
import type { Company, VoucherType } from '@/domain/types'
import type { VoucherNumbering } from '@/repositories/contracts'

const session = useSessionStore()
const toast = useToastStore()

const companyId = computed(() => session.activeCompanyId)
const company = computed(() => session.activeCompany)

// ---------------------------------------------------------------------------
// Honest storage statements
// ---------------------------------------------------------------------------

/** True in the browser preview, where the workspace is held in memory only. */
const isPreviewWorkspace = computed(() => session.repository.info.kind === 'demo')

/** Where a saved profile goes, stated plainly for the current runtime. */
const profileStorageNotice = computed(() => {
  if (isPreviewWorkspace.value) {
    return 'This is a browser preview. The change is held in the in-memory sample workspace only and is lost when the window closes.'
  }
  if (company.value?.isDemo) {
    return 'The change is written to the local database on this computer, into the sample workspace. That workspace is flagged as sample data and is kept apart from a real company.'
  }
  return 'The change is written to the local database on this computer. It becomes part of the company record and survives a restart.'
})

/** Where the saved numbering goes, stated plainly for the current runtime. */
const numberingStorageNotice = computed(() =>
  isPreviewWorkspace.value
    ? 'This is a browser preview. The numbering scheme is held in the in-memory sample workspace only and is lost when the window closes.'
    : 'The numbering scheme is written to the local database on this computer and survives a restart.',
)

// ---------------------------------------------------------------------------
// Company profile
// ---------------------------------------------------------------------------

type ProfileForm = {
  name: string
  legalName: string
  state: string
  gstin: string
  pan: string
  address: string
  phone: string
  email: string
  industry: string
}

const INDIAN_STATES = [
  'Andhra Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Delhi',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Tamil Nadu',
  'Telangana',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
].map((value) => ({ value, label: value }))

function emptyProfile(): ProfileForm {
  return {
    name: '',
    legalName: '',
    state: '',
    gstin: '',
    pan: '',
    address: '',
    phone: '',
    email: '',
    industry: '',
  }
}

function readProfile(source: Company): ProfileForm {
  return {
    name: source.name ?? '',
    legalName: source.legalName ?? '',
    state: source.state ?? '',
    gstin: source.gstin ?? '',
    pan: source.pan ?? '',
    address: source.address ?? '',
    phone: source.phone ?? '',
    email: source.email ?? '',
    industry: source.industry ?? '',
  }
}

/** The same trimming the write applies, so a dirty check is honest. */
function normalizeProfile(source: ProfileForm): ProfileForm {
  return {
    ...source,
    name: source.name.trim(),
    legalName: source.legalName.trim(),
    state: source.state.trim(),
    gstin: source.gstin.replace(/\s/g, '').toUpperCase(),
    pan: source.pan.replace(/\s/g, '').toUpperCase(),
    address: source.address.trim(),
    phone: source.phone.trim(),
    email: source.email.trim(),
    industry: source.industry.trim(),
  }
}

const profileForm = ref<ProfileForm>(emptyProfile())
const savedProfile = ref<ProfileForm>(emptyProfile())
const profileErrors = ref<Record<string, string>>({})
const profileError = ref<string | null>(null)
const savingProfile = ref(false)

const profileDirty = computed(
  () =>
    JSON.stringify(normalizeProfile(profileForm.value)) !== JSON.stringify(savedProfile.value),
)

const isIndianCompany = computed(() => (company.value?.country ?? '').toLowerCase() === 'india')

/** Keeps a state that is not on the list visible rather than silently blank. */
const stateOptions = computed(() => {
  const current = profileForm.value.state.trim()
  if (!current) return INDIAN_STATES
  if (INDIAN_STATES.some((option) => option.value === current)) return INDIAN_STATES
  return [{ value: current, label: current }, ...INDIAN_STATES]
})

function loadProfile() {
  const current = company.value
  const next = current ? normalizeProfile(readProfile(current)) : emptyProfile()
  profileForm.value = { ...next }
  savedProfile.value = next
  profileErrors.value = {}
  profileError.value = null
}

watch(company, loadProfile, { immediate: true })

function validateProfile(): boolean {
  const found: Record<string, string> = {}
  const name = profileForm.value.name.trim()
  if (!name) found.name = 'The trading name is required.'
  else if (name.length < 2) found.name = 'The trading name must be at least two characters.'

  if (!profileForm.value.state.trim()) {
    found.state = 'The state or jurisdiction is required.'
  }

  const gstin = profileForm.value.gstin.replace(/\s/g, '').toUpperCase()
  if (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(gstin)) {
    found.gstin = 'A GSTIN is 15 characters, in the form 22AAAAA0000A1Z5.'
  }

  const pan = profileForm.value.pan.replace(/\s/g, '').toUpperCase()
  if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
    found.pan = 'A PAN is 10 characters, in the form ABCDE1234F.'
  }

  const email = profileForm.value.email.trim()
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    found.email = 'That does not look like an email address.'
  }

  profileErrors.value = found
  return Object.keys(found).length === 0
}

/**
 * Re-read the company list so the toolbar and the company switcher show the
 * name that was just saved. The session store exposes `companies` as state
 * but has no refresh action of its own, so the list is written back here.
 */
async function refreshCompanyList() {
  const list = await session.repository.listCompanies()
  session.companies = list
}

async function saveProfile() {
  const current = session.activeCompany
  if (!current) {
    profileError.value = 'No company is open, so there is nothing to save.'
    return
  }
  if (!validateProfile()) return

  savingProfile.value = true
  profileError.value = null

  const changes = {
    name: profileForm.value.name.trim(),
    legalName: profileForm.value.legalName.trim() || undefined,
    state: profileForm.value.state.trim(),
    gstin: profileForm.value.gstin.replace(/\s/g, '').toUpperCase() || undefined,
    pan: profileForm.value.pan.replace(/\s/g, '').toUpperCase() || undefined,
    address: profileForm.value.address.trim() || undefined,
    phone: profileForm.value.phone.trim() || undefined,
    email: profileForm.value.email.trim() || undefined,
    industry: profileForm.value.industry.trim() || undefined,
  }

  try {
    await session.repository.updateCompany({ ...current, ...changes })
    await refreshCompanyList()
    savedProfile.value = normalizeProfile(profileForm.value)
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : 'The write did not complete.'
    profileError.value = `Nothing was saved: ${detail} Your entries are still on the form.`
    toast.error('Company profile not saved', `Nothing was saved: ${detail}`)
    return
  } finally {
    savingProfile.value = false
  }

  toast.success(
    'Company profile saved',
    isPreviewWorkspace.value
      ? 'The change was applied to the in-memory sample workspace only. It is lost when the window closes.'
      : 'The change was written to the local database and survives a restart.',
  )
}

// ---------------------------------------------------------------------------
// Voucher numbering
// ---------------------------------------------------------------------------

type PrefixKey =
  | 'salesPrefix'
  | 'purchasePrefix'
  | 'paymentPrefix'
  | 'receiptPrefix'
  | 'contraPrefix'
  | 'journalPrefix'
  | 'creditNotePrefix'
  | 'debitNotePrefix'
  | 'salesOrderPrefix'
  | 'purchaseOrderPrefix'

const SERIES: { key: PrefixKey; type: VoucherType; label: string }[] = [
  { key: 'salesPrefix', type: 'sales', label: 'Sales invoice' },
  { key: 'purchasePrefix', type: 'purchase', label: 'Purchase bill' },
  { key: 'paymentPrefix', type: 'payment', label: 'Payment' },
  { key: 'receiptPrefix', type: 'receipt', label: 'Receipt' },
  { key: 'contraPrefix', type: 'contra', label: 'Contra' },
  { key: 'journalPrefix', type: 'journal', label: 'Journal' },
  { key: 'creditNotePrefix', type: 'credit-note', label: 'Credit note' },
  { key: 'debitNotePrefix', type: 'debit-note', label: 'Debit note' },
  { key: 'salesOrderPrefix', type: 'sales-order', label: 'Sales order' },
  { key: 'purchaseOrderPrefix', type: 'purchase-order', label: 'Purchase order' },
]

const EXTRA_NUMBERING: { prefix: string; label: string }[] = [
  { prefix: 'DNL', label: 'Delivery note' },
  { prefix: 'RCL', label: 'Receipt note' },
  { prefix: 'STJ', label: 'Stock journal' },
]

const nextNumbers = ref<Record<string, string>>({})
const nextLoading = ref(false)

async function loadNextNumbers() {
  if (!companyId.value) return
  nextLoading.value = true
  try {
    const entries = await Promise.all(
      SERIES.map(async (entry) => {
        const number = await session.repository.nextVoucherNumber(companyId.value!, entry.type)
        return [entry.type, number] as const
      }),
    )
    nextNumbers.value = Object.fromEntries(entries)
  } finally {
    nextLoading.value = false
  }
}

const numbering = ref<VoucherNumbering | null>(null)
const numberingForm = ref<Record<PrefixKey, string>>({
  salesPrefix: '',
  purchasePrefix: '',
  paymentPrefix: '',
  receiptPrefix: '',
  contraPrefix: '',
  journalPrefix: '',
  creditNotePrefix: '',
  debitNotePrefix: '',
  salesOrderPrefix: '',
  purchaseOrderPrefix: '',
})
const paddingForm = ref<string | number>('')
const numberingErrors = ref<Record<string, string>>({})
const numberingError = ref<string | null>(null)
const savingNumbering = ref(false)
const schemeLoading = ref(false)

function prefixesOf(source: VoucherNumbering): Record<PrefixKey, string> {
  return {
    salesPrefix: source.salesPrefix,
    purchasePrefix: source.purchasePrefix,
    paymentPrefix: source.paymentPrefix,
    receiptPrefix: source.receiptPrefix,
    contraPrefix: source.contraPrefix,
    journalPrefix: source.journalPrefix,
    creditNotePrefix: source.creditNotePrefix,
    debitNotePrefix: source.debitNotePrefix,
    salesOrderPrefix: source.salesOrderPrefix,
    purchaseOrderPrefix: source.purchaseOrderPrefix,
  }
}

function loadNumbering() {
  const base = numbering.value
  if (!base) return
  numberingForm.value = { ...prefixesOf(base) }
  paddingForm.value = String(base.padding)
  numberingErrors.value = {}
  numberingError.value = null
}

async function fetchNumbering() {
  const id = companyId.value
  if (!id) return
  schemeLoading.value = true
  numberingError.value = null
  try {
    numbering.value = await session.repository.getVoucherNumbering(id)
    loadNumbering()
  } catch (cause) {
    numberingError.value =
      cause instanceof Error
        ? cause.message
        : 'The numbering scheme could not be read from the repository.'
  } finally {
    schemeLoading.value = false
  }
}

onMounted(loadNextNumbers)
onMounted(fetchNumbering)
watch(companyId, loadNextNumbers)
watch(companyId, fetchNumbering)

/** The padding as a number, falling back to the saved one while it is invalid. */
const paddingValue = computed(() => {
  const raw =
    typeof paddingForm.value === 'number' ? String(paddingForm.value) : paddingForm.value.trim()
  const parsed = Number(raw)
  if (!raw || !Number.isInteger(parsed) || parsed < 1 || parsed > 8) {
    return numbering.value?.padding ?? 4
  }
  return parsed
})

/** The sequence number the repository will hand out for the series. */
function sequenceOf(type: VoucherType): number {
  const issued = nextNumbers.value[type]
  if (!issued) return 1
  const digits = issued.split('-').pop()
  const parsed = Number(digits)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

/** The number a voucher of the series would carry with the scheme as configured. */
function previewFor(entry: { key: PrefixKey; type: VoucherType }): string {
  const prefix = (numberingForm.value[entry.key] ?? '').trim() || '—'
  return `${prefix}-${String(sequenceOf(entry.type)).padStart(paddingValue.value, '0')}`
}

const numberingDirty = computed(() => {
  const base = numbering.value
  if (!base) return false
  if (JSON.stringify(numberingForm.value) !== JSON.stringify(prefixesOf(base))) return true
  return paddingValue.value !== base.padding
})

function validateNumbering(): boolean {
  const found: Record<string, string> = {}
  for (const entry of SERIES) {
    const value = (numberingForm.value[entry.key] ?? '').trim()
    if (!value) found[entry.key] = 'A prefix is required.'
    else if (!/^[A-Za-z0-9_-]+$/.test(value)) {
      found[entry.key] = 'Use letters, digits, a dash or an underscore only.'
    }
  }

  const raw =
    typeof paddingForm.value === 'number' ? String(paddingForm.value) : paddingForm.value.trim()
  const padding = Number(raw)
  if (!raw) found.padding = 'Enter the padding.'
  else if (!Number.isInteger(padding) || padding < 1 || padding > 8) {
    found.padding = 'Enter a whole number between 1 and 8.'
  }

  numberingErrors.value = found
  return Object.keys(found).length === 0
}

async function saveNumbering() {
  const base = numbering.value
  if (!base) {
    numberingError.value = 'The numbering scheme has not been loaded, so it cannot be saved.'
    return
  }
  if (!validateNumbering()) return

  savingNumbering.value = true
  numberingError.value = null

  const payload: VoucherNumbering = {
    ...base,
    ...prefixesOf({ ...base, ...numberingForm.value }),
    padding: paddingValue.value,
    updatedAt: new Date().toISOString(),
  }

  try {
    numbering.value = await session.repository.saveVoucherNumbering(payload)
    loadNumbering()
    await loadNextNumbers()
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : 'The write did not complete.'
    numberingError.value = `Nothing was saved: ${detail} Your entries are still on the form.`
    toast.error('Voucher numbering not saved', `Nothing was saved: ${detail}`)
    return
  } finally {
    savingNumbering.value = false
  }

  toast.success(
    'Voucher numbering saved',
    isPreviewWorkspace.value
      ? 'The scheme was applied to the in-memory sample workspace only. It is lost when the window closes.'
      : 'The scheme was written to the local database and survives a restart.',
  )
}

// ---------------------------------------------------------------------------
// Periods, tax and stock — read from the session, unchanged
// ---------------------------------------------------------------------------

const years = computed(() => session.financialYears)
const closedYears = computed(() => years.value.filter((year) => year.isClosed))
const openYears = computed(() => years.value.filter((year) => !year.isClosed))

const taxSummary = computed(() =>
  session.taxCategories
    .map((tax) => `${tax.name} (${tax.rate}%)`)
    .sort((left, right) => left.localeCompare(right)),
)

const unitNames = computed(() =>
  session.units.map((unit) => unit.name).sort((left, right) => left.localeCompare(right)),
)

const stockGroupNames = computed(() =>
  session.stockGroups.map((group) => group.name).sort((left, right) => left.localeCompare(right)),
)
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      title="Company settings"
      subtitle="The company record, its periods and the way its books are numbered"
      icon="domain"
      :breadcrumb="[{ label: 'Settings', to: '/settings/preferences' }, { label: 'Company settings' }]"
    />

    <div class="min-h-0 flex-1 overflow-auto p-space-lg">
      <div class="grid grid-cols-1 items-start gap-space-md xl:grid-cols-2">
        <!-- Company profile -->
        <BaseCard
          title="Company profile"
          description="The company record held by the repository"
        >
          <template #actions>
            <BaseBadge
              v-if="profileDirty"
              tone="warning"
              size="xs"
              icon="edit"
            >
              Unsaved changes
            </BaseBadge>
            <BaseBadge v-else tone="positive" size="xs" icon="check_circle">Saved</BaseBadge>
          </template>

          <div
            v-if="profileError"
            class="mb-space-md flex items-start gap-space-sm rounded-sm border-l-4 border-l-error bg-error-container p-space-sm text-body-sm text-on-error-container"
            role="alert"
          >
            <MaterialIcon name="error" :size="18" class="mt-0.5 shrink-0" />
            <p>{{ profileError }}</p>
          </div>

          <div
            class="flex items-start gap-space-sm rounded-sm border-l-4 border-l-tertiary bg-tertiary-fixed p-space-sm text-body-sm text-on-tertiary-fixed"
            role="status"
          >
            <MaterialIcon name="info" :size="18" class="mt-0.5 shrink-0" />
            <p>{{ profileStorageNotice }}</p>
          </div>

          <form novalidate @submit.prevent="saveProfile">
            <div class="mt-space-md grid grid-cols-1 gap-space-md sm:grid-cols-2">
              <BaseInput
                v-model="profileForm.name"
                name="company-name"
                label="Trading name"
                required
                placeholder="The name the business trades under"
                :error="profileErrors.name"
                class="sm:col-span-2"
              />
              <BaseInput
                v-model="profileForm.legalName"
                name="company-legal-name"
                label="Legal name"
                placeholder="The registered name of the business"
                :error="profileErrors.legalName"
                class="sm:col-span-2"
              />
              <BaseSelect
                v-if="isIndianCompany"
                v-model="profileForm.state"
                name="company-state"
                label="State"
                required
                :options="stateOptions"
                :error="profileErrors.state"
                hint="The state decides whether a supply is intra-state or inter-state."
              />
              <BaseInput
                v-else
                v-model="profileForm.state"
                name="company-state"
                label="State or jurisdiction"
                required
                :error="profileErrors.state"
                hint="The place the business is registered in."
              />
              <BaseInput
                v-model="profileForm.industry"
                name="company-industry"
                label="Industry"
                placeholder="Retail, manufacturing, services…"
                :error="profileErrors.industry"
              />
              <BaseInput
                v-model="profileForm.gstin"
                name="company-gstin"
                label="GSTIN"
                placeholder="22AAAAA0000A1Z5"
                :error="profileErrors.gstin"
                hint="Fifteen characters. Left blank if the business is not registered for GST."
              />
              <BaseInput
                v-model="profileForm.pan"
                name="company-pan"
                label="PAN"
                placeholder="ABCDE1234F"
                :error="profileErrors.pan"
              />
              <BaseInput
                v-model="profileForm.phone"
                name="company-phone"
                label="Phone"
                :error="profileErrors.phone"
              />
              <BaseInput
                v-model="profileForm.email"
                name="company-email"
                label="Email"
                type="email"
                :error="profileErrors.email"
              />
              <BaseInput
                v-model="profileForm.address"
                name="company-address"
                label="Address"
                :error="profileErrors.address"
                class="sm:col-span-2"
              />
            </div>

            <div class="mt-space-md rounded-sm bg-surface-container-low p-space-sm">
              <p class="flex items-center gap-1 text-label-md font-semibold text-on-surface">
                <MaterialIcon name="lock" :size="15" class="text-primary" />
                What is fixed here, and why
              </p>
              <dl class="mt-space-sm grid grid-cols-1 gap-space-sm sm:grid-cols-2">
                <div>
                  <dt class="section-label">Identifier</dt>
                  <dd class="mt-0.5 break-all text-body-sm text-on-surface">
                    {{ company?.id ?? '—' }}
                  </dd>
                </div>
                <div>
                  <dt class="section-label">Base currency</dt>
                  <dd class="mt-0.5 text-body-sm text-on-surface">
                    {{ company?.baseCurrency ?? '—' }}
                  </dd>
                </div>
                <div>
                  <dt class="section-label">Country</dt>
                  <dd class="mt-0.5 text-body-sm text-on-surface">{{ company?.country ?? '—' }}</dd>
                </div>
                <div>
                  <dt class="section-label">Financial year</dt>
                  <dd class="mt-0.5 text-body-sm tabular text-on-surface">
                    {{
                      company
                        ? `${formatDate(company.fiscalYearStart)} – ${formatDate(company.fiscalYearEnd)}`
                        : '—'
                    }}
                  </dd>
                </div>
              </dl>
              <p class="mt-space-sm text-label-xs text-on-surface-variant">
                The identifier, the base currency, the country and the financial year are not
                editable here. Changing any of them would change the meaning of records that have
                already been posted — a rupee would no longer be the rupee it was posted in, and a
                voucher would fall into a different period.
              </p>
            </div>

            <div class="mt-space-md flex items-center justify-end gap-2">
              <BaseButton
                size="sm"
                variant="text"
                icon="restart_alt"
                :disabled="!profileDirty || savingProfile"
                @click="loadProfile"
              >
                Discard changes
              </BaseButton>
              <BaseButton
                size="sm"
                variant="primary"
                icon="save"
                type="submit"
                :loading="savingProfile"
                :disabled="!profileDirty"
              >
                Save profile
              </BaseButton>
            </div>
          </form>

          <template #footer>
            <p class="text-label-xs text-outline">
              A new company is created on the
              <RouterLink to="/company/create" class="font-semibold text-primary hover:underline">
                company creation screen
              </RouterLink>. After a save the company list is read again from the repository, so the
              company switcher in the toolbar shows the new name straight away.
            </p>
          </template>
        </BaseCard>

        <!-- Financial periods -->
        <BaseCard
          title="Financial periods"
          :description="`${years.length} period${years.length === 1 ? '' : 's'} · ${closedYears.length} closed, ${openYears.length} open`"
        >
          <div class="overflow-hidden rounded-sm border border-surface-container">
            <table class="w-full text-left text-body-sm">
              <thead class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline">
                <tr>
                  <th scope="col" class="px-space-sm py-2">Period</th>
                  <th scope="col" class="px-space-sm py-2">From</th>
                  <th scope="col" class="px-space-sm py-2">To</th>
                  <th scope="col" class="px-space-sm py-2">State</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-surface-container-low">
                <tr v-for="year in years" :key="year.id">
                  <td class="px-space-sm py-1.5 font-semibold text-on-surface">{{ year.label }}</td>
                  <td class="px-space-sm py-1.5 tabular text-on-surface-variant">
                    {{ formatDate(year.start) }}
                  </td>
                  <td class="px-space-sm py-1.5 tabular text-on-surface-variant">
                    {{ formatDate(year.end) }}
                  </td>
                  <td class="px-space-sm py-1.5">
                    <BaseBadge v-if="year.isClosed" tone="neutral" size="xs" icon="lock">
                      Closed
                    </BaseBadge>
                    <BaseBadge v-else tone="positive" size="xs" icon="lock_open">Open</BaseBadge>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="mt-space-md rounded-sm bg-surface-container-low p-space-sm">
            <p class="flex items-center gap-1 text-label-md font-semibold text-on-surface">
              <MaterialIcon name="lock" :size="15" class="text-primary" />
              How period locking works
            </p>
            <ul class="mt-space-xs space-y-1 text-body-sm text-on-surface-variant">
              <li>
                A closed period keeps the vouchers that were posted in it. Closing does not delete
                anything.
              </li>
              <li>
                While a period is open, its vouchers can be edited, and the reports move with them.
                Once it is closed, the figures for that period are meant to stand still.
              </li>
              <li>
                The repository exposes no close or reopen operation in this build, so the Closed
                state shown above comes from the company record and cannot be changed here.
              </li>
            </ul>
          </div>
        </BaseCard>

        <!-- Voucher numbering -->
        <BaseCard
          title="Voucher numbering"
          description="The prefixes and the padding each series is numbered with"
        >
          <template #actions>
            <BaseBadge v-if="numberingDirty" tone="warning" size="xs" icon="edit">
              Unsaved changes
            </BaseBadge>
            <BaseBadge v-else tone="neutral" size="xs" icon="tune">Scheme is editable</BaseBadge>
          </template>

          <div
            v-if="numberingError"
            class="mb-space-md flex items-start gap-space-sm rounded-sm border-l-4 border-l-error bg-error-container p-space-sm text-body-sm text-on-error-container"
            role="alert"
          >
            <MaterialIcon name="error" :size="18" class="mt-0.5 shrink-0" />
            <p>{{ numberingError }}</p>
          </div>

          <div
            class="flex items-start gap-space-sm rounded-sm border-l-4 border-l-tertiary bg-tertiary-fixed p-space-sm text-body-sm text-on-tertiary-fixed"
            role="status"
          >
            <MaterialIcon name="info" :size="18" class="mt-0.5 shrink-0" />
            <p>{{ numberingStorageNotice }}</p>
          </div>

          <div v-if="schemeLoading" class="mt-space-md space-y-2">
            <BaseSkeleton class="h-8 w-full" />
            <BaseSkeleton class="h-8 w-full" />
            <BaseSkeleton class="h-8 w-full" />
          </div>

          <template v-else>
            <div class="mt-space-md flex flex-wrap items-end gap-space-md">
              <BaseInput
                v-model="paddingForm"
                type="number"
                name="number-padding"
                label="Number padding"
                size="sm"
                class="w-24"
                :error="numberingErrors.padding"
              />
              <p class="pb-1 text-label-xs text-outline">
                Digits that follow the prefix, for every series. Four digits gives INV-0007.
              </p>
            </div>

            <div class="mt-space-md overflow-hidden rounded-sm border border-surface-container">
              <table class="w-full text-left text-body-sm">
                <thead class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline">
                  <tr>
                    <th scope="col" class="px-space-sm py-2">Series</th>
                    <th scope="col" class="px-space-sm py-2">Prefix</th>
                    <th scope="col" class="px-space-sm py-2">Preview</th>
                    <th scope="col" class="px-space-sm py-2 text-right">Next number issued</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-surface-container-low">
                  <tr v-for="entry in SERIES" :key="entry.key">
                    <td class="px-space-sm py-1.5 text-on-surface-variant">{{ entry.label }}</td>
                    <td class="px-space-sm py-1.5">
                      <BaseInput
                        v-model="numberingForm[entry.key]"
                        size="sm"
                        class="w-28"
                        :name="`prefix-${entry.type}`"
                        :placeholder="numbering?.[entry.key] ?? ''"
                        :error="numberingErrors[entry.key]"
                      />
                    </td>
                    <td class="px-space-sm py-1.5">
                      <span class="rounded-sm bg-primary-fixed px-1.5 py-0.5 font-mono text-label-sm font-bold text-on-primary-fixed">
                        {{ previewFor(entry) }}
                      </span>
                    </td>
                    <td class="px-space-sm py-1.5 text-right tabular text-on-surface">
                      {{ nextLoading ? '…' : (nextNumbers[entry.type] ?? '—') }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="mt-space-md flex items-center justify-end gap-2">
              <BaseButton
                size="sm"
                variant="text"
                icon="restart_alt"
                :disabled="!numberingDirty || savingNumbering"
                @click="loadNumbering"
              >
                Discard changes
              </BaseButton>
              <BaseButton
                size="sm"
                variant="primary"
                icon="save"
                :loading="savingNumbering"
                :disabled="!numberingDirty"
                @click="saveNumbering"
              >
                Save numbering
              </BaseButton>
            </div>
          </template>

          <p class="mt-space-xs text-label-xs text-outline">
            Three further prefixes are in use:
            {{ EXTRA_NUMBERING.map((entry) => `${entry.prefix} (${entry.label})`).join(', ') }}.
          </p>

          <div
            class="mt-space-md flex items-start gap-space-sm rounded-sm border-l-4 border-l-tertiary bg-tertiary-fixed p-space-sm text-body-sm text-on-tertiary-fixed"
            role="status"
          >
            <MaterialIcon name="info" :size="18" class="mt-0.5 shrink-0" />
            <p>
              Changing the numbering does not renumber vouchers that have already been issued. A
              voucher keeps the number it was given. The preview shows the scheme as configured
              here; the next number column is the number the repository will actually hand out, and
              the number engine in this build still issues from its own built-in series, so the
              prefixes and padding saved below are stored with the company record rather than
              applied to the next number.
            </p>
          </div>
        </BaseCard>

        <!-- Inventory -->
        <BaseCard title="Inventory" description="How stock is configured for this company">
          <template #actions>
            <BaseBadge tone="neutral" size="xs" icon="lock">Not yet editable</BaseBadge>
          </template>

          <dl class="grid grid-cols-2 gap-space-sm sm:grid-cols-4">
            <div class="rounded-sm bg-surface-container-low p-space-sm">
              <dt class="section-label">Items</dt>
              <dd class="mt-0.5 text-headline-sm text-on-surface tabular">{{ session.items.length }}</dd>
            </div>
            <div class="rounded-sm bg-surface-container-low p-space-sm">
              <dt class="section-label">Stock groups</dt>
              <dd class="mt-0.5 text-headline-sm text-on-surface tabular">
                {{ session.stockGroups.length }}
              </dd>
            </div>
            <div class="rounded-sm bg-surface-container-low p-space-sm">
              <dt class="section-label">Godowns</dt>
              <dd class="mt-0.5 text-headline-sm text-on-surface tabular">
                {{ session.godowns.length }}
              </dd>
            </div>
            <div class="rounded-sm bg-surface-container-low p-space-sm">
              <dt class="section-label">Units</dt>
              <dd class="mt-0.5 text-headline-sm text-on-surface tabular">
                {{ session.units.length }}
              </dd>
            </div>
          </dl>

          <dl class="mt-space-md space-y-1 text-body-sm text-on-surface-variant">
            <div class="flex gap-2">
              <dt class="w-28 shrink-0 text-outline">Units</dt>
              <dd>{{ unitNames.join(', ') || 'None configured' }}</dd>
            </div>
            <div class="flex gap-2">
              <dt class="w-28 shrink-0 text-outline">Stock groups</dt>
              <dd>{{ stockGroupNames.join(', ') || 'None configured' }}</dd>
            </div>
            <div class="flex gap-2">
              <dt class="w-28 shrink-0 text-outline">Godowns</dt>
              <dd>
                {{ session.godowns.map((godown) => godown.name).join(', ') || 'None configured' }}
              </dd>
            </div>
          </dl>

          <p class="mt-space-sm text-label-xs text-outline">
            Valuation method, reorder settings and the unit of measure are not configurable in this
            build. Items, groups, godowns and units are edited on their own master screens.
          </p>
        </BaseCard>

        <!-- Tax -->
        <BaseCard title="Tax" description="The tax categories carried by this company">
          <template #actions>
            <BaseBadge tone="neutral" size="xs" icon="lock">Not yet editable</BaseBadge>
          </template>

          <ul v-if="taxSummary.length" class="space-y-1">
            <li
              v-for="tax in taxSummary"
              :key="tax"
              class="flex items-center justify-between gap-2 rounded-sm bg-surface-container-low px-space-sm py-1.5 text-body-sm"
            >
              <span class="text-on-surface">{{ tax.replace(/\s*\([^)]*\)$/, '') }}</span>
              <span class="tabular font-semibold text-on-surface-variant">
                {{ tax.replace(/^.*\(/, '').replace(')', '') }}%
              </span>
            </li>
          </ul>
          <p v-else class="text-body-sm text-outline">No tax categories are configured.</p>

          <p class="mt-space-sm text-label-xs text-outline">
            Tax categories are edited on the tax master screen. The rate, the side and the ledger a
            tax is carried in are fixed there in this build.
          </p>
        </BaseCard>

        <!-- Printing -->
        <BaseCard title="Printing" description="How documents are laid out on paper">
          <template #actions>
            <BaseBadge tone="neutral" size="xs" icon="block">Not implemented</BaseBadge>
          </template>

          <p class="text-body-sm text-on-surface-variant">
            Printing is not implemented in this build. There is no print preview, no paper size
            setting and no company logo on a document, so nothing here can be configured yet.
          </p>

          <ul class="mt-space-sm space-y-1 text-label-sm text-outline">
            <li>Print preview and the print dialog are not part of this build.</li>
            <li>The company logo and address block will be read from this record.</li>
            <li>Paper size, margins and the footer line will be preferences.</li>
          </ul>
        </BaseCard>

        <!-- Access -->
        <BaseCard title="Access" description="Who can work in this workspace">
          <template #actions>
            <BaseBadge tone="neutral" size="xs" icon="lock">Single user</BaseBadge>
          </template>

          <p class="text-body-sm text-on-surface-variant">
            This workspace runs in single-user local mode. There are no user accounts to configure
            and no role to assign. The
            <RouterLink to="/settings/users" class="font-semibold text-primary hover:underline">
              users and roles screen
            </RouterLink>
            describes what role-based access control will cover when it lands.
          </p>
        </BaseCard>
      </div>
    </div>
  </div>
</template>
