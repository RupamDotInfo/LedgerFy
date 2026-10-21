<script setup lang="ts">
import MaterialIcon from '@/components/ui/MaterialIcon.vue'

defineProps<{
  saving: boolean
  canPost: boolean
  canSave: boolean
}>()

defineEmits<{ save: []; preview: []; post: [] }>()

const hints = [
  { keys: 'Enter', label: 'Next' },
  { keys: 'Esc', label: 'Back / Cancel' },
  { keys: 'F2', label: 'Date' },
  { keys: 'Alt P', label: 'Preview' },
  { keys: 'Ctrl ↵', label: 'Post' },
]
</script>

<template>
  <footer
    class="sticky bottom-0 z-30 flex flex-wrap items-center justify-between gap-space-md bg-surface-container-lowest/90 px-space-lg py-space-sm shadow-xl backdrop-blur-md"
  >
    <div class="flex items-center gap-space-sm overflow-x-auto text-outline">
      <div
        v-for="hint in hints"
        :key="hint.keys"
        class="flex items-center gap-1 rounded-sm bg-surface-container px-space-xs py-0.5 text-label-xs"
      >
        <span class="font-bold text-on-surface">{{ hint.keys }}</span>
        <span>{{ hint.label }}</span>
      </div>
    </div>

    <div class="flex items-center gap-space-sm">
      <button
        type="button"
        class="flex items-center gap-1.5 rounded-md bg-surface-container-low px-space-md py-2 text-label-md text-on-surface shadow-sm transition-all hover:bg-surface-container active:scale-95 disabled:opacity-50"
        :disabled="!canSave || saving"
        @click="$emit('save')"
      >
        <MaterialIcon name="save" :size="16" />
        <span>Save as Draft</span>
        <span class="kbd">Ctrl S</span>
      </button>

      <button
        type="button"
        class="flex items-center gap-1.5 rounded-md bg-surface-container-low px-space-md py-2 text-label-md text-on-surface shadow-sm transition-all hover:bg-surface-container active:scale-95 disabled:opacity-50"
        :disabled="!canSave || saving"
        @click="$emit('preview')"
      >
        <MaterialIcon name="print" :size="16" />
        <span>Print &amp; Preview</span>
        <span class="kbd">Alt P</span>
      </button>

      <button
        type="button"
        class="flex items-center gap-space-sm rounded-md bg-primary px-space-xl py-2 text-headline-sm font-bold text-on-primary shadow-md transition-all hover:bg-primary-container hover:shadow-lg active:scale-[0.98] disabled:opacity-50"
        :disabled="!canPost || saving"
        @click="$emit('post')"
      >
        <MaterialIcon name="send_and_archive" :size="20" />
        <span>Post Voucher</span>
        <span class="kbd bg-on-primary-fixed-variant text-on-primary">Ctrl ↵</span>
      </button>
    </div>
  </footer>
</template>
