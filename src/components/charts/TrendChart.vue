<script setup lang="ts">
import { computed, ref } from 'vue'

import { formatMoney } from '@/lib/money'
import type { MonthlyPoint } from '@/repositories/contracts'

const props = withDefaults(
  defineProps<{
    points: MonthlyPoint[]
    currency?: string
    height?: number
  }>(),
  { currency: 'INR', height: 128 },
)

const hovered = ref<number | null>(null)

const width = 600
const paddingX = 20
const paddingTop = 18
const baseline = 120

const max = computed(() => {
  const highest = Math.max(
    1,
    ...props.points.map((point) => Math.max(point.income, point.expense)),
  )
  const magnitude = 10 ** Math.floor(Math.log10(highest))
  return Math.ceil(highest / magnitude) * magnitude
})

const scaleY = computed(() => (baseline - paddingTop) / max.value)

function xAt(index: number): number {
  const count = Math.max(1, props.points.length - 1)
  return paddingX + (index / count) * (width - paddingX * 2)
}

function yAt(value: number): number {
  return baseline - value * scaleY.value
}

const inflowPath = computed(() =>
  props.points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${xAt(index)},${yAt(point.income)}`).join(' '),
)

const outflowPath = computed(() =>
  props.points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${xAt(index)},${yAt(point.expense)}`)
    .join(' '),
)

const inflowArea = computed(() => {
  if (!props.points.length) return ''
  return `${inflowPath.value} L ${xAt(props.points.length - 1)},${baseline} L ${xAt(0)},${baseline} Z`
})

const gridLines = [20, 60, 100]
</script>

<template>
  <div class="relative">
    <div class="h-44 w-full rounded-md bg-surface-container-low/40 p-space-sm">
      <svg
        class="h-32 w-full overflow-visible"
        preserveAspectRatio="none"
        :viewBox="`0 0 ${width} 120`"
        role="img"
        aria-label="Income and expense trend by month"
      >
        <line
          v-for="y in gridLines"
          :key="y"
          class="text-surface-container-highest"
          stroke="currentColor"
          stroke-dasharray="4,4"
          stroke-width="1"
          x1="0"
          x2="600"
          :y1="y"
          :y2="y"
        />

        <path
          v-if="inflowArea"
          class="text-primary/10"
          :d="inflowArea"
          fill="currentColor"
        />
        <path
          v-if="inflowPath"
          class="text-primary"
          :d="inflowPath"
          fill="none"
          stroke="currentColor"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="3"
        />
        <path
          v-if="outflowPath"
          class="text-tertiary"
          :d="outflowPath"
          fill="none"
          stroke="currentColor"
          stroke-dasharray="3,3"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2.5"
        />

        <circle
          v-for="(point, index) in points"
          :key="index"
          class="text-primary"
          :cx="xAt(index)"
          :cy="yAt(point.income)"
          :fill="'currentColor'"
          :r="hovered === index ? 5 : 4"
          @mouseenter="hovered = index"
          @mouseleave="hovered = null"
        />
      </svg>

      <div
        class="grid text-center text-label-sm text-outline"
        :style="{ gridTemplateColumns: `repeat(${Math.max(1, points.length)}, minmax(0, 1fr))` }"
      >
        <span
          v-for="(point, index) in points"
          :key="index"
          :class="index === points.length - 1 ? 'font-bold text-on-surface' : ''"
        >
          {{ point.label }}
        </span>
      </div>
    </div>

    <div
      v-if="hovered !== null && points[hovered]"
      class="pointer-events-none absolute top-1 z-10 rounded-sm bg-surface-container-lowest px-space-sm py-1.5 text-label-xs shadow-md ring-1 ring-outline-variant/40"
      :style="{ left: `${(hovered / Math.max(1, points.length - 1)) * 100}%`, transform: 'translateX(-50%)' }"
    >
      <p class="font-bold text-on-surface">{{ points[hovered]!.label }}</p>
      <p class="mt-0.5 flex items-center gap-1.5 text-on-surface-variant">
        <span class="size-1.5 rounded-full bg-primary" aria-hidden="true" />
        Inflow {{ formatMoney(points[hovered]!.income, currency, { blankZero: true }) }}
      </p>
      <p class="mt-0.5 flex items-center gap-1.5 text-on-surface-variant">
        <span class="size-1.5 rounded-full bg-tertiary" aria-hidden="true" />
        Outflow {{ formatMoney(points[hovered]!.expense, currency, { blankZero: true }) }}
      </p>
    </div>
  </div>
</template>
