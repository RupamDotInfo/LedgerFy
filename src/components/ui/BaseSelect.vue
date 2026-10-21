<script setup lang="ts">
import { computed } from 'vue'

import { cn } from '@/lib/cn'

interface Option {
  value: string | number
  label: string
  disabled?: boolean
}

const props = withDefaults(
  defineProps<{
    label?: string
    options: Option[]
    placeholder?: string
    error?: string
    hint?: string
    disabled?: boolean
    required?: boolean
    size?: 'sm' | 'md'
    name?: string
  }>(),
  { size: 'md' },
)

const model = defineModel<string | number | null>({ default: null })

const control = computed(() =>
  cn(
    'w-full appearance-none rounded-sm text-on-surface',
    'transition-[background-color,box-shadow] duration-100',
    'focus:outline-none focus:ring-2 focus:ring-primary',
    'disabled:cursor-not-allowed disabled:text-outline',
    props.error ? 'bg-surface-container-low ring-1 ring-error' : 'bg-surface-container-low',
    props.size === 'sm' ? 'h-7 pl-space-sm pr-6 text-label-sm' : 'h-8 pl-space-sm pr-7 text-body-md',
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
      <select
        v-model="model"
        :disabled="disabled"
        :name="name"
        :class="control"
        :aria-invalid="error ? 'true' : undefined"
      >
        <option v-if="placeholder" :value="null" disabled>{{ placeholder }}</option>
        <option
          v-for="option in options"
          :key="option.value"
          :value="option.value"
          :disabled="option.disabled"
        >
          {{ option.label }}
        </option>
      </select>
      <span
        class="material-symbols-outlined pointer-events-none absolute right-space-sm text-outline"
        style="font-size: 16px"
        aria-hidden="true"
      >
        arrow_drop_down
      </span>
    </div>

    <p v-if="error" class="text-label-xs font-semibold text-error">{{ error }}</p>
    <p v-else-if="hint" class="text-label-xs text-outline">{{ hint }}</p>
  </div>
</template>
