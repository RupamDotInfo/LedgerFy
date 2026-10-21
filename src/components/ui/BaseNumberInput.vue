<script setup lang="ts">
import { computed } from 'vue'

import { cn } from '@/lib/cn'

const props = withDefaults(
  defineProps<{
    label?: string
    error?: string
    hint?: string
    disabled?: boolean
    required?: boolean
    size?: 'sm' | 'md'
    currency?: string
    align?: 'left' | 'right'
    placeholder?: string
    name?: string
    autofocus?: boolean
    variant?: 'filled' | 'outlined'
  }>(),
  { size: 'md', currency: 'INR', align: 'right', variant: 'filled' },
)

const model = defineModel<string | number | null>({ default: null })

const display = computed({
  get: () => {
    if (model.value === null || model.value === '') return ''
    const numeric = typeof model.value === 'number' ? model.value : Number(model.value)
    if (Number.isNaN(numeric)) return String(model.value)
    return numeric.toFixed(2)
  },
  set: (value: string) => {
    const cleaned = value.replace(/[^0-9.-]/g, '')
    model.value = cleaned === '' ? null : cleaned
  },
})

function onBlur() {
  if (model.value === null || model.value === '') return
  const numeric = Number(model.value)
  if (Number.isNaN(numeric)) {
    model.value = null
    return
  }
  model.value = Number(numeric.toFixed(2))
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <label v-if="label" class="flex items-center gap-1 text-label-sm text-on-surface-variant">
      <span>{{ label }}</span>
      <span v-if="required" class="text-error" aria-hidden="true">*</span>
    </label>

    <div class="relative flex items-center">
      <span
        v-if="currency"
        class="pointer-events-none absolute left-space-sm text-label-sm font-medium text-outline"
      >
        {{ currency === 'INR' ? '₹' : currency }}
      </span>
      <input
        v-model="display"
        type="text"
        inputmode="decimal"
        :name="name"
        :placeholder="placeholder"
        :disabled="disabled"
        :autofocus="autofocus"
        :class="cn(
          'num w-full rounded-sm text-on-surface transition-[background-color,box-shadow] duration-100',
          'focus:outline-none focus:ring-2 focus:ring-primary',
          'disabled:cursor-not-allowed disabled:text-outline',
          props.error ? 'bg-surface-container-low ring-1 ring-error' : 'bg-surface-container-low',
          props.variant === 'outlined' && 'bg-surface-container-lowest shadow-sm',
          size === 'sm' ? 'h-7 text-label-sm' : 'h-8 text-body-md',
          currency ? 'pl-6' : 'pl-space-sm',
          'pr-space-sm',
          align === 'right' ? 'text-right' : 'text-left',
        )"
        @blur="onBlur"
      />
    </div>

    <p v-if="error" class="text-label-xs font-semibold text-error">{{ error }}</p>
    <p v-else-if="hint" class="text-label-xs text-outline">{{ hint }}</p>
  </div>
</template>
