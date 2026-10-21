<script setup lang="ts">
withDefaults(defineProps<{ size?: number; showWordmark?: boolean }>(), {
  size: 26,
  showWordmark: true,
})
</script>

<template>
  <span class="inline-flex items-center gap-2 select-none">
    <span
      class="inline-flex shrink-0 items-center justify-center rounded-sm shadow-sm"
      :style="{
        width: `${size}px`,
        height: `${size}px`,
        background: 'linear-gradient(145deg, #4263eb 0%, #2248d1 60%, #0035be 100%)',
      }"
      aria-hidden="true"
    >
      <svg :width="size * 0.62" :height="size * 0.62" viewBox="0 0 24 24" fill="none">
        <path
          d="M6 3.75h8.5a3.5 3.5 0 0 1 3.5 3.5v13H9.5A3.5 3.5 0 0 1 6 16.75V3.75Z"
          stroke="white"
          stroke-width="1.7"
          stroke-linejoin="round"
        />
        <path
          d="M6 16.75A3.5 3.5 0 0 1 9.5 13.25H18M9.5 7.25h4.25"
          stroke="white"
          stroke-width="1.7"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </span>

    <span v-if="showWordmark" class="min-w-0 leading-none">
      <span class="block truncate text-label-md font-bold tracking-[-0.02em] text-on-surface">
        LedgerFy
      </span>
      <span class="mt-0.5 block truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-outline">
        Business books
      </span>
    </span>
  </span>
</template>
