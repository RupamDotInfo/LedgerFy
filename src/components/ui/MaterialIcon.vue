<script setup lang="ts">
/**
 * Material Symbols icon.
 *
 * `name` is the Material Symbols ligature, e.g. "receipt_long".
 * The font is bundled locally so icons render with no network access.
 */
const props = withDefaults(
  defineProps<{
    name: string
    size?: number
    filled?: boolean
    weight?: number
    /** Accessible label. When omitted the icon is treated as decorative. */
    label?: string
  }>(),
  { size: 20, filled: false, weight: 400 },
)
</script>

<template>
  <span
    class="material-symbols-outlined"
    :style="{
      fontSize: `${props.size}px`,
      fontVariationSettings: `'FILL' ${props.filled ? 1 : 0}, 'wght' ${props.weight}, 'GRAD' 0, 'opsz' ${Math.min(48, Math.max(20, props.size))}`,
    }"
    :aria-hidden="props.label ? undefined : 'true'"
    :aria-label="props.label"
    :role="props.label ? 'img' : undefined"
  >
    {{ props.name }}
  </span>
</template>
