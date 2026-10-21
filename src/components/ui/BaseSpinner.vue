<script setup lang="ts">
import MaterialIcon from '@/components/ui/MaterialIcon.vue'

withDefaults(defineProps<{ size?: number; label?: string }>(), { size: 16 })
</script>

<template>
  <span
    v-if="!label"
    role="status"
    aria-label="Loading"
    class="inline-flex items-center justify-center"
  >
    <MaterialIcon name="progress_activity" :size="size" class="animate-spin text-outline" />
  </span>
  <span v-else class="inline-flex items-center gap-2 text-body-sm text-on-surface-variant">
    <MaterialIcon name="progress_activity" :size="size" class="animate-spin text-outline" />
    {{ label }}
  </span>
</template>
