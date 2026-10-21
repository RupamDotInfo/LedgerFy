<script setup lang="ts">
import { cn } from '@/lib/cn'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'

export interface SegmentItem {
  value: string
  label: string
  /** Material Symbols ligature name. */
  icon?: string
}

defineProps<{ items: SegmentItem[]; size?: 'sm' | 'md' }>()

const model = defineModel<string>({ required: true })
</script>

<template>
  <div
    class="inline-flex items-center gap-0.5 rounded-sm bg-surface-container p-0.5"
    role="group"
  >
    <button
      v-for="item in items"
      :key="item.value"
      type="button"
      class="inline-flex items-center gap-1.5 rounded-xs font-medium transition-colors"
      :class="cn(
        size === 'sm' ? 'h-6 px-space-sm text-label-xs' : 'h-7 px-space-sm text-label-sm',
        item.value === model
          ? 'bg-surface-container-lowest text-on-surface shadow-sm'
          : 'text-on-surface-variant hover:text-on-surface',
      )"
      :aria-pressed="item.value === model"
      @click="model = item.value"
    >
      <MaterialIcon v-if="item.icon" :name="item.icon" :size="14" />
      {{ item.label }}
    </button>
  </div>
</template>
