<script setup lang="ts">
import { computed } from 'vue'

import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import { useSessionStore } from '@/stores/session'
import { formatMoney } from '@/lib/money'
import { amountInWords } from '@/lib/words'

const props = defineProps<{
  gross: number
  discount: number
  taxable: number
  taxTotal: number
  grandTotal: number
  taxLines: Array<{ taxCategoryId: string; taxable: number; amount: number }>
  isBalanced: boolean
  difference: number
}>()

const session = useSessionStore()
const currency = computed(() => session.activeCompany?.baseCurrency ?? 'INR')

const taxDetail = computed(() =>
  props.taxLines.map((line) => {
    const category = session.taxCategories.find((candidate) => candidate.id === line.taxCategoryId)
    return {
      id: line.taxCategoryId,
      name: category?.name ?? 'Tax',
      rate: category?.rate ?? 0,
      taxable: line.taxable,
      amount: line.amount,
    }
  }),
)
</script>

<template>
  <div class="rounded-md bg-surface-container-lowest p-space-md shadow-md">
    <div
      class="flex items-center justify-between border-b border-surface-container pb-space-xs"
    >
      <span class="text-label-md font-bold uppercase tracking-wide text-on-surface">
        Tax Breakdown (GST)
      </span>
      <span class="rounded-sm bg-surface-container px-2 py-0.5 text-label-xs font-semibold text-outline">
        Ledger Group: Sales GST
      </span>
    </div>

    <div class="space-y-1.5 text-numeric-md">
      <div class="flex items-center justify-between text-on-surface-variant">
        <span>Gross Taxable Amount:</span>
        <span class="font-semibold text-on-surface">{{ formatMoney(gross, currency) }}</span>
      </div>
      <div class="flex items-center justify-between text-tertiary">
        <span class="flex items-center gap-1">
          <span>Trade Discount (Consolidated):</span>
          <span
            v-if="discount !== 0"
            class="rounded-sm bg-tertiary-fixed px-1 text-on-tertiary-fixed"
          >
            -{{ formatMoney(discount, currency) }}
          </span>
        </span>
        <span class="font-semibold">
          {{ discount === 0 ? formatMoney(0, currency) : formatMoney(-discount, currency) }}
        </span>
      </div>
      <div class="flex items-center justify-between border-t border-surface-container pt-1 text-on-surface">
        <span class="font-semibold">Net Taxable Value:</span>
        <span class="font-bold">{{ formatMoney(taxable, currency) }}</span>
      </div>

      <div class="space-y-1 rounded-sm bg-surface-container-low p-space-sm">
        <div
          v-for="tax in taxDetail"
          :key="tax.id"
          class="flex items-center justify-between text-on-surface"
        >
          <span class="flex items-center gap-1">
            <span class="size-1.5 rounded-full bg-primary" aria-hidden="true" />
            {{ tax.name }} @ {{ tax.rate.toFixed(1) }}%:
          </span>
          <span class="font-semibold">{{ formatMoney(tax.amount, currency) }}</span>
        </div>
        <p v-if="!taxDetail.length" class="text-on-surface-variant">
          No tax category is applied to these lines.
        </p>
      </div>

      <div
        class="flex items-center justify-between text-numeric-sm"
        :class="difference === 0 ? 'text-outline' : 'text-tertiary'"
      >
        <span>Balance difference:</span>
        <span class="font-semibold">
          {{ formatMoney(difference, currency, { signed: true }) }}
        </span>
      </div>
    </div>

    <div
      class="mt-space-sm space-y-space-xs rounded-md bg-inverse-surface p-space-md text-inverse-on-surface shadow-lg"
    >
      <div class="flex items-center justify-between">
        <span class="text-label-xs font-bold uppercase tracking-wider text-outline-variant">
          Total Invoice Value
        </span>
        <span
          class="rounded-sm px-2 py-0.5 text-label-xs font-bold"
          :class="
            isBalanced
              ? 'bg-secondary text-on-secondary'
              : 'bg-tertiary-container text-on-tertiary-container'
          "
        >
          {{ isBalanced ? 'BALANCED' : 'UNBALANCED' }}
        </span>
      </div>
      <div class="flex items-baseline justify-between">
        <span class="num text-numeric-lg font-bold text-secondary-container">
          {{ formatMoney(grandTotal, currency) }}
        </span>
        <span class="text-label-xs text-surface-variant">{{ currency }} Currency</span>
      </div>
      <div
        class="border-t border-surface-container-highest/20 pt-space-xs text-body-sm leading-snug text-surface-container-high"
      >
        <span class="font-semibold text-outline-variant">In Words:</span>
        {{ amountInWords(grandTotal, currency) }}
      </div>
      <p v-if="!isBalanced" class="flex items-center gap-1 text-label-xs text-tertiary-fixed">
        <MaterialIcon name="warning" :size="13" />
        Debits and credits do not agree yet. The voucher cannot be posted.
      </p>
    </div>
  </div>
</template>
