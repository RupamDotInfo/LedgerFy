import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

/** Chrome state: sidebar, command palette, and global keyboard shortcuts. */
export const useUiStore = defineStore('ui', () => {
  const sidebarCollapsed = ref(false)
  const commandPaletteOpen = ref(false)
  const openSections = ref<string[]>(['workspace', 'transactions'])
  const globalSearch = ref('')

  const isCollapsed = computed(() => sidebarCollapsed.value)

  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  function openPalette() {
    commandPaletteOpen.value = true
  }

  function closePalette() {
    commandPaletteOpen.value = false
  }

  function toggleSection(id: string) {
    openSections.value = openSections.value.includes(id)
      ? openSections.value.filter((section) => section !== id)
      : [...openSections.value, id]
  }

  function ensureSectionOpen(id: string) {
    if (!openSections.value.includes(id)) {
      openSections.value = [...openSections.value, id]
    }
  }

  return {
    sidebarCollapsed,
    commandPaletteOpen,
    openSections,
    globalSearch,
    isCollapsed,
    toggleSidebar,
    openPalette,
    closePalette,
    toggleSection,
    ensureSectionOpen,
  }
})
