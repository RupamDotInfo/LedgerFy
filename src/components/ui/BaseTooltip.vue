<script setup lang="ts">
import { ref } from 'vue'

const props = withDefaults(defineProps<{ text: string; placement?: 'top' | 'bottom' }>(), {
  placement: 'top',
})

const visible = ref(false)
</script>

<template>
  <span
    class="relative inline-flex"
    @mouseenter="visible = true"
    @mouseleave="visible = false"
    @focusin="visible = true"
    @focusout="visible = false"
  >
    <slot />
    <Transition
      enter-active-class="transition duration-100"
      enter-from-class="opacity-0"
      leave-active-class="transition duration-75"
      leave-to-class="opacity-0"
    >
      <span
        v-if="visible"
        role="tooltip"
        class="pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-sm bg-inverse-surface px-space-sm py-1 text-label-xs font-semibold text-inverse-on-surface shadow-md"
        :class="placement === 'top' ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]'"
      >
        {{ props.text }}
      </span>
    </Transition>
  </span>
</template>
