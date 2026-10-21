<script setup lang="ts">
import { computed } from 'vue'

import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import { formatDate } from '@/lib/datetime'

const props = defineProps<{
  voucherNumber: string
  date: string
  placeOfSupply: string
  isInterState: boolean
}>()

const emit = defineEmits<{ 'update:date': [string] }>()

const date = computed({
  get: () => props.date,
  set: (value: string) => emit('update:date', value),
})

const weekday = computed(() => {
  const parsed = new Date(`${props.date}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleDateString('en-IN', { weekday: 'long' })
})
</script>

<template>
  <section
    class="flex flex-wrap items-center justify-between gap-space-md bg-surface-container-lowest px-space-lg py-space-sm shadow-sm"
    aria-label="Voucher details"
  >
    <div class="flex flex-wrap items-center gap-space-md">
      <div class="flex items-center gap-space-xs rounded-sm bg-surface-container-low px-space-sm py-1">
        <span class="text-label-xs uppercase text-outline">Voucher No</span>
        <span class="num text-numeric-md font-bold text-primary">{{ voucherNumber }}</span>
        <MaterialIcon name="lock" :size="14" class="text-outline" />
      </div>

      <label
        class="flex cursor-pointer items-center gap-space-xs rounded-sm bg-surface-container-low px-space-sm py-1 transition-colors hover:bg-surface-container"
      >
        <MaterialIcon name="calendar_today" :size="16" class="text-primary" />
        <span class="text-label-xs uppercase text-outline">Date:</span>
        <span class="text-label-md font-semibold text-on-surface">
          {{ formatDate(date) }} ({{ weekday }})
        </span>
        <span class="kbd">F2</span>
        <input v-model="date" type="date" class="sr-only" aria-label="Voucher date" />
      </label>

      <div class="flex items-center gap-space-xs rounded-sm bg-surface-container-low px-space-sm py-1">
        <MaterialIcon name="location_on" :size="16" class="text-secondary" />
        <span class="text-label-xs uppercase text-outline">Place of Supply:</span>
        <span class="text-label-sm font-semibold text-on-surface">{{ placeOfSupply }}</span>
        <span
          class="rounded-sm bg-secondary-container px-1 py-0.2 text-label-xs font-bold text-on-secondary-container"
        >
          {{ isInterState ? 'Inter-State IGST' : 'Intra-State CGST+SGST' }}
        </span>
      </div>
    </div>

    <div class="flex items-center gap-space-sm text-outline">
      <div class="flex items-center gap-1 text-label-xs">
        <MaterialIcon name="bolt" :size="14" />
        <span>Auto Tax Engine:</span>
        <span class="font-bold text-secondary">ACTIVE</span>
      </div>
      <div class="flex items-center gap-1 rounded-sm bg-surface-container px-1.5 py-0.5 text-label-xs">
        <span class="kbd">Alt G</span>
        <span>GST Portal</span>
      </div>
    </div>
  </section>
</template>
