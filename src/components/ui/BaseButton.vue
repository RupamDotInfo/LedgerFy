<script setup lang="ts">
import { computed } from 'vue'

import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'tonal' | 'neutral' | 'outlined' | 'text' | 'danger' | 'success'
type Size = 'xs' | 'sm' | 'md' | 'lg'

const props = withDefaults(
  defineProps<{
    variant?: Variant
    size?: Size
    type?: 'button' | 'submit' | 'reset'
    disabled?: boolean
    loading?: boolean
    iconOnly?: boolean
    block?: boolean
    active?: boolean
    /** Material Symbols ligature name. */
    icon?: string
    trailingIcon?: string
    title?: string
    ariaLabel?: string
  }>(),
  {
    variant: 'neutral',
    size: 'md',
    type: 'button',
    disabled: false,
    loading: false,
    iconOnly: false,
    block: false,
    active: false,
  },
)

defineEmits<{ click: [MouseEvent] }>()

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary shadow-sm hover:bg-primary-container',
  tonal: 'bg-primary-container text-on-primary-container hover:bg-primary-fixed',
  neutral: 'bg-surface-container-low text-on-surface shadow-sm hover:bg-surface-container-high',
  outlined: 'border border-outline-variant text-primary hover:bg-primary-fixed/50',
  text: 'text-primary hover:bg-primary-fixed/50',
  danger: 'bg-error-container text-on-error-container hover:bg-error/20',
  success: 'bg-secondary-container text-on-secondary-container hover:bg-secondary-fixed',
}

const sizes: Record<Size, string> = {
  xs: 'h-6 px-space-xs text-label-xs gap-1',
  sm: 'h-7 px-space-sm text-label-sm gap-1',
  md: 'h-8 px-space-md text-label-md gap-1.5',
  lg: 'h-9 px-space-lg text-label-md gap-1.5',
}

const iconSizes: Record<Size, number> = { xs: 13, sm: 15, md: 16, lg: 18 }

const classes = computed(() =>
  cn(
    'inline-flex items-center justify-center rounded-sm font-medium whitespace-nowrap',
    'transition-[background-color,color,box-shadow,transform] duration-100 active:scale-[0.97]',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
    'disabled:pointer-events-none disabled:opacity-45',
    variants[props.variant],
    sizes[props.size],
    props.block && 'w-full',
    props.active && 'bg-primary-fixed text-on-primary-fixed',
  ),
)
</script>

<template>
  <button
    :type="type"
    :class="classes"
    :disabled="disabled || loading"
    :title="title"
    :aria-label="ariaLabel"
    :aria-busy="loading || undefined"
    @click="$emit('click', $event)"
  >
    <MaterialIcon v-if="loading" name="progress_activity" :size="iconSizes[size]" />
    <MaterialIcon v-else-if="icon" :name="icon" :size="iconSizes[size]" />
    <slot />
    <MaterialIcon v-if="trailingIcon" :name="trailingIcon" :size="iconSizes[size]" />
  </button>
</template>
