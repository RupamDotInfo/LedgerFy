<script setup lang="ts">
import { computed } from 'vue'

import { cn } from '@/lib/cn'

const props = withDefaults(
  defineProps<{
    title?: string
    description?: string
    padded?: boolean
    dense?: boolean
    /** Removes the card radius so the card can sit flush inside a group. */
    flush?: boolean
    class?: string
  }>(),
  { padded: true, dense: false, flush: false },
)

const bodyPadding = computed(() => {
  if (!props.padded) return ''
  return props.dense ? 'p-space-sm' : 'p-space-md'
})
</script>

<template>
  <section
    :class="cn('flex min-h-0 flex-col bg-surface-container-lowest shadow-sm', props.flush ? '' : 'rounded-md', props.class)"
  >
    <header
      v-if="title || $slots.actions || $slots.header"
      class="flex shrink-0 items-center justify-between gap-3 border-b border-surface-container px-space-md py-space-sm"
    >
      <div class="min-w-0">
        <slot name="header">
          <h2 class="truncate text-headline-sm text-on-surface">{{ title }}</h2>
          <p v-if="description" class="mt-0.5 truncate text-label-sm text-outline">
            {{ description }}
          </p>
        </slot>
      </div>
      <div v-if="$slots.actions" class="flex shrink-0 items-center gap-1.5">
        <slot name="actions" />
      </div>
    </header>

    <div :class="cn('min-h-0 flex-1', bodyPadding)">
      <slot />
    </div>

    <footer
      v-if="$slots.footer"
      class="shrink-0 border-t border-surface-container bg-surface-container-low/60 px-space-md py-space-sm"
    >
      <slot name="footer" />
    </footer>
  </section>
</template>
