<script setup lang="ts">
import { computed } from 'vue'

import BaseButton from '@/components/ui/BaseButton.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import type { Voucher, VoucherEntry } from '@/domain/types'
import { formatMoney } from '@/lib/money'
import { useSessionStore } from '@/stores/session'

const props = withDefaults(
  defineProps<{
    open: boolean
    /** The journal that will be posted. */
    journal: { voucher: Voucher; entries: VoucherEntry[] } | null
    /** Why the run could not be posted, when it could not be. */
    reason?: string
    posting?: boolean
  }>(),
  { reason: '', posting: false },
)

const emit = defineEmits<{ close: []; post: [] }>()

const session = useSessionStore()
const currency = computed(() => session.activeCompany?.baseCurrency ?? 'INR')

const lines = computed(() =>
  (props.journal?.entries ?? []).map((entry) => ({
    ledger:
      session.ledgers.find((ledger) => ledger.id === entry.ledgerId)?.name ?? 'Unknown ledger',
    debit: entry.debit,
    credit: entry.credit,
  })),
)
</script>

<template>
  <BaseModal
    :open="open"
    title="Post this payroll"
    description="The salary is written to the books as a journal voucher"
    size="lg"
    @close="emit('close')"
  >
    <div class="space-y-space-md">
      <p class="text-body-md text-on-surface-variant">
        {{ journal?.voucher.narration }}
      </p>
      <div class="overflow-hidden rounded-sm border border-surface-container">
        <table class="w-full border-collapse text-body-sm">
          <thead class="bg-surface-container-low text-outline">
            <tr>
              <th scope="col" class="px-space-md py-2 text-left text-label-xs uppercase tracking-wider">
                Ledger
              </th>
              <th
                scope="col"
                class="px-space-md py-2 text-right text-label-xs uppercase tracking-wider tabular"
              >
                Debit
              </th>
              <th
                scope="col"
                class="px-space-md py-2 text-right text-label-xs uppercase tracking-wider tabular"
              >
                Credit
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-surface-container-low">
            <tr v-for="line in lines" :key="line.ledger">
              <td class="px-space-md py-1.5 text-on-surface">{{ line.ledger }}</td>
              <td class="px-space-md py-1.5 text-right text-on-surface tabular">
                {{ line.debit ? formatMoney(line.debit, currency) : '—' }}
              </td>
              <td class="px-space-md py-1.5 text-right text-on-surface tabular">
                {{ line.credit ? formatMoney(line.credit, currency) : '—' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="rounded-sm bg-surface-container-low p-space-sm">
        <p class="text-label-sm text-on-surface-variant">
          Posting writes the journal, its entries and the state of the run in one transaction. It
          obeys the same period locks as every other voucher, and it cannot be undone from this
          screen.
        </p>
      </div>
      <div v-if="reason" class="rounded-sm bg-error-container p-space-sm">
        <p class="text-label-sm text-on-error-container">{{ reason }}</p>
      </div>
    </div>

    <template #footer>
      <BaseButton variant="text" @click="emit('close')">Cancel</BaseButton>
      <BaseButton
        variant="primary"
        icon="send"
        :loading="posting"
        :disabled="!journal"
        @click="emit('post')"
      >
        Post the payroll
      </BaseButton>
    </template>
  </BaseModal>
</template>
