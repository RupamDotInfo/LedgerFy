<script setup lang="ts">
import { computed } from 'vue'

import { cn } from '@/lib/cn'

type Tone = 'neutral' | 'info' | 'positive' | 'warning' | 'danger' | 'primary' | 'violet'

const props = withDefaults(
  defineProps<{
    tone?: Tone
    variant?: 'soft' | 'solid' | 'outline'
    dot?: boolean
    size?: 'xs' | 'sm'
    /** Material Symbols ligature shown before the label. */
    icon?: string
  }>(),
  { tone: 'neutral', variant: 'soft', dot: false, size: 'sm' },
)

const tones: Record<Tone, { soft: string; solid: string; outline: string }> = {
  neutral: {
    soft: 'bg-surface-container text-on-surface-variant',
    solid: 'bg-on-surface-variant text-surface-container-lowest',
    outline: 'text-on-surface-variant ring-1 ring-inset ring-outline-variant',
  },
  info: {
    soft: 'bg-primary-fixed text-on-primary-fixed',
    solid: 'bg-primary text-on-primary',
    outline: 'text-primary ring-1 ring-inset ring-primary-border',
  },
  positive: {
    soft: 'bg-secondary-container text-on-secondary-container',
    solid: 'bg-secondary text-on-secondary',
    outline: 'text-secondary ring-1 ring-inset ring-secondary',
  },
  warning: {
    soft: 'bg-tertiary-fixed text-on-tertiary-fixed',
    solid: 'bg-tertiary text-on-tertiary',
    outline: 'text-tertiary ring-1 ring-inset ring-tertiary',
  },
  danger: {
    soft: 'bg-error-container text-on-error-container',
    solid: 'bg-error text-on-error',
    outline: 'text-error ring-1 ring-inset ring-error',
  },
  primary: {
    soft: 'bg-primary-container text-on-primary-container',
    solid: 'bg-primary text-on-primary',
    outline: 'text-primary ring-1 ring-inset ring-primary',
  },
  violet: {
    soft: 'bg-[#efe4fb] text-[#5b2b82]',
    solid: 'bg-[#5b2b82] text-white',
    outline: 'text-[#5b2b82] ring-1 ring-inset ring-[#5b2b82]',
  },
}

const classes = computed(() =>
  cn(
    'inline-flex items-center gap-1 rounded-full font-semibold whitespace-nowrap',
    props.size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-label-xs',
    tones[props.tone][props.variant],
  ),
)
</script>

<template>
  <span :class="classes">
    <span
      v-if="dot"
      class="size-1.5 shrink-0 rounded-full bg-current opacity-80"
      aria-hidden="true"
    />
    <span
      v-else-if="icon"
      class="material-symbols-outlined"
      style="font-size: 13px"
      aria-hidden="true"
    >
      {{ icon }}
    </span>
    <slot />
  </span>
</template>
