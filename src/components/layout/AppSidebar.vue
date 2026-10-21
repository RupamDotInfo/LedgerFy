<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import BrandMark from '@/components/layout/BrandMark.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import { navigation } from '@/app/navigation'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const route = useRoute()

const collapsed = computed(() => ui.sidebarCollapsed)

function isActive(to: string): boolean {
  if (to === '/') return route.path === '/'
  return route.path === to || route.path.startsWith(`${to}/`)
}

function sectionIsActive(sectionId: string): boolean {
  const section = navigation.find((candidate) => candidate.id === sectionId)
  if (!section) return false
  return section.items.some((item) => isActive(item.to))
}

function onSectionClick(sectionId: string) {
  if (collapsed.value) {
    ui.sidebarCollapsed = false
    ui.ensureSectionOpen(sectionId)
    return
  }
  ui.toggleSection(sectionId)
}
</script>

<template>
  <aside
    class="flex h-full shrink-0 flex-col bg-surface-container-lowest transition-[width] duration-150"
    :class="collapsed ? 'w-[56px]' : 'w-[236px]'"
    aria-label="Primary navigation"
  >
    <div
      class="flex h-12 shrink-0 items-center border-b border-surface-container px-space-sm"
      :class="collapsed ? 'justify-center' : 'justify-between'"
    >
      <RouterLink
        to="/"
        class="min-w-0 rounded-sm focus-visible:outline-2 focus-visible:outline-primary"
      >
        <BrandMark :size="24" :show-wordmark="!collapsed" />
      </RouterLink>
      <button
        v-if="!collapsed"
        type="button"
        class="rounded-sm p-1 text-outline transition-colors hover:bg-surface-container hover:text-on-surface"
        aria-label="Collapse sidebar"
        @click="ui.toggleSidebar()"
      >
        <MaterialIcon name="left_panel_close" :size="16" />
      </button>
    </div>

    <nav class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-space-sm py-space-sm">
      <div v-for="section in navigation" :key="section.id" class="mb-0.5">
        <div v-if="section.flat && !collapsed" class="px-space-sm pb-0.5 pt-1">
          <p class="section-label">{{ section.label }}</p>
        </div>

        <div v-else-if="section.flat" class="flex justify-center py-1">
          <RouterLink
            :to="section.items[0]!.to"
            class="flex size-8 items-center justify-center rounded-sm transition-colors"
            :class="
              isActive(section.items[0]!.to)
                ? 'bg-primary-fixed text-on-primary-fixed'
                : 'text-on-surface-variant hover:bg-surface-container'
            "
            :title="section.items[0]!.label"
          >
            <MaterialIcon :name="section.items[0]!.icon ?? 'home'" :size="18" />
          </RouterLink>
        </div>

        <button
          v-else
          type="button"
          class="group flex w-full items-center gap-space-sm rounded-sm px-space-sm py-1.5 text-left transition-colors"
          :class="[
            collapsed ? 'justify-center text-outline' : 'text-outline hover:text-on-surface-variant',
            sectionIsActive(section.id) ? 'text-on-surface-variant' : '',
          ]"
          :aria-expanded="ui.openSections.includes(section.id)"
          :title="collapsed ? section.label : undefined"
          @click="onSectionClick(section.id)"
        >
          <MaterialIcon :name="section.icon" :size="15" />
          <span v-if="!collapsed" class="min-w-0 flex-1 truncate">{{ section.label }}</span>
          <MaterialIcon
            v-if="!collapsed"
            name="expand_more"
            :size="14"
            class="shrink-0 transition-transform duration-150"
            :class="ui.openSections.includes(section.id) ? '' : '-rotate-90'"
          />
        </button>

        <ul
          v-if="!collapsed && ui.openSections.includes(section.id)"
          class="mt-0.5 space-y-0.5 border-l border-surface-container pl-space-sm"
        >
          <li v-for="item in section.items" :key="item.to">
            <RouterLink
              :to="item.to"
              class="group relative flex items-center gap-space-sm rounded-sm px-space-sm py-1.5 text-label-md transition-colors"
              :class="
                isActive(item.to)
                  ? 'bg-primary-fixed font-semibold text-on-primary-fixed'
                  : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
              "
            >
              <MaterialIcon
                :name="item.icon ?? 'circle'"
                :size="15"
                class="shrink-0 opacity-80"
              />
              <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
              <span v-if="item.shortcut" class="kbd shrink-0">{{ item.shortcut }}</span>
              <span
                v-else-if="item.isAction"
                class="material-symbols-outlined shrink-0 text-outline"
                style="font-size: 13px"
                aria-hidden="true"
              >
                add
              </span>
            </RouterLink>
          </li>
        </ul>
      </div>
    </nav>

    <div class="shrink-0 border-t border-surface-container p-space-sm">
      <button
        v-if="collapsed"
        type="button"
        class="flex w-full items-center justify-center rounded-sm py-1.5 text-outline transition-colors hover:bg-surface-container hover:text-on-surface"
        aria-label="Expand sidebar"
        @click="ui.toggleSidebar()"
      >
        <MaterialIcon name="left_panel_open" :size="18" />
      </button>
      <div v-else class="rounded-sm bg-surface-container-low px-space-sm py-1.5">
        <p class="text-label-xs font-bold text-on-surface-variant">Local workspace</p>
        <p class="mt-0.5 truncate text-[10px] text-outline">Books stored on this device</p>
      </div>
    </div>
  </aside>
</template>
