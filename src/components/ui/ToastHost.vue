<script setup lang="ts">
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import { useToastStore, type ToastTone } from '@/stores/toast'

const toastStore = useToastStore()

const toneStyles: Record<ToastTone, { icon: string; ring: string; iconColor: string }> = {
  success: { icon: 'task_alt', ring: 'ring-secondary/30', iconColor: 'text-secondary' },
  error: { icon: 'error', ring: 'ring-error/30', iconColor: 'text-error' },
  warning: { icon: 'warning', ring: 'ring-tertiary/30', iconColor: 'text-tertiary' },
  info: { icon: 'info', ring: 'ring-primary/30', iconColor: 'text-primary' },
}
</script>

<template>
  <div
    class="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-[380px] max-w-[calc(100vw-2rem)] flex-col gap-2"
    role="status"
    aria-live="polite"
  >
    <TransitionGroup
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="translate-y-1 opacity-0"
      leave-active-class="transition duration-100 ease-in"
      leave-to-class="translate-y-1 opacity-0"
    >
      <div
        v-for="toast in toastStore.toasts"
        :key="toast.id"
        class="pointer-events-auto flex items-start gap-space-sm rounded-md bg-surface-container-lowest px-space-md py-space-sm shadow-lg ring-1"
        :class="toneStyles[toast.tone].ring"
      >
        <MaterialIcon
          :name="toneStyles[toast.tone].icon"
          :size="18"
          class="mt-0.5 shrink-0"
          :class="toneStyles[toast.tone].iconColor"
        />
        <div class="min-w-0 flex-1">
          <p class="text-body-md font-semibold text-on-surface">{{ toast.title }}</p>
          <p v-if="toast.description" class="mt-0.5 text-label-sm leading-relaxed text-outline">
            {{ toast.description }}
          </p>
          <button
            v-if="toast.actionLabel"
            type="button"
            class="mt-1.5 text-label-sm font-bold text-primary hover:underline"
            @click="toast.onAction?.(); toastStore.dismiss(toast.id)"
          >
            {{ toast.actionLabel }}
          </button>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-sm p-0.5 text-outline transition-colors hover:bg-surface-container hover:text-on-surface"
          aria-label="Dismiss notification"
          @click="toastStore.dismiss(toast.id)"
        >
          <MaterialIcon name="close" :size="15" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
