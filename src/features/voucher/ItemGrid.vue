<script setup lang="ts">
import { computed } from 'vue'

import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import { useSessionStore } from '@/stores/session'
import { formatMoney } from '@/lib/money'
import { fromQuantity, lineValue, toQuantity } from '@/domain/quantity'
import type { DraftItemRow } from '@/features/voucher/useVoucherDraft'

const props = defineProps<{
  rows: DraftItemRow[]
  taxLines: Array<{ taxCategoryId: string; taxable: number; amount: number }>
  /** Tax amount per row id, computed by the domain layer. */
  lineTaxes: Record<string, number>
}>()

const emit = defineEmits<{
  'update:rows': [DraftItemRow[]]
  add: []
  remove: [id: string]
  'apply-defaults': [row: DraftItemRow]
}>()

const session = useSessionStore()

const currency = computed(() => session.activeCompany?.baseCurrency ?? 'INR')

const unitName = (unitId: string): string =>
  session.units.find((unit) => unit.id === unitId)?.name ?? ''

function update(id: string, patch: Partial<DraftItemRow>) {
  emit(
    'update:rows',
    props.rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
  )
}

function onItemChange(row: DraftItemRow) {
  emit('apply-defaults', row)
}
</script>

<template>
  <div class="overflow-hidden rounded-md bg-surface-container-lowest shadow-md">
    <div class="flex flex-wrap items-center justify-between gap-space-sm bg-surface-container-low px-space-lg py-space-xs">
      <div class="flex items-center gap-space-sm">
        <span class="text-label-xs font-bold uppercase tracking-wider text-on-surface">
          Itemized Tax Matrix
        </span>
        <span class="rounded-sm bg-surface-container-high px-1.5 py-0.2 text-label-xs text-outline">
          {{ rows.length }} Active {{ rows.length === 1 ? 'Item' : 'Items' }}
        </span>
      </div>
      <div class="flex items-center gap-space-sm">
        <button
          type="button"
          class="flex items-center gap-1 text-label-xs font-bold text-primary hover:underline"
          @click="emit('add')"
        >
          <MaterialIcon name="add" :size="14" />
          <span>Add Item (Enter)</span>
        </button>
        <span class="text-outline-variant" aria-hidden="true">·</span>
        <span class="text-label-xs text-on-surface-variant">Ctrl+D removes a row</span>
      </div>
    </div>

    <div class="overflow-x-auto">
      <table class="w-full min-w-[1080px] border-collapse text-left">
        <thead>
          <tr class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline">
            <th class="w-16 py-2 px-space-sm text-center">#</th>
            <th class="min-w-[260px] py-2 px-space-md">Item Description / Particulars</th>
            <th class="w-24 py-2 px-space-sm">HSN / SAC</th>
            <th class="w-44 py-2 px-space-sm">Batch &amp; Godown</th>
            <th class="w-24 py-2 px-space-sm text-right">Qty</th>
            <th class="w-16 py-2 px-space-sm text-center">Unit</th>
            <th class="w-28 py-2 px-space-sm text-right">Rate ({{ currency === 'INR' ? '₹' : currency }})</th>
            <th class="w-20 py-2 px-space-sm text-right">Disc</th>
            <th class="w-32 py-2 px-space-sm text-right">Taxable Value</th>
            <th class="w-28 py-2 px-space-sm text-center">GST</th>
            <th class="w-36 py-2 px-space-md text-right">Total Amount</th>
            <th class="w-10 py-2 px-space-sm" />
          </tr>
        </thead>

        <tbody class="divide-y divide-surface-container text-body-sm text-on-surface">
          <tr
            v-for="(row, index) in rows"
            :key="row.id"
            class="group transition-colors hover:bg-surface-container-low/60"
          >
            <td class="py-2 px-space-sm text-center text-numeric-sm text-outline">{{ index + 1 }}</td>

            <td class="py-2 px-space-md">
              <select
                :value="row.itemId"
                class="w-full rounded-sm bg-surface-container-lowest px-space-sm py-1 text-body-sm font-semibold text-on-surface shadow-sm focus:ring-2 focus:ring-primary focus:outline-none"
                @change="
                  update(row.id, { itemId: ($event.target as HTMLSelectElement).value });
                  onItemChange(row)
                "
              >
                <option value="">Select an item…</option>
                <option v-for="item in session.items" :key="item.id" :value="item.id">
                  {{ item.name }}
                </option>
              </select>
            </td>

            <td class="py-2 px-space-sm">
              <span class="num text-numeric-sm text-on-surface-variant">
                {{
                  session.items.find((item) => item.id === row.itemId)?.hsn ?? '—'
                }}
              </span>
            </td>

            <td class="py-2 px-space-sm">
              <select
                :value="row.godownId ?? ''"
                class="w-full rounded-sm bg-surface-container-lowest px-1 py-1 text-numeric-sm text-on-surface focus:ring-2 focus:ring-primary focus:outline-none"
                @change="update(row.id, { godownId: ($event.target as HTMLSelectElement).value || null })"
              >
                <option value="">—</option>
                <option v-for="godown in session.godowns" :key="godown.id" :value="godown.id">
                  {{ godown.name }}
                </option>
              </select>
            </td>

            <td class="py-2 px-space-sm text-right">
              <input
                :value="fromQuantity(row.quantityMilli)"
                type="number"
                min="0"
                step="0.001"
                class="num w-full rounded-sm bg-surface-container-lowest px-1 py-1 text-right text-numeric-sm font-bold text-on-surface focus:ring-2 focus:ring-primary focus:outline-none"
                @input="
                  update(row.id, {
                    quantityMilli: toQuantity(Number(($event.target as HTMLInputElement).value) || 0),
                  })
                "
              />
            </td>

            <td class="py-2 px-space-sm text-center">
              <span class="text-label-xs text-outline">
                {{
                  unitName(
                    session.items.find((item) => item.id === row.itemId)?.unitId ?? '',
                  )
                }}
              </span>
            </td>

            <td class="py-2 px-space-sm text-right">
              <input
                :value="(row.rate / 100).toFixed(2)"
                type="text"
                inputmode="decimal"
                class="num w-full rounded-sm bg-surface-container-lowest px-1 py-1 text-right text-numeric-sm text-on-surface focus:ring-2 focus:ring-primary focus:outline-none"
                @input="
                  update(row.id, {
                    rate: Math.round(Number(($event.target as HTMLInputElement).value.replace(/[^0-9.]/g, '')) * 100) || 0,
                  })
                "
              />
            </td>

            <td class="py-2 px-space-sm text-right">
              <input
                :value="(row.discount / 100).toFixed(2)"
                type="text"
                inputmode="decimal"
                class="num w-full rounded-sm bg-surface-container-lowest px-1 py-1 text-right text-numeric-sm text-tertiary focus:ring-2 focus:ring-primary focus:outline-none"
                @input="
                  update(row.id, {
                    discount: Math.round(Number(($event.target as HTMLInputElement).value.replace(/[^0-9.]/g, '')) * 100) || 0,
                  })
                "
              />
            </td>

            <td class="py-2 px-space-sm text-right text-numeric-sm font-semibold text-outline">
              {{
                formatMoney(
                  lineValue(row.quantityMilli, row.rate) - row.discount,
                  currency,
                )
              }}
            </td>

            <td class="py-2 px-space-sm text-center">
              <select
                :value="row.taxCategoryId ?? ''"
                class="w-full rounded-sm bg-surface-container px-1 py-1 text-label-xs font-bold text-on-surface focus:ring-2 focus:ring-primary focus:outline-none"
                aria-label="Tax rate for this line"
                @change="update(row.id, { taxCategoryId: ($event.target as HTMLSelectElement).value || null })"
              >
                <option value="">None</option>
                <option
                  v-for="category in session.taxCategories"
                  :key="category.id"
                  :value="category.id"
                >
                  {{ category.name }}
                </option>
              </select>
            </td>

            <td class="py-2 px-space-md text-right text-numeric-sm font-bold text-on-surface">
              {{
                formatMoney(
                  lineValue(row.quantityMilli, row.rate) - row.discount + (lineTaxes[row.id] ?? 0),
                  currency,
                )
              }}
            </td>

            <td class="py-2 px-space-sm text-center">
              <button
                type="button"
                class="text-outline opacity-0 transition-opacity hover:text-tertiary group-hover:opacity-100"
                :aria-label="`Remove ${session.items.find((item) => item.id === row.itemId)?.name ?? 'row'}`"
                @click="emit('remove', row.id)"
              >
                <MaterialIcon name="close" :size="16" />
              </button>
            </td>
          </tr>

          <tr v-if="!rows.length" class="bg-surface-container-low/40">
            <td colspan="12" class="px-space-md py-8 text-center text-body-sm text-outline">
              No item lines yet. Use <span class="kbd">Add Item</span> to start the invoice.
            </td>
          </tr>
        </tbody>

        <tfoot v-if="rows.length" class="bg-surface-container-low">
          <tr>
            <td colspan="8" class="py-2 px-space-md text-label-sm font-bold uppercase text-on-surface-variant">
              Taxable value
            </td>
            <td class="num py-2 px-space-sm text-right text-numeric-sm font-bold text-on-surface">
              {{
                formatMoney(
                  rows.reduce(
                    (sum, row) => sum + lineValue(row.quantityMilli, row.rate) - row.discount,
                    0,
                  ),
                  currency,
                )
              }}
            </td>
            <td class="py-2 px-space-sm text-center text-label-xs text-outline">
              {{ taxLines.length }} rate{{ taxLines.length === 1 ? '' : 's' }}
            </td>
            <td class="num py-2 px-space-md text-right text-numeric-sm font-bold text-on-surface">
              {{
                formatMoney(
                  rows.reduce(
                    (sum, row) => sum + lineValue(row.quantityMilli, row.rate) - row.discount,
                    0,
                  ) + rows.reduce((sum, row) => sum + (lineTaxes[row.id] ?? 0), 0),
                  currency,
                )
              }}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
</template>
