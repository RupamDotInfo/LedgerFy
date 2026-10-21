<script setup lang="ts">
import BaseModal from '@/components/ui/BaseModal.vue'

defineProps<{ open: boolean; isMac?: boolean }>()
defineEmits<{ close: [] }>()

const groups = [
  {
    title: 'Voucher entry',
    items: [
      ['F2', 'Edit the voucher date'],
      ['F3', 'Select voucher type / open the day book'],
      ['F4', 'Contra voucher'],
      ['F5', 'Payment voucher'],
      ['F6', 'Receipt voucher'],
      ['F7', 'Journal voucher'],
      ['F8', 'Sales voucher'],
      ['F9', 'Purchase voucher'],
      ['Alt + F8', 'Credit note'],
      ['Alt + F9', 'Debit note'],
    ],
  },
  {
    title: 'Working in a voucher',
    items: [
      ['Enter', 'Move to the next field'],
      ['Alt + C', 'Create the party inline'],
      ['Ctrl + D', 'Remove the current grid row'],
      ['Ctrl + N', 'Jump to the narration'],
      ['Ctrl + S', 'Save as draft'],
      ['Ctrl + Enter', 'Post the voucher'],
      ['Alt + P', 'Print and preview'],
      ['Esc', 'Close a list or leave the screen'],
    ],
  },
  {
    title: 'Application',
    items: [
      ['Ctrl + K', 'Open the command palette'],
      ['F1', 'Show this shortcut reference'],
      ['Ctrl + ,', 'Open preferences'],
      ['Ctrl + B', 'Collapse or expand the sidebar'],
    ],
  },
]
</script>

<template>
  <BaseModal :open="open" title="Keyboard shortcuts" size="lg" @close="$emit('close')">
    <div class="grid grid-cols-1 gap-space-lg md:grid-cols-3">
      <section v-for="group in groups" :key="group.title">
        <h3 class="section-label mb-2">{{ group.title }}</h3>
        <dl class="space-y-1.5">
          <div
            v-for="[keys, description] in group.items"
            :key="keys"
            class="flex items-center justify-between gap-3"
          >
            <dt class="text-label-sm text-on-surface-variant">{{ description }}</dt>
            <dd>
              <span class="kbd">{{ keys }}</span>
            </dd>
          </div>
        </dl>
      </section>
    </div>

    <template #footer>
      <p class="mr-auto text-label-xs text-outline">
        Shortcuts are active while the application window has focus.
      </p>
    </template>
  </BaseModal>
</template>
