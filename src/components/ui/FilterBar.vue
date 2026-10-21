<script setup lang="ts">
withDefaults(defineProps<{ sticky?: boolean }>(), { sticky: false })
</script>

<template>
  <div
    class="flex shrink-0 flex-wrap items-center gap-space-sm border-b border-surface-container bg-surface-container-lowest px-space-lg py-space-sm"
    :class="sticky ? 'sticky top-0 z-20' : ''"
  >
    <slot />

    <div class="ml-auto flex items-center gap-space-sm">
      <slot name="trailing" />
    </div>
  </div>
</template>
