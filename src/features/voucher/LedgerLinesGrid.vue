<script setup lang="ts">
import { computed } from 'vue'

import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import { useSessionStore } from '@/stores/session'
import { formatMoney } from '@/lib/money'
import type { DraftLedgerRow } from '@/features/voucher/useVoucherDraft'

const props = defineProps<{ rows: DraftLedgerRow[]; difference: number }>()

const emit = defineEmits<{
  'update:rows': [DraftLedgerRow[]]
  add: []
  remove: [id: string]
}>()

const session = useSessionStore()
const currency = computed(() => session.activeCompany?.baseCurrency ?? 'INR')

function update(id: string, patch: Partial<DraftLedgerRow>) {
  emit(
    'update:rows',
    props.rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
  )
}
</script>

<template>
  <div class="overflow-hidden rounded-md bg-surface-container-lowest shadow-md">
    <div
      class="flex flex-wrap items-center justify-between gap-space-sm bg-surface-container-low px-space-lg py-space-xs"
    >
      <span class="text-label-xs font-bold uppercase tracking-wider text-on-surface">
        Ledger Allocation
      </span>
      <button
        type="button"
        class="flex items-center gap-1 text-label-xs font-bold text-primary hover:underline"
        @click="emit('add')"
      >
        <MaterialIcon name="add" :size="14" />
        <span>Add Line (Alt+A)</span>
      </button>
    </div>

    <div class="overflow-x-auto">
      <table class="w-full min-w-[1080px] border-collapse text-left">
        <thead>
          <tr class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline">
            <th class="w-8 py-2 text-center">#</th>
            <th class="min-w-[280px] py-2 px-space-md">Ledger</th>
            <th class="w-40 py-2 px-space-sm text-right">Debit</th>
            <th class="w-40 py-2 px-space-sm text-right">Credit</th>
            <th class="w-10 py-2 px-space-sm" />
          </tr>
        </thead>
        <tbody class="divide-y divide-surface-container text-body-sm text-on-surface">
          <tr v-for="(row, index) in rows" :key="row.id" class="group hover:bg-surface-container-low/60">
            <td class="py-2 px-space-sm text-center text-numeric-sm text-outline">{{ index + 1 }}</td>
            <td class="py-2 px-space-md">
              <select
                :value="row.ledgerId"
                class="w-full rounded-sm bg-surface-container-lowest px-space-sm py-1 text-body-sm font-semibold text-on-surface shadow-sm focus:ring-2 focus:ring-primary focus:outline-none"
                @change="update(row.id, { ledgerId: ($event.target as HTMLSelectElement).value })"
              >
                <option value="">Select a ledger…</option>
                <option v-for="ledger in session.ledgers" :key="ledger.id" :value="ledger.id">
                  {{ ledger.name }}
                </option>
              </select>
            </td>
            <td class="py-2 px-space-sm text-right">
              <input
                :value="(row.debit / 100).toFixed(2)"
                type="text"
                inputmode="decimal"
                class="num w-full rounded-sm bg-surface-container-lowest px-1 py-1 text-right text-numeric-sm text-on-surface focus:ring-2 focus:ring-primary focus:outline-none"
                @input="
                  update(row.id, {
                    debit: Math.round(Number(($event.target as HTMLInputElement).value.replace(/[^0-9.]/g, '')) * 100) || 0,
                  })
                "
              />
            </td>
            <td class="py-2 px-space-sm text-right">
              <input
                :value="(row.credit / 100).toFixed(2)"
                type="text"
                inputmode="decimal"
                class="num w-full rounded-sm bg-surface-container-lowest px-1 py-1 text-right text-numeric-sm text-on-surface focus:ring-2 focus:ring-primary focus:outline-none"
                @input="
                  update(row.id, {
                    credit: Math.round(Number(($event.target as HTMLInputElement).value.replace(/[^0-9.]/g, '')) * 100) || 0,
                  })
                "
              />
            </td>
            <td class="py-2 px-space-sm text-center">
              <button
                type="button"
                class="text-outline opacity-0 transition-opacity hover:text-tertiary group-hover:opacity-100"
                aria-label="Remove line"
                @click="emit('remove', row.id)"
              >
                <MaterialIcon name="close" :size="16" />
              </button>
            </td>
          </tr>

          <tr v-if="!rows.length" class="bg-surface-container-low/40">
            <td colspan="5" class="px-space-md py-8 text-center text-body-sm text-outline">
              No ledger lines yet. A journal needs at least one debit and one credit.
            </td>
          </tr>
        </tbody>
        <tfoot class="bg-surface-container-low">
          <tr>
            <td colspan="2" class="py-2 px-space-md text-label-sm font-bold uppercase text-on-surface-variant">
              Difference
            </td>
            <td colspan="2" class="num py-2 px-space-sm text-right text-numeric-sm font-bold text-on-surface">
              {{ formatMoney(difference, currency, { signed: true }) }}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
</template>
