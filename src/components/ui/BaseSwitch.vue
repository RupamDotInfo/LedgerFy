<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    label?: string
    description?: string
    disabled?: boolean
  }>(),
  { disabled: false },
)

const model = defineModel<boolean>({ default: false })
</script>

<template>
  <label class="flex items-start justify-between gap-4" :class="props.disabled && 'opacity-60'">
    <span class="min-w-0">
      <span class="block text-body-md font-medium text-on-surface">{{ label }}</span>
      <span v-if="description" class="mt-0.5 block text-label-sm leading-relaxed text-outline">
        {{ description }}
      </span>
    </span>
    <button
      type="button"
      role="switch"
      :aria-checked="model"
      :aria-label="label"
      :disabled="disabled"
      class="relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors"
      :class="model ? 'bg-primary' : 'bg-surface-container-highest'"
      @click="model = !model"
    >
      <span
        class="absolute top-0.5 size-4 rounded-full bg-surface-container-lowest shadow-sm transition-transform"
        :class="model ? 'translate-x-[18px]' : 'translate-x-0.5'"
      />
    </button>
  </label>
</template>
