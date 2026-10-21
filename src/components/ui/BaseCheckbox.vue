<script setup lang="ts">
import { computed } from 'vue'

import { cn } from '@/lib/cn'

const props = withDefaults(
  defineProps<{
    label?: string
    description?: string
    disabled?: boolean
    indeterminate?: boolean
  }>(),
  { disabled: false, indeterminate: false },
)

const model = defineModel<boolean>({ default: false })

const classes = computed(() =>
  cn(
    'size-4 shrink-0 rounded-xs border transition-colors',
    props.disabled && 'cursor-not-allowed opacity-50',
    model.value || props.indeterminate
      ? 'border-primary bg-primary text-on-primary'
      : 'border-outline bg-surface-container-lowest hover:border-primary',
  ),
)
</script>

<template>
  <label
    class="flex cursor-pointer items-start gap-space-sm text-body-md text-on-surface"
    :class="disabled && 'cursor-not-allowed'"
  >
    <span class="relative mt-0.5 flex items-center">
      <input
        v-model="model"
        type="checkbox"
        class="peer sr-only"
        :disabled="disabled"
        :indeterminate="indeterminate"
      />
      <span :class="classes" aria-hidden="true">
        <span
          v-if="indeterminate && !model"
          class="material-symbols-outlined"
          style="font-size: 13px"
        >
          remove
        </span>
        <span v-else-if="model" class="material-symbols-outlined" style="font-size: 13px">
          check
        </span>
      </span>
    </span>
    <span class="min-w-0">
      <span class="block leading-5">{{ label }}</span>
      <span v-if="description" class="block text-label-sm text-outline">{{ description }}</span>
    </span>
  </label>
</template>
