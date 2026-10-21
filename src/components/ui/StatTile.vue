<script setup lang="ts">
import MaterialIcon from '@/components/ui/MaterialIcon.vue'

type Tone = 'default' | 'positive' | 'warning' | 'danger' | 'info'

withDefaults(
  defineProps<{
    label: string
    value: string
    delta?: number
    deltaLabel?: string
    /** Material Symbols ligature name. */
    icon?: string
    tone?: Tone
    hint?: string
    clickable?: boolean
  }>(),
  { tone: 'default', clickable: false },
)

const emit = defineEmits<{ drill: [] }>()

const toneClasses: Record<Tone, string> = {
  default: 'text-on-surface',
  positive: 'text-secondary',
  warning: 'text-tertiary',
  danger: 'text-tertiary',
  info: 'text-primary',
}
</script>

<template>
  <component
    :is="clickable ? 'button' : 'div'"
    :type="clickable ? 'button' : undefined"
    class="flex min-w-0 flex-col gap-1.5 rounded-md bg-surface-container-lowest p-space-md text-left shadow-sm transition-shadow"
    :class="clickable && 'hover:shadow-md'"
    @click="clickable && emit('drill')"
  >
    <div class="flex items-center justify-between gap-2">
      <span class="section-label truncate">{{ label }}</span>
      <MaterialIcon v-if="icon" :name="icon" :size="18" class="shrink-0 text-outline" />
    </div>

    <div class="flex items-baseline gap-2">
      <span class="num truncate text-headline-lg text-on-surface" :class="toneClasses[tone]">
        {{ value }}
      </span>
      <span
        v-if="delta !== undefined"
        class="inline-flex items-center gap-0.5 rounded-sm bg-secondary-container/50 px-1.5 py-0.5 text-label-xs font-bold"
        :class="delta >= 0 ? 'text-on-secondary-container' : 'text-on-tertiary-fixed'"
      >
        <MaterialIcon :name="delta >= 0 ? 'trending_up' : 'trending_down'" :size="13" />
        {{ Math.abs(delta).toFixed(1) }}%
      </span>
    </div>

    <p v-if="hint || deltaLabel" class="truncate text-label-xs text-outline">{{ deltaLabel ?? hint }}</p>
  </component>
</template>
