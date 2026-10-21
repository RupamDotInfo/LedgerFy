<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

import MaterialIcon from '@/components/ui/MaterialIcon.vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    title?: string
    description?: string
    side?: 'right' | 'left'
    width?: string
  }>(),
  { side: 'right', width: '440px' },
)

const emit = defineEmits<{ close: [] }>()

const panel = ref<HTMLElement | null>(null)

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
  }
}

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      await nextTick()
      panel.value?.focus()
    } else {
      document.body.style.overflow = ''
    }
  },
)

onBeforeUnmount(() => {
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-[90]" @keydown="onKeydown">
      <div class="absolute inset-0 bg-[#121b2e]/35" aria-hidden="true" @click="emit('close')" />
      <aside
        ref="panel"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        tabindex="-1"
        class="absolute top-0 flex h-full flex-col bg-surface-container-lowest shadow-lg outline-none"
        :class="side === 'right' ? 'right-0' : 'left-0'"
        :style="{ width }"
      >
        <header
          class="flex shrink-0 items-start justify-between gap-4 border-b border-surface-container px-space-md py-space-md"
        >
          <div class="min-w-0">
            <h2 class="text-headline-sm text-on-surface">{{ title }}</h2>
            <p v-if="description" class="mt-0.5 text-label-sm text-outline">{{ description }}</p>
          </div>
          <button
            type="button"
            class="shrink-0 rounded-sm p-1 text-outline transition-colors hover:bg-surface-container hover:text-on-surface"
            aria-label="Close panel"
            @click="emit('close')"
          >
            <MaterialIcon name="close" :size="18" />
          </button>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto px-space-md py-space-md">
          <slot />
        </div>

        <footer
          v-if="$slots.footer"
          class="flex shrink-0 items-center justify-end gap-2 border-t border-surface-container bg-surface-container-low/60 px-space-md py-space-sm"
        >
          <slot name="footer" />
        </footer>
      </aside>
    </div>
  </Teleport>
</template>
