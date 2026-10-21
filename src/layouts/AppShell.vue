<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import AppSidebar from '@/components/layout/AppSidebar.vue'
import AppToolbar from '@/components/layout/AppToolbar.vue'
import CommandPalette from '@/components/layout/CommandPalette.vue'
import ShortcutHelpDialog from '@/components/layout/ShortcutHelpDialog.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import ToastHost from '@/components/ui/ToastHost.vue'
import { useSessionStore } from '@/stores/session'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const router = useRouter()
const session = useSessionStore()
const helpOpen = ref(false)

/**
 * Global shortcuts follow the muscle memory accountants already have:
 * F4 Contra, F5 Payment, F6 Receipt, F7 Journal, F8 Sales, F9 Purchase,
 * Alt+F8 Credit note, Alt+F9 Debit note, F3 Day book, Ctrl+K command palette.
 */
const VOUCHER_SHORTCUTS: Record<string, string> = {
  F3: '/vouchers',
  F4: '/vouchers/new/contra',
  F5: '/vouchers/new/payment',
  F6: '/vouchers/new/receipt',
  F7: '/vouchers/new/journal',
  F8: '/vouchers/new/sales',
  F9: '/vouchers/new/purchase',
}

function onKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  const typing =
    !!target &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable)

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    ui.openPalette()
    return
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
    event.preventDefault()
    ui.toggleSidebar()
    return
  }

  if ((event.ctrlKey || event.metaKey) && event.key === ',') {
    event.preventDefault()
    void router.push('/settings/preferences')
    return
  }

  if (event.key === 'F1') {
    event.preventDefault()
    helpOpen.value = true
    return
  }

  if (typing) return

  if (event.altKey && (event.key === 'F8' || event.key === 'F9')) {
    event.preventDefault()
    void router.push(
      event.key === 'F8' ? '/vouchers/new/credit-note' : '/vouchers/new/debit-note',
    )
    return
  }

  if (!event.ctrlKey && !event.metaKey && !event.altKey && VOUCHER_SHORTCUTS[event.key]) {
    event.preventDefault()
    void router.push(VOUCHER_SHORTCUTS[event.key]!)
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})

const isMac = computed(
  () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform),
)
</script>

<template>
  <div class="flex h-full w-full overflow-hidden bg-surface text-on-surface">
    <a href="#main-content" class="skip-link">Skip to main content</a>

    <AppSidebar />

    <div class="flex min-w-0 flex-1 flex-col">
      <AppToolbar />

      <!-- A browser preview cannot save. Say so plainly. -->
      <div
        v-if="session.isPreview"
        class="flex shrink-0 items-center justify-center gap-2 border-b border-surface-container bg-warning-soft px-4 py-1.5 text-label-xs font-semibold text-on-tertiary-fixed"
      >
        <MaterialIcon name="visibility" :size="14" />
        Browser preview — the books shown here are sample data and cannot be saved.
      </div>

      <main id="main-content" class="min-h-0 flex-1 overflow-hidden">
        <RouterView v-slot="{ Component, route }">
          <component :is="Component" :key="route.path" />
        </RouterView>
      </main>
    </div>

    <CommandPalette />
    <ShortcutHelpDialog :open="helpOpen" :is-mac="isMac" @close="helpOpen = false" />
    <ToastHost />
  </div>
</template>
