<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import { VOUCHER_TYPE_META } from '@/app/navigation'
import type { VoucherType } from '@/domain/types'

const props = defineProps<{ active: VoucherType; isDraft: boolean }>()

const router = useRouter()

const order: VoucherType[] = [
  'contra',
  'payment',
  'receipt',
  'journal',
  'sales',
  'purchase',
  'credit-note',
  'debit-note',
]

const tabs = computed(() =>
  order.map((type) => ({ type, meta: VOUCHER_TYPE_META[type]! })),
)

function go(type: VoucherType) {
  if (type === props.active) return
  void router.push(VOUCHER_TYPE_META[type]!.route)
}
</script>

<template>
  <section
    class="flex flex-wrap items-center justify-between gap-space-sm bg-surface-container-low px-space-lg py-space-xs shadow-sm"
    aria-label="Voucher type"
  >
    <div class="flex items-center gap-1 overflow-x-auto py-0.5">
      <button
        v-for="tab in tabs"
        :key="tab.type"
        type="button"
        class="flex items-center gap-1.5 rounded-sm px-space-sm py-1 text-label-sm transition-all"
        :class="
          tab.type === active
            ? 'bg-primary text-on-primary shadow-md ring-2 ring-primary-container'
            : 'bg-surface-container-lowest text-on-surface-variant shadow-sm hover:bg-surface-container hover:text-on-surface'
        "
        :aria-current="tab.type === active ? 'true' : undefined"
        @click="go(tab.type)"
      >
        <span
          class="rounded-sm px-1 py-0.5 text-label-xs font-bold"
          :class="
            tab.type === active
              ? 'bg-on-primary-fixed-variant/50 text-on-primary'
              : 'bg-surface-container text-outline'
          "
        >
          {{ tab.meta.shortcut }}
        </span>
        <span :class="tab.type === active ? 'font-semibold tracking-wide' : ''">
          {{ tab.meta.label }}
        </span>
        <span
          v-if="tab.type === active"
          class="size-1.5 rounded-full bg-secondary-container"
          aria-hidden="true"
        />
      </button>
    </div>

    <div class="flex items-center gap-space-sm">
      <div
        class="flex items-center gap-1 rounded-sm bg-surface-container-highest px-space-sm py-0.5 text-on-surface"
      >
        <MaterialIcon name="view_quilt" :size="16" class="text-primary" />
        <span class="text-label-xs font-bold">Item Invoice</span>
        <span class="kbd">Ctrl H</span>
      </div>
      <div
        class="flex items-center gap-1 rounded-sm bg-amber-100 px-space-sm py-0.5 text-amber-900 shadow-sm"
        role="status"
      >
        <span class="size-2 rounded-full bg-amber-500" aria-hidden="true" />
        <span class="text-label-xs font-bold uppercase tracking-wider">
          {{ isDraft ? 'Draft / Unposted' : 'Posting on save' }}
        </span>
      </div>
    </div>
  </section>
</template>
