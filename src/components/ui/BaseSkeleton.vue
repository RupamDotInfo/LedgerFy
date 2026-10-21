<script setup lang="ts">
const props = withDefaults(defineProps<{ class?: string }>(), {})
</script>

<template>
  <div
    class="animate-pulse rounded-sm bg-surface-container"
    :class="props.class ?? 'h-4 w-full'"
    aria-hidden="true"
  />
</template>
