<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

withDefaults(defineProps<{ align?: 'left' | 'right'; width?: string }>(), {
  align: 'left',
  width: '280px',
})

const open = ref(false)
const root = ref<HTMLElement | null>(null)

function onDocumentClick(event: MouseEvent) {
  if (!open.value) return
  if (root.value && !root.value.contains(event.target as Node)) {
    open.value = false
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && open.value) {
    event.stopPropagation()
    open.value = false
  }
}

onMounted(() => {
  document.addEventListener('mousedown', onDocumentClick)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentClick)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div ref="root" class="relative">
    <div @click="open = !open">
      <slot name="trigger" :open="open" />
    </div>

    <div
      v-if="open"
      class="absolute top-[calc(100%+6px)] z-50 overflow-hidden rounded-md bg-surface-container-lowest shadow-lg ring-1 ring-outline-variant/40"
      :class="align === 'right' ? 'right-0' : 'left-0'"
      :style="{ width }"
    >
      <slot :close="() => (open = false)" />
    </div>
  </div>
</template>
