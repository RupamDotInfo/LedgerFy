<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import { navigation } from '@/app/navigation'
import { useUiStore } from '@/stores/ui'

const route = useRoute()
const router = useRouter()
const ui = useUiStore()

const query = ref('')

const requestedPath = computed(() => route.fullPath || '/')

const allDestinations = computed(() =>
  navigation.flatMap((section) =>
    section.items.map((item) => ({ ...item, group: section.label })),
  ),
)

const matches = computed(() => {
  const term = query.value.trim().toLowerCase()
  if (!term) return []
  return allDestinations.value
    .filter((item) => item.label.toLowerCase().includes(term))
    .slice(0, 6)
})

function openPalette() {
  ui.openPalette()
}

function go(to: string) {
  void router.push(to)
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      title="Screen not found"
      subtitle="The address that was opened does not lead anywhere"
      icon="explore_off"
      :breadcrumb="[{ label: 'Home', to: '/' }, { label: 'Not found' }]"
    />

    <div class="min-h-0 flex-1 overflow-auto p-space-lg">
      <div class="mx-auto flex max-w-[720px] flex-col items-center py-space-xl text-center">
        <span
          class="flex size-16 items-center justify-center rounded-full bg-primary-fixed text-on-primary-fixed"
          aria-hidden="true"
        >
          <MaterialIcon name="explore_off" :size="30" />
        </span>

        <h2 class="mt-space-md text-headline-lg font-bold text-on-surface">
          There is no screen at this address
        </h2>
        <p class="mt-space-xs max-w-md text-body-md text-on-surface-variant">
          Nothing has gone wrong with the books. The address simply does not match any screen in
          LedgerFy, so there is nothing to show here.
        </p>

        <p
          class="mt-space-md rounded-sm bg-surface-container-low px-space-sm py-1 font-mono text-body-sm text-on-surface"
        >
          {{ requestedPath }}
        </p>

        <!-- Search -->
        <form class="mt-space-lg w-full max-w-md text-left" @submit.prevent="openPalette">
          <label class="block">
            <span class="section-label">Find the screen you wanted</span>
            <BaseInput
              v-model="query"
              type="search"
              placeholder="Type a screen name, then press Enter"
              class="mt-space-xs"
            />
          </label>

          <div class="mt-1 flex items-center justify-between gap-2">
            <p class="text-label-xs text-outline">
              Enter opens the command palette, which also finds ledgers and items.
            </p>
            <button type="submit" class="shrink-0 text-label-xs font-semibold text-primary hover:underline">
              Open it now
            </button>
          </div>

          <ul
            v-if="matches.length"
            class="mt-space-sm divide-y divide-surface-container-low overflow-hidden rounded-sm border border-surface-container bg-surface-container-lowest"
          >
            <li v-for="item in matches" :key="item.to">
              <button
                type="button"
                class="flex w-full items-center gap-2 px-space-sm py-2 text-left text-body-sm text-on-surface transition-colors hover:bg-surface-container-low"
                @click="go(item.to)"
              >
                <MaterialIcon v-if="item.icon" :name="item.icon" :size="16" class="shrink-0 text-primary" />
                <span class="font-semibold">{{ item.label }}</span>
                <span class="text-label-xs text-outline">{{ item.group }}</span>
                <MaterialIcon name="chevron_right" :size="16" class="ml-auto text-outline" />
              </button>
            </li>
          </ul>
        </form>

        <!-- Quick links -->
        <div class="mt-space-lg flex flex-wrap items-center justify-center gap-2">
          <BaseButton size="sm" variant="primary" icon="home" @click="go('/')">
            Go to Home
          </BaseButton>
          <BaseButton size="sm" variant="outlined" icon="menu_book" @click="go('/vouchers')">
            Voucher register
          </BaseButton>
          <BaseButton size="sm" variant="text" icon="search" @click="openPalette">
            Command palette
          </BaseButton>
        </div>

        <p class="mt-space-lg text-label-xs text-outline">
          If a link inside LedgerFy sent you here, that is a bug worth reporting. Press
          <span class="kbd">Ctrl</span>
          +
          <span class="kbd">K</span>
          at any time to search the application.
        </p>
      </div>
    </div>
  </div>
</template>
