<script setup lang="ts">
import { computed } from 'vue'

import MaterialIcon from '@/components/ui/MaterialIcon.vue'

const props = withDefaults(
  defineProps<{
    page: number
    pageSize: number
    total: number
    pageSizes?: number[]
    label?: string
  }>(),
  { pageSizes: () => [25, 50, 100, 250] },
)

const emit = defineEmits<{
  'update:page': [number]
  'update:pageSize': [number]
}>()

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))

const pages = computed(() => {
  const count = totalPages.value
  const current = props.page
  if (count <= 7) return Array.from({ length: count }, (_, index) => index + 1)
  const set = new Set<number>([1, count, current, current - 1, current + 1])
  if (current <= 3) [2, 3, 4].forEach((page) => set.add(page))
  if (current >= count - 2) [count - 1, count - 2, count - 3].forEach((page) => set.add(page))
  return [...set].filter((page) => page >= 1 && page <= count).sort((a, b) => a - b)
})

function go(page: number) {
  const next = Math.min(Math.max(1, page), totalPages.value)
  if (next !== props.page) emit('update:page', next)
}

function changeSize(event: Event) {
  emit('update:pageSize', Number((event.target as HTMLSelectElement).value))
  emit('update:page', 1)
}
</script>

<template>
  <div
    class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-surface-container bg-surface-container-low/60 px-space-md py-space-sm"
  >
    <div class="flex items-center gap-3 text-label-sm text-outline">
      <span v-if="label">{{ label }}</span>
      <span class="tabular">
        {{
          total === 0
            ? '0 records'
            : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`
        }}
      </span>
    </div>

    <div class="flex items-center gap-3">
      <label class="flex items-center gap-1.5 text-label-sm text-outline">
        <span>Rows</span>
        <select
          :value="pageSize"
          class="h-7 rounded-sm bg-surface-container-lowest px-1.5 text-label-sm text-on-surface focus:ring-2 focus:ring-primary focus:outline-none"
          @change="changeSize"
        >
          <option v-for="size in pageSizes" :key="size" :value="size">{{ size }}</option>
        </select>
      </label>

      <nav class="flex items-center gap-0.5" aria-label="Pagination">
        <button
          type="button"
          class="flex size-7 items-center justify-center rounded-sm bg-surface-container-lowest text-on-surface-variant transition-colors hover:bg-surface-container-high disabled:opacity-40"
          :disabled="page <= 1"
          aria-label="Previous page"
          @click="go(page - 1)"
        >
          <MaterialIcon name="chevron_left" :size="16" />
        </button>

        <template v-for="(pageNumber, index) in pages" :key="pageNumber">
          <span v-if="index > 0 && pageNumber - pages[index - 1]! > 1" class="px-1 text-label-sm text-outline">
            …
          </span>
          <button
            type="button"
            class="flex h-7 min-w-7 items-center justify-center rounded-sm px-1.5 text-label-sm font-semibold tabular transition-colors"
            :class="
              pageNumber === page
                ? 'bg-primary text-on-primary'
                : 'bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-high'
            "
            :aria-current="pageNumber === page ? 'page' : undefined"
            @click="go(pageNumber)"
          >
            {{ pageNumber }}
          </button>
        </template>

        <button
          type="button"
          class="flex size-7 items-center justify-center rounded-sm bg-surface-container-lowest text-on-surface-variant transition-colors hover:bg-surface-container-high disabled:opacity-40"
          :disabled="page >= totalPages"
          aria-label="Next page"
          @click="go(page + 1)"
        >
          <MaterialIcon name="chevron_right" :size="16" />
        </button>
      </nav>
    </div>
  </div>
</template>
