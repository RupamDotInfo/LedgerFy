<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCombobox, { type ComboboxOption } from '@/components/ui/BaseCombobox.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import { ledgerClosingBalance } from '@/domain/accounting'
import type { Ledger } from '@/domain/types'
import { useSessionStore } from '@/stores/session'
import { useToastStore } from '@/stores/toast'
import { formatMoney } from '@/lib/money'

const props = withDefaults(
  defineProps<{
    partyId: string | null
    reference: string
    referenceDate: string
    partyKind: 'customer' | 'supplier' | 'both' | null
    creditLimit: number
    /**
     * `party` selects a customer or supplier. `account` settles the
     * transaction directly against a cash or bank account, which is how a
     * cash sale is recorded.
     */
    mode?: 'party' | 'account'
  }>(),
  { mode: 'party' },
)

const emit = defineEmits<{
  'update:partyId': [string | null]
  'update:reference': [string]
}>()

const session = useSessionStore()
const toast = useToastStore()

const createOpen = ref(false)
const newParty = ref({ name: '', phone: '', email: '', gstin: '' })
const createError = ref('')
const closingBalance = ref(0)
const balanceLoading = ref(false)

const party = computed(
  () => session.ledgers.find((ledger) => ledger.id === props.partyId) ?? null,
)

const options = computed<ComboboxOption[]>(() => {
  if (props.mode === 'account') {
    return [...session.cashLedgers, ...session.bankLedgers].map((ledger) => ({
      id: ledger.id,
      label: ledger.name,
      sublabel: ledger.type === 'cash' ? 'Cash' : 'Bank',
      meta: 'Settled directly',
    }))
  }

  return session.partyLedgers
    .filter((ledger) =>
      props.partyKind
        ? ledger.partyKind === props.partyKind || ledger.partyKind === 'both'
        : true,
    )
    .map((ledger) => ({
      id: ledger.id,
      label: ledger.name,
      sublabel: ledger.partyKind === 'customer' ? 'Customer' : 'Supplier',
      meta: ledger.taxNumber ? 'GSTIN on file' : undefined,
    }))
})

const stateCode = computed(() => session.activeCompany?.state ?? 'Not configured')

watch(
  () => props.partyId,
  async (id) => {
    closingBalance.value = 0
    if (!id || !session.activeCompanyId) return
    balanceLoading.value = true
    const vouchers = await session.repository.listVouchers(session.activeCompanyId, { partyId: id })
    const ledger = session.ledgers.find((candidate) => candidate.id === id)
    if (ledger) {
      const entries = vouchers.flatMap((voucher) => voucher.entries)
      closingBalance.value = ledgerClosingBalance(ledger, entries).closing
    }
    balanceLoading.value = false
  },
  { immediate: true },
)

const creditUsed = computed(() =>
  props.creditLimit === 0 ? 0 : Math.min(100, (closingBalance.value / props.creditLimit) * 100),
)

async function createParty() {
  const name = newParty.value.name.trim()
  if (!name) {
    createError.value = 'A party name is required.'
    return
  }
  if (session.ledgers.some((ledger) => ledger.name.toLowerCase() === name.toLowerCase())) {
    createError.value = 'A ledger with this name already exists.'
    return
  }

  const ledger: Ledger = {
    id: `led-party-${Date.now()}`,
    companyId: session.activeCompanyId ?? '',
    name,
    group: props.partyKind === 'supplier' ? 'liabilities' : 'assets',
    type: props.partyKind === 'supplier' ? 'payable' : 'receivable',
    parentId: null,
    openingBalance: 0,
    openingDate: new Date().toISOString().slice(0, 10),
    partyKind: props.partyKind ?? 'customer',
    currency: session.activeCompany?.baseCurrency ?? 'INR',
    phone: newParty.value.phone || undefined,
    email: newParty.value.email || undefined,
    taxNumber: newParty.value.gstin || undefined,
    isSystem: false,
    isActive: true,
    createdAt: new Date().toISOString(),
  }

  await session.repository.saveLedger(ledger)
  await session.loadMasters(session.activeCompanyId ?? '')
  emit('update:partyId', ledger.id)
  createOpen.value = false
  newParty.value = { name: '', phone: '', email: '', gstin: '' }
  createError.value = ''
  toast.success('Party created', `${ledger.name} is now available in the party list.`)
}

function openCreate() {
  createError.value = ''
  createOpen.value = true
}

defineExpose({ openCreate })
</script>

<template>
  <div class="rounded-md bg-surface-container-lowest p-space-md shadow-md">
    <div class="flex flex-wrap items-center justify-between gap-space-md border-b border-surface-container pb-space-sm">
      <div class="flex min-w-[320px] flex-1 items-center gap-space-md">
        <div
          class="flex size-10 items-center justify-center rounded-md bg-primary-fixed text-headline-sm font-bold text-primary"
          aria-hidden="true"
        >
          {{ (party?.name ?? '?').charAt(0).toUpperCase() }}
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-space-sm">
            <span class="text-label-xs font-bold uppercase text-outline">
              {{
                mode === 'account'
                  ? 'Settlement account (direct sale)'
                  : `Party A/c (${partyKind === 'supplier' ? 'Creditor' : 'Debtor'})`
              }}
            </span>
            <BaseBadge v-if="party?.taxNumber" tone="positive" size="xs" icon="verified">
              GSTIN on file
            </BaseBadge>
            <BaseBadge
              v-if="mode === 'account'"
              tone="info"
              size="xs"
              icon="bolt"
            >
              Settled directly
            </BaseBadge>
          </div>
          <div class="mt-0.5 flex items-center gap-space-xs">
            <BaseCombobox
              :model-value="partyId"
              :options="options"
              placeholder="Select a party…"
              class="min-w-[280px] flex-1"
              @update:model-value="emit('update:partyId', $event)"
            />
          </div>
        </div>
        <BaseButton size="sm" variant="neutral" icon="person_add" @click="createOpen = true">
          New Party
          <span class="kbd ml-1">Alt C</span>
        </BaseButton>
      </div>

      <div class="flex items-center gap-space-sm rounded-md bg-surface-container-low px-space-md py-1.5">
        <div class="flex flex-col text-right">
          <span class="text-label-xs text-outline">Order Reference</span>
          <input
            :value="reference"
            class="w-24 bg-transparent text-label-sm font-bold text-on-surface focus:outline-none"
            placeholder="Not set"
            aria-label="Order reference"
            @input="emit('update:reference', ($event.target as HTMLInputElement).value)"
          />
        </div>
        <span class="text-outline-variant" aria-hidden="true">|</span>
        <div class="flex flex-col">
          <span class="text-label-xs text-outline">Dated</span>
          <span class="text-label-sm font-semibold text-on-surface">
            {{ referenceDate ? referenceDate : '—' }}
          </span>
        </div>
        <MaterialIcon name="edit_note" :size="16" class="text-outline" />
      </div>
    </div>

    <div class="grid grid-cols-2 gap-space-md pt-space-xs md:grid-cols-3 lg:grid-cols-6">
      <div class="rounded-sm bg-surface-container-low p-space-xs">
        <span class="block text-label-xs uppercase text-outline">GSTIN / UIN</span>
        <span class="num text-numeric-sm font-bold tracking-wider text-on-surface">
          {{ party?.taxNumber ?? 'Not on file' }}
        </span>
      </div>
      <div class="rounded-sm bg-surface-container-low p-space-xs">
        <span class="block text-label-xs uppercase text-outline">Ledger State</span>
        <span class="text-numeric-sm font-semibold text-on-surface">{{ stateCode }}</span>
      </div>
      <div v-if="mode === 'party'" class="rounded-sm bg-surface-container-low p-space-xs">
        <span class="block text-label-xs uppercase text-outline">Closing Ledger Balance</span>
        <span class="num text-numeric-sm font-bold text-tertiary">
          {{
            balanceLoading
              ? 'Calculating…'
              : `${formatMoney(closingBalance, session.activeCompany?.baseCurrency ?? 'INR')} ${
                  closingBalance >= 0 ? 'Dr' : 'Cr'
                }`
          }}
        </span>
      </div>
      <div v-if="mode === 'party'" class="rounded-sm bg-surface-container-low p-space-xs">
        <div class="flex items-center justify-between">
          <span class="text-label-xs uppercase text-outline">Credit Health</span>
          <span class="text-label-xs font-bold text-secondary">{{ creditUsed.toFixed(0) }}% Used</span>
        </div>
        <span class="num text-numeric-sm font-semibold text-on-surface">
          {{ formatMoney(creditLimit, session.activeCompany?.baseCurrency ?? 'INR') }} Limit
        </span>
      </div>
      <div v-if="mode === 'party'" class="rounded-sm bg-surface-container-low p-space-xs">
        <span class="block text-label-xs uppercase text-outline">Payment Credit Terms</span>
        <span class="text-numeric-sm font-semibold text-on-surface">Net 30 Days</span>
      </div>
      <div class="rounded-sm bg-surface-container-low p-space-xs">
        <span class="block text-label-xs uppercase text-outline">Assigned Price List</span>
        <span class="text-numeric-sm font-bold text-primary">
          {{ session.priceLists.find((list) => list.isDefault)?.name ?? 'None' }}
        </span>
      </div>
    </div>
  </div>

  <BaseModal
    :open="createOpen"
    title="Create a party"
    description="Adds a new ledger to the current company."
    size="md"
    @close="createOpen = false"
  >
    <div class="grid grid-cols-1 gap-space-sm">
      <BaseInput
        v-model="newParty.name"
        label="Party name"
        placeholder="Shree Balaji Hardware"
        required
        :error="createError"
        variant="outlined"
      />
      <BaseInput v-model="newParty.gstin" label="GSTIN" placeholder="24AABCS1429B1ZX" variant="outlined" />
      <div class="grid grid-cols-2 gap-space-sm">
        <BaseInput v-model="newParty.phone" label="Phone" placeholder="+91 79 2685 4412" variant="outlined" />
        <BaseInput v-model="newParty.email" label="Email" placeholder="accounts@party.demo" variant="outlined" />
      </div>
    </div>

    <template #footer>
      <BaseButton variant="text" @click="createOpen = false">Cancel</BaseButton>
      <BaseButton variant="primary" icon="person_add" @click="createParty">Create party</BaseButton>
    </template>
  </BaseModal>
</template>
