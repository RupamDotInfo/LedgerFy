<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

import MaterialIcon from '@/components/ui/MaterialIcon.vue'

export interface ComboboxOption {
  id: string
  label: string
  sublabel?: string
  meta?: string
  group?: string
  disabled?: boolean
}

const props = withDefaults(
  defineProps<{
    options: ComboboxOption[]
    label?: string
    placeholder?: string
    error?: string
    hint?: string
    disabled?: boolean
    required?: boolean
    size?: 'sm' | 'md'
    allowCreate?: boolean
    createLabel?: string
    emptyLabel?: string
    name?: string
    autofocus?: boolean
    variant?: 'filled' | 'outlined'
  }>(),
  { size: 'md', createLabel: 'Create', emptyLabel: 'No matches', variant: 'filled' },
)

const emit = defineEmits<{
  create: [query: string]
  select: [option: ComboboxOption]
}>()

const model = defineModel<string | null>({ default: null })

const open = ref(false)
const query = ref('')
const activeIndex = ref(-1)
const inputEl = ref<HTMLInputElement | null>(null)
const listEl = ref<HTMLElement | null>(null)

const selected = computed(() => props.options.find((option) => option.id === model.value) ?? null)

const filtered = computed(() => {
  const term = query.value.trim().toLowerCase()
  if (!term) return props.options
  return props.options.filter(
    (option) =>
      option.label.toLowerCase().includes(term) ||
      (option.sublabel ?? '').toLowerCase().includes(term),
  )
})

const displayValue = computed(() => {
  if (open.value) return query.value
  return selected.value?.label ?? ''
})

function openList() {
  if (props.disabled) return
  open.value = true
  query.value = ''
  activeIndex.value = filtered.value.length ? 0 : -1
  nextTick(() => inputEl.value?.focus())
}

function closeList(commit = true) {
  open.value = false
  if (commit && query.value && !selected.value && props.allowCreate) {
    emit('create', query.value.trim())
  }
  query.value = ''
}

function select(option: ComboboxOption) {
  if (option.disabled) return
  model.value = option.id
  emit('select', option)
  open.value = false
  query.value = ''
  nextTick(() => inputEl.value?.focus())
}

function clear() {
  model.value = null
  query.value = ''
  nextTick(() => inputEl.value?.focus())
}

function onInput(event: Event) {
  query.value = (event.target as HTMLInputElement).value
  if (!open.value) open.value = true
  activeIndex.value = filtered.value.length ? 0 : -1
}

function move(delta: number) {
  if (!open.value) {
    openList()
    return
  }
  const count = filtered.value.length
  if (!count) return
  activeIndex.value = (activeIndex.value + delta + count) % count
  scrollActiveIntoView()
}

function scrollActiveIntoView() {
  nextTick(() => {
    const item = listEl.value?.children[activeIndex.value] as HTMLElement | undefined
    // Not every environment implements scrollIntoView (jsdom does not).
    if (typeof item?.scrollIntoView === 'function') {
      item.scrollIntoView({ block: 'nearest' })
    }
  })
}

function onKeydown(event: KeyboardEvent) {
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      move(1)
      break
    case 'ArrowUp':
      event.preventDefault()
      move(-1)
      break
    case 'Enter': {
      if (!open.value) {
        openList()
        event.preventDefault()
        return
      }
      const option = filtered.value[activeIndex.value]
      if (option) {
        event.preventDefault()
        select(option)
      } else if (props.allowCreate && query.value.trim()) {
        event.preventDefault()
        emit('create', query.value.trim())
        query.value = ''
      }
      break
    }
    case 'Escape':
      if (open.value) {
        event.preventDefault()
        event.stopPropagation()
        closeList(false)
      }
      break
    case 'Tab':
      closeList(false)
      break
  }
}

watch(filtered, () => {
  if (activeIndex.value > filtered.value.length - 1) {
    activeIndex.value = filtered.value.length ? 0 : -1
  }
})

defineExpose({ focus: () => inputEl.value?.focus() })
</script>

<template>
  <div class="flex flex-col gap-1">
    <label v-if="label" class="flex items-center gap-1 text-label-sm text-on-surface-variant">
      <span>{{ label }}</span>
      <span v-if="required" class="text-error" aria-hidden="true">*</span>
    </label>

    <div class="relative">
      <div
        class="flex items-center rounded-sm transition-[background-color,box-shadow] duration-100"
        :class="[
          variant === 'outlined' ? 'bg-surface-container-lowest shadow-sm' : 'bg-surface-container-low',
          error ? 'ring-1 ring-error' : 'ring-1 ring-transparent',
          open ? 'ring-2 ring-primary' : '',
          disabled ? 'opacity-60' : '',
        ]"
      >
        <MaterialIcon name="search" :size="16" class="ml-space-sm shrink-0 text-outline" />
        <input
          ref="inputEl"
          :value="displayValue"
          type="text"
          role="combobox"
          :name="name"
          :placeholder="placeholder"
          :disabled="disabled"
          :autofocus="autofocus"
          :aria-expanded="open"
          aria-autocomplete="list"
          :aria-invalid="error ? 'true' : undefined"
          class="w-full bg-transparent px-space-sm text-body-md text-on-surface placeholder:text-outline focus:outline-none disabled:cursor-not-allowed"
          :class="size === 'sm' ? 'h-7' : 'h-8'"
          @focus="openList"
          @input="onInput"
          @keydown="onKeydown"
          @blur="closeList(false)"
        />
        <button
          v-if="model && !disabled"
          type="button"
          class="mr-1 shrink-0 rounded-sm p-0.5 text-outline transition-colors hover:bg-surface-container-high hover:text-on-surface"
          aria-label="Clear selection"
          @mousedown.prevent
          @click="clear"
        >
          <MaterialIcon name="close" :size="14" />
        </button>
        <MaterialIcon
          name="arrow_drop_down"
          :size="16"
          class="mr-space-sm shrink-0 text-outline transition-transform"
          :class="open ? 'rotate-180' : ''"
        />
      </div>

      <div
        v-if="open"
        class="absolute left-0 right-0 top-[calc(100%+4px)] z-50 overflow-hidden rounded-md bg-surface-container-lowest shadow-lg ring-1 ring-outline-variant/40"
      >
        <ul ref="listEl" class="max-h-60 overflow-y-auto py-1" role="listbox">
          <li
            v-for="(option, index) in filtered"
            :key="option.id"
            role="option"
            :aria-selected="option.id === model"
            class="flex cursor-pointer items-center gap-2 px-space-sm py-1.5 text-body-md"
            :class="[
              index === activeIndex ? 'bg-surface-container-high' : '',
              option.disabled ? 'cursor-not-allowed opacity-45' : '',
              option.id === model ? 'font-semibold text-primary' : 'text-on-surface',
            ]"
            @mouseenter="activeIndex = index"
            @mousedown.prevent="select(option)"
          >
            <MaterialIcon
              v-if="option.id === model"
              name="check"
              :size="15"
              class="shrink-0 text-primary"
            />
            <span v-else class="w-[15px] shrink-0" />
            <span class="min-w-0 flex-1 truncate">
              {{ option.label }}
              <span v-if="option.sublabel" class="ml-1 text-label-sm text-outline">
                {{ option.sublabel }}
              </span>
            </span>
            <span v-if="option.meta" class="shrink-0 text-label-xs text-outline tabular">
              {{ option.meta }}
            </span>
          </li>

          <li
            v-if="!filtered.length && allowCreate"
            role="option"
            class="flex cursor-pointer items-center gap-2 px-space-sm py-1.5 text-body-md text-primary"
            :class="activeIndex === 0 ? 'bg-surface-container-high' : ''"
            @mouseenter="activeIndex = 0"
            @mousedown.prevent="emit('create', query.trim())"
          >
            <MaterialIcon name="add" :size="15" class="shrink-0" />
            <span class="min-w-0 flex-1 truncate">
              {{ createLabel }} "{{ query.trim() }}"
            </span>
          </li>

          <li v-if="!filtered.length && !allowCreate" class="px-space-sm py-2 text-center text-label-sm text-outline">
            {{ emptyLabel }}
          </li>
        </ul>
      </div>
    </div>

    <p v-if="error" class="text-label-xs font-semibold text-error">{{ error }}</p>
    <p v-else-if="hint" class="text-label-xs text-outline">{{ hint }}</p>
  </div>
</template>
