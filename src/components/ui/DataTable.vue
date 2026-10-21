<script setup lang="ts" generic="T extends Record<string, unknown>">
import { computed, ref } from 'vue'

import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import { cn } from '@/lib/cn'

export interface TableColumn {
  key: string
  label: string
  align?: 'left' | 'right' | 'center'
  width?: string
  sortable?: boolean
  numeric?: boolean
  className?: string
  headerClass?: string
}

const props = withDefaults(
  defineProps<{
    columns: TableColumn[]
    rows: T[]
    rowKey: string | ((row: T) => string)
    dense?: boolean
    stickyHeader?: boolean
    loading?: boolean
    sortBy?: string | null
    sortDir?: 'asc' | 'desc'
    emptyTitle?: string
    emptyDescription?: string
    rowClass?: string
    clickable?: boolean
  }>(),
  {
    dense: false,
    stickyHeader: true,
    loading: false,
    sortBy: null,
    sortDir: 'asc',
    emptyTitle: 'Nothing to show',
    emptyDescription: 'Adjust the filters or add a new record.',
    clickable: true,
  },
)

const emit = defineEmits<{
  sort: [key: string, dir: 'asc' | 'desc']
  rowClick: [row: T]
  rowDblClick: [row: T]
}>()

const internalSort = ref<{ key: string; dir: 'asc' | 'desc' } | null>(null)

const activeSort = computed(() =>
  props.sortBy ? { key: props.sortBy, dir: props.sortDir ?? 'asc' } : internalSort.value,
)

const sortedRows = computed<T[]>(() => {
  const sort = activeSort.value
  if (!sort) return props.rows
  const column = props.columns.find((candidate) => candidate.key === sort.key)
  if (!column) return props.rows
  const factor = sort.dir === 'asc' ? 1 : -1
  return [...props.rows].sort((left, right) => {
    const a = left[column.key]
    const b = right[column.key]
    if (a === b) return 0
    if (a === null || a === undefined) return 1
    if (b === null || b === undefined) return -1
    if (typeof a === 'number' && typeof b === 'number') return (a - b) * factor
    return String(a).localeCompare(String(b), undefined, { numeric: true }) * factor
  })
})

function toggleSort(column: TableColumn) {
  if (!column.sortable) return
  const current = activeSort.value
  const dir = current?.key === column.key && current.dir === 'asc' ? 'desc' : 'asc'
  internalSort.value = { key: column.key, dir }
  emit('sort', column.key, dir)
}

function keyFor(row: T): string {
  return typeof props.rowKey === 'function' ? props.rowKey(row) : String(row[props.rowKey])
}
</script>

<template>
  <div class="relative flex min-h-0 flex-1 flex-col">
    <div class="min-h-0 flex-1 overflow-auto">
      <table class="w-full border-collapse text-body-sm">
        <thead
          v-if="stickyHeader"
          class="sticky top-0 z-10 bg-surface-container-low text-outline"
        >
          <tr>
            <th
              v-for="column in columns"
              :key="column.key"
              scope="col"
              :class="cn(
                'whitespace-nowrap px-space-md py-2 text-label-xs uppercase tracking-wider',
                column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left',
                column.numeric && 'tabular',
                column.headerClass,
              )"
              :style="column.width ? { width: column.width } : undefined"
              :aria-sort="
                activeSort?.key === column.key
                  ? activeSort.dir === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : undefined
              "
            >
              <button
                v-if="column.sortable"
                type="button"
                class="inline-flex items-center gap-1 rounded-sm transition-colors hover:text-on-surface"
                @click="toggleSort(column)"
              >
                {{ column.label }}
                <MaterialIcon
                  v-if="activeSort?.key === column.key && activeSort.dir === 'asc'"
                  name="arrow_upward"
                  :size="12"
                  class="text-primary"
                />
                <MaterialIcon
                  v-else-if="activeSort?.key === column.key && activeSort.dir === 'desc'"
                  name="arrow_downward"
                  :size="12"
                  class="text-primary"
                />
                <MaterialIcon
                  v-else
                  name="unfold_more"
                  :size="12"
                  class="opacity-40"
                />
              </button>
              <span v-else>{{ column.label }}</span>
            </th>
          </tr>
        </thead>

        <tbody>
          <tr
            v-for="row in sortedRows"
            :key="keyFor(row)"
            :class="cn(
              'border-b border-surface-container-low transition-colors',
              dense ? 'h-8' : 'h-9',
              clickable && 'cursor-pointer hover:bg-surface-container-low/70',
              rowClass,
            )"
            @click="clickable && emit('rowClick', row)"
            @dblclick="emit('rowDblClick', row)"
          >
            <td
              v-for="column in columns"
              :key="column.key"
              :class="cn(
                'px-space-md align-middle text-on-surface',
                dense ? 'py-1' : 'py-1.5',
                column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left',
                column.numeric && 'tabular',
                column.className,
              )"
            >
              <slot :name="`cell:${column.key}`" :row="row" :value="row[column.key]" :column="column">
                {{ row[column.key] ?? '—' }}
              </slot>
            </td>
          </tr>
        </tbody>
      </table>

      <div
        v-if="!loading && !sortedRows.length"
        class="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center"
      >
        <div class="flex size-10 items-center justify-center rounded-full bg-surface-container">
          <MaterialIcon name="inbox" :size="18" class="text-outline" />
        </div>
        <p class="text-body-md font-semibold text-on-surface">{{ emptyTitle }}</p>
        <p class="max-w-xs text-label-sm text-outline">{{ emptyDescription }}</p>
        <slot name="empty" />
      </div>

      <div v-if="loading" class="flex flex-col gap-2 p-space-md">
        <div
          v-for="index in 6"
          :key="index"
          class="h-7 animate-pulse rounded-sm bg-surface-container"
          :style="{ width: `${60 + ((index * 13) % 38)}%` }"
        />
      </div>
    </div>
  </div>
</template>
