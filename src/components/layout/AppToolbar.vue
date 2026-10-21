<script setup lang="ts">
import { computed } from 'vue'

import BaseDropdown from '@/components/ui/BaseDropdown.vue'
import BaseBadge from '@/components/ui/BaseBadge.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import { useSessionStore } from '@/stores/session'
import { useUiStore } from '@/stores/ui'
import { formatDate } from '@/lib/datetime'

const session = useSessionStore()
const ui = useUiStore()

const companyLabel = computed(() => session.activeCompany?.name ?? 'No company open')
const yearLabel = computed(() => session.activeFinancialYear?.label ?? 'No year')

function chooseCompany(id: string) {
  void session.switchCompany(id)
}

function chooseYear(id: string) {
  void session.switchFinancialYear(id)
}
</script>

<template>
  <header
    class="flex h-12 shrink-0 items-center gap-space-md border-b border-surface-container bg-surface-container-lowest px-space-lg"
    aria-label="Application toolbar"
  >
    <!-- Company selector -->
    <BaseDropdown width="320px">
      <template #trigger="{ open }">
        <button
          type="button"
          class="flex max-w-[300px] items-center gap-space-sm rounded-sm px-space-sm py-1 transition-colors hover:bg-surface-container"
          :class="open ? 'bg-surface-container' : ''"
          aria-haspopup="listbox"
        >
          <span
            class="flex size-6 shrink-0 items-center justify-center rounded-sm bg-primary-fixed text-on-primary-fixed"
          >
            <MaterialIcon name="domain" :size="14" />
          </span>
          <span class="min-w-0 flex-1 text-left">
            <span class="block truncate text-label-md font-bold text-on-surface">
              {{ companyLabel }}
            </span>
          </span>
          <MaterialIcon name="expand_more" :size="15" class="shrink-0 text-outline" />
        </button>
      </template>

      <template #default="{ close }">
        <div class="border-b border-surface-container px-space-md py-space-sm">
          <p class="section-label">Companies</p>
        </div>
        <ul class="max-h-72 overflow-y-auto py-1" role="listbox">
          <li v-for="company in session.companies" :key="company.id">
            <button
              type="button"
              role="option"
              :aria-selected="company.id === session.activeCompanyId"
              class="flex w-full items-center gap-space-sm px-space-md py-space-sm text-left transition-colors hover:bg-surface-container"
              @click="chooseCompany(company.id); close()"
            >
              <span class="min-w-0 flex-1">
                <span class="block truncate text-body-md font-semibold text-on-surface">
                  {{ company.name }}
                </span>
                <span class="block truncate text-label-xs text-outline">
                  {{ company.industry }} · {{ company.gstin ?? 'No GSTIN' }}
                </span>
              </span>
              <MaterialIcon
                v-if="company.id === session.activeCompanyId"
                name="check"
                :size="15"
                class="shrink-0 text-primary"
              />
            </button>
          </li>
        </ul>
        <div class="border-t border-surface-container p-space-sm">
          <RouterLink
            to="/company/create"
            class="flex items-center gap-space-sm rounded-sm px-space-sm py-1.5 text-label-md font-semibold text-primary transition-colors hover:bg-primary-fixed"
            @click="close()"
          >
            <MaterialIcon name="add" :size="15" />
            Create a company
          </RouterLink>
        </div>
      </template>
    </BaseDropdown>

    <!-- Financial year -->
    <BaseDropdown width="240px">
      <template #trigger="{ open }">
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-sm px-space-sm py-1 text-label-md transition-colors hover:bg-surface-container"
          :class="open ? 'bg-surface-container' : ''"
          aria-haspopup="listbox"
        >
          <MaterialIcon name="calendar_month" :size="15" class="shrink-0 text-outline" />
          <span class="font-semibold text-on-surface-variant">{{ yearLabel }}</span>
          <MaterialIcon name="expand_more" :size="14" class="shrink-0 text-outline" />
        </button>
      </template>

      <template #default="{ close }">
        <div class="border-b border-surface-container px-space-md py-space-sm">
          <p class="section-label">Financial year</p>
        </div>
        <ul class="py-1">
          <li v-for="year in session.financialYears" :key="year.id">
            <button
              type="button"
              class="flex w-full items-center gap-space-sm px-space-md py-space-sm text-left transition-colors hover:bg-surface-container"
              @click="chooseYear(year.id); close()"
            >
              <span class="min-w-0 flex-1">
                <span class="block text-body-md font-semibold text-on-surface">{{ year.label }}</span>
                <span class="block text-label-xs text-outline">
                  {{ formatDate(year.start) }} to {{ formatDate(year.end) }}
                </span>
              </span>
              <BaseBadge v-if="year.isClosed" tone="neutral" size="xs">Closed</BaseBadge>
              <MaterialIcon
                v-if="year.id === session.activeYearId"
                name="check"
                :size="15"
                class="shrink-0 text-primary"
              />
            </button>
          </li>
        </ul>
      </template>
    </BaseDropdown>

    <BaseBadge
      v-if="session.activeCompany?.isDemo"
      tone="warning"
      size="xs"
      icon="science"
      class="hidden lg:inline-flex"
    >
      Sample books
    </BaseBadge>
    <BaseBadge
      v-else-if="session.activeCompany"
      tone="neutral"
      size="xs"
      icon="database"
      class="hidden lg:inline-flex"
    >
      Saved locally
    </BaseBadge>

    <div class="ml-auto flex items-center gap-space-sm">
      <button
        type="button"
        class="flex h-8 items-center gap-space-sm rounded-sm bg-surface-container-low px-space-sm text-label-sm text-on-surface-variant transition-colors hover:bg-surface-container"
        aria-label="Open the command palette"
        @click="ui.openPalette()"
      >
        <MaterialIcon name="search" :size="15" />
        <span class="hidden md:inline">Search or run a command</span>
        <span class="kbd hidden lg:inline-flex">Ctrl K</span>
      </button>

      <button
        type="button"
        class="flex h-8 items-center gap-1.5 rounded-sm bg-primary px-space-sm text-label-md font-bold text-on-primary shadow-sm transition-colors hover:bg-primary-container"
        @click="ui.openPalette()"
      >
        <MaterialIcon name="add" :size="16" />
        <span class="hidden lg:inline">Create</span>
      </button>

      <button
        type="button"
        class="flex size-8 items-center justify-center rounded-full bg-surface-container text-on-surface-variant transition-colors hover:bg-surface-container-high"
        aria-label="Account and workspace actions"
      >
        <MaterialIcon name="account_circle" :size="18" />
      </button>
    </div>
  </header>
</template>
