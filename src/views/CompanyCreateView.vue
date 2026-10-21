<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import { useSessionStore } from '@/stores/session'
import { useToastStore } from '@/stores/toast'

const session = useSessionStore()
const toast = useToastStore()
const router = useRouter()

const COUNTRIES = [
  { value: 'India', label: 'India' },
  { value: 'United Arab Emirates', label: 'United Arab Emirates' },
  { value: 'Singapore', label: 'Singapore' },
  { value: 'United Kingdom', label: 'United Kingdom' },
  { value: 'United States', label: 'United States' },
  { value: 'Nepal', label: 'Nepal' },
  { value: 'Bangladesh', label: 'Bangladesh' },
  { value: 'Sri Lanka', label: 'Sri Lanka' },
]

const CURRENCIES = [
  { value: 'INR', label: 'INR — Indian rupee' },
  { value: 'AED', label: 'AED — UAE dirham' },
  { value: 'SGD', label: 'SGD — Singapore dollar' },
  { value: 'GBP', label: 'GBP — Pound sterling' },
  { value: 'USD', label: 'USD — US dollar' },
  { value: 'NPR', label: 'NPR — Nepalese rupee' },
  { value: 'BDT', label: 'BDT — Taka' },
  { value: 'LKR', label: 'LKR — Sri Lankan rupee' },
]

const STATES = [
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

/** The Indian financial year runs from 1 April to 31 March. */
function indianFinancialYear(today: Date): { start: string; end: string } {
  const year = today.getFullYear()
  const startsThisYear = today.getMonth() >= 3
  const startYear = startsThisYear ? year : year - 1
  return {
    start: `${startYear}-04-01`,
    end: `${startYear + 1}-03-31`,
  }
}

const defaultYear = indianFinancialYear(new Date())

const step = ref<1 | 2>(1)
const submitting = ref(false)
const submitError = ref<string | null>(null)

const name = ref('')
const country = ref('India')
const state = ref('')
const baseCurrency = ref('INR')
const fiscalYearStart = ref(defaultYear.start)
const fiscalYearEnd = ref(defaultYear.end)

const legalName = ref('')
const gstin = ref('')
const pan = ref('')
const address = ref('')
const phone = ref('')
const email = ref('')
const industry = ref('')

const errors = ref<Record<string, string>>({})

const isIndian = computed(() => country.value === 'India')

const stateOptions = computed(() => [{ value: '', label: 'Select a state' }, ...STATES])

function validateStepOne(): boolean {
  const found: Record<string, string> = {}

  if (!name.value.trim()) {
    found.name = 'The trading name is required.'
  } else if (name.value.trim().length < 2) {
    found.name = 'The trading name must be at least two characters.'
  }

  if (!country.value) found.country = 'The country is required.'
  if (!state.value.trim()) found.state = 'The state or jurisdiction is required.'

  if (!baseCurrency.value) found.baseCurrency = 'The base currency is required.'

  if (!fiscalYearStart.value) {
    found.fiscalYearStart = 'The first day of the financial year is required.'
  }
  if (!fiscalYearEnd.value) {
    found.fiscalYearEnd = 'The last day of the financial year is required.'
  }
  if (fiscalYearStart.value && fiscalYearEnd.value) {
    const start = new Date(fiscalYearStart.value)
    const end = new Date(fiscalYearEnd.value)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      found.fiscalYearEnd = 'The dates could not be read.'
    } else if (end <= start) {
      found.fiscalYearEnd = 'The last day must come after the first day.'
    } else if ((end.getTime() - start.getTime()) / 86_400_000 > 366) {
      found.fiscalYearEnd = 'A financial year cannot be longer than a year.'
    }
  }

  errors.value = found
  return Object.keys(found).length === 0
}

function validateStepTwo(): boolean {
  const found: Record<string, string> = {}

  const cleanGstin = gstin.value.replace(/\s/g, '').toUpperCase()
  if (cleanGstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(cleanGstin)) {
    found.gstin = 'A GSTIN is 15 characters, in the form 22AAAAA0000A1Z5.'
  }

  const cleanPan = pan.value.replace(/\s/g, '').toUpperCase()
  if (cleanPan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(cleanPan)) {
    found.pan = 'A PAN is 10 characters, in the form ABCDE1234F.'
  }

  if (email.value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) {
    found.email = 'That does not look like an email address.'
  }

  errors.value = found
  return Object.keys(found).length === 0
}

function goToStepTwo() {
  if (!validateStepOne()) return
  step.value = 2
}

async function submit() {
  if (!validateStepTwo()) return
  submitting.value = true
  submitError.value = null
  try {
    const company = await session.createCompany({
      name: name.value.trim(),
      legalName: legalName.value.trim() || undefined,
      country: country.value,
      state: state.value.trim(),
      baseCurrency: baseCurrency.value,
      fiscalYearStart: fiscalYearStart.value,
      fiscalYearEnd: fiscalYearEnd.value,
      gstin: gstin.value.replace(/\s/g, '').toUpperCase() || undefined,
      pan: pan.value.replace(/\s/g, '').toUpperCase() || undefined,
      address: address.value.trim() || undefined,
      phone: phone.value.trim() || undefined,
      email: email.value.trim() || undefined,
      industry: industry.value.trim() || undefined,
    })
    toast.success(`${company.name} is ready`, 'The company was created and the books are open.')
    await router.push('/')
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'The company could not be created.'
    submitError.value = message
    toast.error('The company was not created', message)
  } finally {
    submitting.value = false
  }
}

const createdAutomatically = [
  'The company record, with the name, place and currency you chose.',
  'One financial year, with the dates you set, open and ready to post into.',
  'Opening balances of zero. Nothing is carried in silently.',
]

const notAssumed = [
  {
    title: 'No statutory tax rates',
    detail:
      'CGST, SGST, IGST and TDS are not pre-populated. A rate that is wrong is worse than a rate that is missing, so each one has to be confirmed before it is used.',
  },
  {
    title: 'No default chart of accounts',
    detail:
      'The demo repository does not create a set of account groups yet, so a company made here starts with no ledgers. The default groups arrive with the local database milestone.',
  },
  {
    title: 'No opening balances',
    detail:
      'The books start at zero. Balances carried forward from another system are entered by you, on the ledger itself, where each one can be seen.',
  },
  {
    title: 'No user accounts',
    detail:
      'The workspace runs in single-user local mode. Accounts and roles arrive with the local database and LAN multi-user milestone.',
  },
]
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      title="Create a company"
      subtitle="Set up a new set of books"
      icon="domain_add"
      :breadcrumb="[{ label: 'Companies', to: '/' }, { label: 'Create a company' }]"
    />

    <div class="min-h-0 flex-1 overflow-auto p-space-lg">
      <div class="mx-auto grid max-w-[1180px] grid-cols-1 items-start gap-space-md lg:grid-cols-3">
        <!-- Form -->
        <div class="lg:col-span-2">
          <!-- Stepper -->
          <ol class="flex items-center gap-space-sm" aria-label="Company setup steps">
            <li v-for="item in 2" :key="item" class="flex items-center gap-space-sm">
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
                {{ item === 1 ? 'The essentials' : 'Optional details' }}
              </span>
              <MaterialIcon
                v-if="item < 2"
                name="chevron_right"
                :size="16"
                class="text-outline-variant"
                aria-hidden="true"
              />
            </li>
          </ol>

          <p
            v-if="submitError"
            class="mt-space-md flex items-start gap-space-sm rounded-md border-l-4 border-l-error bg-error-container p-space-sm text-body-sm text-on-error-container"
            role="alert"
          >
            <MaterialIcon name="error" :size="18" class="mt-0.5 shrink-0" />
            {{ submitError }}
          </p>

          <!-- Step one -->
          <form
            v-if="step === 1"
            class="mt-space-md rounded-md bg-surface-container-lowest p-space-md shadow-sm"
            novalidate
            @submit.prevent="goToStepTwo"
          >
            <h2 class="text-headline-sm text-on-surface">The essentials</h2>
            <p class="mt-0.5 text-label-sm text-outline">
              Everything on this step is required. It decides the currency, the place of business
              and the period the books run in.
            </p>

            <div class="mt-space-md grid grid-cols-1 gap-space-md sm:grid-cols-2">
              <BaseInput
                v-model="name"
                label="Trading name"
                required
                :error="errors.name"
                placeholder="The name the business trades under"
                class="sm:col-span-2"
              />
              <BaseSelect
                v-model="country"
                label="Country"
                required
                :options="COUNTRIES"
                :error="errors.country"
                hint="India is the default because the tax rules in this edition are the Indian ones."
              />
              <BaseSelect
                v-if="isIndian"
                v-model="state"
                label="State"
                required
                :options="stateOptions"
                :error="errors.state"
                hint="The state decides whether a supply is intra-state or inter-state."
              />
              <BaseInput
                v-else
                v-model="state"
                label="State or jurisdiction"
                required
                :error="errors.state"
                hint="The place the business is registered in."
              />
              <BaseSelect
                v-model="baseCurrency"
                label="Base currency"
                required
                :options="CURRENCIES"
                :error="errors.baseCurrency"
                hint="Every amount in the books is kept in this currency."
              />
              <BaseInput
                v-model="fiscalYearStart"
                type="date"
                label="Financial year starts"
                required
                :error="errors.fiscalYearStart"
                hint="The Indian financial year runs from 1 April to 31 March."
              />
              <BaseInput
                v-model="fiscalYearEnd"
                type="date"
                label="Financial year ends"
                required
                :error="errors.fiscalYearEnd"
              />
            </div>

            <div class="mt-space-md flex items-center justify-between gap-2">
              <BaseButton size="sm" variant="text" icon="restart_alt" @click="step = 1">
                Reset the dates
              </BaseButton>
              <BaseButton size="sm" variant="primary" icon="arrow_forward" type="submit">
                Continue
              </BaseButton>
            </div>
          </form>

          <!-- Step two -->
          <form
            v-else
            class="mt-space-md rounded-md bg-surface-container-lowest p-space-md shadow-sm"
            novalidate
            @submit.prevent="submit"
          >
            <h2 class="text-headline-sm text-on-surface">Optional details</h2>
            <p class="mt-0.5 text-label-sm text-outline">
              These are used on invoices, on the tax reports and on the company record. The company
              can be created without them and filled in later.
            </p>

            <div class="mt-space-md grid grid-cols-1 gap-space-md sm:grid-cols-2">
              <BaseInput
                v-model="legalName"
                label="Legal name"
                placeholder="The registered name of the business"
                class="sm:col-span-2"
                :error="errors.legalName"
              />
              <BaseInput
                v-model="gstin"
                label="GSTIN"
                placeholder="22AAAAA0000A1Z5"
                :error="errors.gstin"
                hint="Fifteen characters. Left blank if the business is not registered for GST."
              />
              <BaseInput
                v-model="pan"
                label="PAN"
                placeholder="ABCDE1234F"
                :error="errors.pan"
              />
              <BaseInput
                v-model="industry"
                label="Industry"
                placeholder="Retail, manufacturing, services…"
                :error="errors.industry"
              />
              <BaseInput
                v-model="phone"
                label="Phone"
                :error="errors.phone"
              />
              <BaseInput
                v-model="email"
                label="Email"
                type="email"
                :error="errors.email"
              />
              <BaseInput
                v-model="address"
                label="Address"
                class="sm:col-span-2"
                :error="errors.address"
              />
            </div>

            <div class="mt-space-md flex items-center justify-between gap-2">
              <BaseButton size="sm" variant="text" icon="arrow_back" @click="step = 1">
                Back
              </BaseButton>
              <BaseButton size="sm" variant="primary" icon="domain_add" type="submit" :loading="submitting">
                Create the company
              </BaseButton>
            </div>
          </form>
        </div>

        <!-- Side panel -->
        <aside class="space-y-space-md">
          <section class="rounded-md bg-surface-container-lowest p-space-md shadow-sm">
            <h2 class="flex items-center gap-1.5 text-headline-sm text-on-surface">
              <MaterialIcon name="auto_awesome" :size="18" class="text-primary" />
              Created automatically
            </h2>
            <ul class="mt-space-md space-y-2">
              <li
                v-for="item in createdAutomatically"
                :key="item"
                class="flex items-start gap-2 text-body-sm text-on-surface-variant"
              >
                <MaterialIcon name="check_circle" :size="15" class="mt-0.5 shrink-0 text-secondary" />
                {{ item }}
              </li>
            </ul>
          </section>

          <section class="rounded-md bg-surface-container-lowest p-space-md shadow-sm">
            <h2 class="flex items-center gap-1.5 text-headline-sm text-on-surface">
              <MaterialIcon name="do_not_touch" :size="18" class="text-tertiary" />
              Deliberately not assumed
            </h2>
            <p class="mt-0.5 text-label-sm text-outline">
              Some things are left to you on purpose, because a wrong default is harder to spot
              than a missing one.
            </p>
            <ul class="mt-space-md space-y-3">
              <li v-for="item in notAssumed" :key="item.title">
                <p class="text-label-md font-semibold text-on-surface">{{ item.title }}</p>
                <p class="mt-0.5 text-label-sm text-on-surface-variant">{{ item.detail }}</p>
              </li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  </div>
</template>
