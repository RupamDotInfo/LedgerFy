<script setup lang="ts">
import type { Component } from 'vue'

import { cn } from '@/lib/cn'

const props = withDefaults(
  defineProps<{
    title: string
    description?: string
    icon?: Component
    size?: 'sm' | 'md'
    class?: string
  }>(),
  { size: 'md' },
)
</script>

<template>
  <div
    class="flex flex-col items-center justify-center gap-2 px-6 text-center"
    :class="cn(size === 'sm' ? 'py-8' : 'py-12', props.class)"
  >
    <div
      v-if="icon"
      class="flex size-11 items-center justify-center rounded-full bg-surface-container text-on-surface-variant"
    >
      <component :is="icon" :size="19" aria-hidden="true" />
    </div>
    <p class="text-body-md font-semibold text-on-surface">{{ title }}</p>
    <p v-if="description" class="max-w-sm text-label-sm leading-relaxed text-outline">
      {{ description }}
    </p>
    <div v-if="$slots.default" class="mt-1 flex items-center gap-2">
      <slot />
    </div>
  </div>
</template>
