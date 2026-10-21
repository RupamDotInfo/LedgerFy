<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import { cn } from '@/lib/cn'

const props = withDefaults(
  defineProps<{
    open: boolean
    title?: string
    description?: string
    size?: 'sm' | 'md' | 'lg' | 'xl'
    closeOnOverlay?: boolean
    showClose?: boolean
  }>(),
  { size: 'md', closeOnOverlay: true, showClose: true },
)

const emit = defineEmits<{ close: [] }>()

const panel = ref<HTMLElement | null>(null)
const previouslyFocused = ref<HTMLElement | null>(null)

const widths = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
    return
  }
  if (event.key !== 'Tab' || !panel.value) return

  const focusable = panel.value.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      previouslyFocused.value = document.activeElement as HTMLElement | null
      document.body.style.overflow = 'hidden'
      await nextTick()
      const target = panel.value?.querySelector<HTMLElement>('[data-autofocus]')
      ;(target ?? panel.value)?.focus()
    } else {
      document.body.style.overflow = ''
      previouslyFocused.value?.focus?.()
      previouslyFocused.value = null
    }
  },
)

onBeforeUnmount(() => {
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-[#121b2e]/45 p-4 pt-[8vh]"
      @keydown="onKeydown"
    >
      <div class="absolute inset-0" aria-hidden="true" @click="closeOnOverlay && emit('close')" />

      <div
        ref="panel"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        tabindex="-1"
        :class="cn(
          'relative w-full rounded-md bg-surface-container-lowest shadow-lg outline-none',
          widths[size],
        )"
      >
        <header
          v-if="title || showClose"
          class="flex items-start justify-between gap-4 px-space-md py-space-md"
        >
          <div class="min-w-0">
            <h2 class="text-headline-sm text-on-surface">{{ title }}</h2>
            <p v-if="description" class="mt-0.5 text-label-sm text-outline">{{ description }}</p>
          </div>
          <button
            v-if="showClose"
            type="button"
            class="shrink-0 rounded-sm p-1 text-outline transition-colors hover:bg-surface-container hover:text-on-surface"
            aria-label="Close dialog"
            @click="emit('close')"
          >
            <MaterialIcon name="close" :size="18" />
          </button>
        </header>

        <div class="max-h-[70vh] overflow-y-auto px-space-md pb-space-md">
          <slot />
        </div>

        <footer
          v-if="$slots.footer"
          class="flex items-center justify-end gap-2 border-t border-surface-container bg-surface-container-low/60 px-space-md py-space-sm"
        >
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>
