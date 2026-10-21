<script setup lang="ts">
import MaterialIcon from '@/components/ui/MaterialIcon.vue'

withDefaults(
  defineProps<{
    title: string
    subtitle?: string
    breadcrumb?: Array<{ label: string; to?: string }>
    /** Material Symbols ligature shown before the title. */
    icon?: string
    compact?: boolean
  }>(),
  { compact: false },
)
</script>

<template>
  <header
    class="flex shrink-0 items-start justify-between gap-4 border-b border-surface-container bg-surface-container-lowest px-space-lg"
    :class="compact ? 'py-space-sm' : 'py-space-md'"
  >
    <div class="min-w-0">
      <nav v-if="breadcrumb?.length" aria-label="Breadcrumb" class="mb-0.5">
        <ol class="flex items-center gap-1 text-label-xs text-outline">
          <li v-for="(crumb, index) in breadcrumb" :key="index" class="flex items-center gap-1">
            <MaterialIcon name="chevron_right" :size="13" class="text-outline" />
            <RouterLink
              v-if="crumb.to"
              :to="crumb.to"
              class="rounded-sm hover:text-primary hover:underline"
            >
              {{ crumb.label }}
            </RouterLink>
            <span v-else :class="index === breadcrumb.length - 1 ? 'text-on-surface-variant' : ''">
              {{ crumb.label }}
            </span>
          </li>
        </ol>
      </nav>

      <div class="flex items-center gap-space-sm">
        <MaterialIcon v-if="icon" :name="icon" :size="20" class="text-primary" />
        <h1 class="truncate text-headline-md text-on-surface">{{ title }}</h1>
        <slot name="title-meta" />
      </div>
      <p v-if="subtitle" class="mt-0.5 truncate text-label-sm text-outline">{{ subtitle }}</p>
    </div>

    <div v-if="$slots.actions" class="flex shrink-0 items-center gap-space-sm">
      <slot name="actions" />
    </div>
  </header>
</template>
