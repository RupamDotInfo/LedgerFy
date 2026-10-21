<script setup lang="ts">
import { computed } from 'vue'

import { cn } from '@/lib/cn'

type Size = 'sm' | 'md'

const props = withDefaults(
  defineProps<{
    label?: string
    placeholder?: string
    error?: string
    hint?: string
    disabled?: boolean
    readonly?: boolean
    required?: boolean
    size?: Size
    type?: 'text' | 'email' | 'password' | 'search' | 'url' | 'date' | 'number'
    prefix?: string
    suffix?: string
    autocomplete?: string
    name?: string
    autofocus?: boolean
    maxlength?: number
    align?: 'left' | 'right' | 'center'
    /** Filled fields use the tonal container colour; outlined fields are white. */
    variant?: 'filled' | 'outlined' | 'tonal'
  }>(),
  { size: 'md', type: 'text', align: 'left', variant: 'filled' },
)

const model = defineModel<string | number>({ default: '' })

const control = computed(() =>
  cn(
    'w-full rounded-sm text-on-surface placeholder:text-outline',
    'transition-[background-color,border-color,box-shadow] duration-100',
    'focus:outline-none focus:ring-2 focus:ring-primary',
    'disabled:cursor-not-allowed disabled:text-outline',
    props.error
      ? 'ring-1 ring-error'
      : 'ring-1 ring-transparent focus:border-primary',
    props.variant === 'filled' && 'bg-surface-container-low',
    props.variant === 'tonal' && 'bg-surface-container-low',
    props.variant === 'outlined' && 'bg-surface-container-lowest shadow-sm',
    props.size === 'sm' ? 'h-7 px-space-sm text-label-sm' : 'h-8 px-space-sm text-body-md',
    props.align === 'right' && 'text-right tabular',
    props.align === 'center' && 'text-center',
  ),
)
</script>

<template>
  <div class="flex flex-col gap-1">
    <label v-if="label" class="flex items-center gap-1 text-label-sm text-on-surface-variant">
      <span>{{ label }}</span>
      <span v-if="required" class="text-error" aria-hidden="true">*</span>
    </label>

    <div class="relative flex items-center">
      <span
        v-if="prefix"
        class="pointer-events-none absolute left-space-sm text-label-sm text-outline"
      >
        {{ prefix }}
      </span>
      <input
        v-model="model"
        :type="type"
        :placeholder="placeholder"
        :disabled="disabled"
        :readonly="readonly"
        :required="required"
        :autocomplete="autocomplete"
        :name="name"
        :maxlength="maxlength"
        :aria-invalid="error ? 'true' : undefined"
        :class="[control, prefix && 'pl-7', suffix && 'pr-8']"
        :style="{ textAlign: align }"
      />
      <span v-if="suffix" class="pointer-events-none absolute right-space-sm text-label-xs text-outline">
        {{ suffix }}
      </span>
    </div>

    <p v-if="error" class="text-label-xs font-semibold text-error">{{ error }}</p>
    <p v-else-if="hint" class="text-label-xs text-outline">{{ hint }}</p>
  </div>
</template>
