<script setup lang="ts">
import MaterialIcon from '@/components/ui/MaterialIcon.vue'

export interface TabItem {
  value: string
  label: string
  count?: number
  /** Material Symbols ligature name. */
  icon?: string
}

defineProps<{ tabs: TabItem[] }>()

const model = defineModel<string>({ required: true })
</script>

<template>
  <div class="flex items-center gap-0.5 overflow-x-auto border-b border-surface-container" role="tablist">
    <button
      v-for="tab in tabs"
      :key="tab.value"
      type="button"
      role="tab"
      :aria-selected="tab.value === model"
      class="flex items-center gap-1.5 whitespace-nowrap border-b-2 px-space-md py-space-sm text-label-md transition-colors"
      :class="
        tab.value === model
          ? 'border-primary text-primary font-semibold'
          : 'border-transparent text-on-surface-variant hover:text-on-surface'
      "
      @click="model = tab.value"
    >
      <MaterialIcon v-if="tab.icon" :name="tab.icon" :size="16" />
      {{ tab.label }}
      <span
        v-if="tab.count !== undefined"
        class="rounded-full bg-surface-container px-1.5 py-0.5 text-[10px] font-bold text-on-surface-variant tabular"
      >
        {{ tab.count }}
      </span>
    </button>
  </div>
</template>
