<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { navigation, VOUCHER_TYPE_META } from '@/app/navigation'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import { useSessionStore } from '@/stores/session'
import { useUiStore } from '@/stores/ui'

interface Command {
  id: string
  title: string
  group: string
  subtitle?: string
  kind: 'navigate' | 'create' | 'record'
  to: string
  icon: string
  shortcut?: string
}

const ui = useUiStore()
const session = useSessionStore()
const router = useRouter()

const query = ref('')
const activeIndex = ref(0)
const inputEl = ref<HTMLInputElement | null>(null)

const navigationCommands = computed<Command[]>(() => {
  const commands: Command[] = []
  for (const section of navigation) {
    for (const item of section.items) {
      commands.push({
        id: `nav-${section.id}-${item.to}`,
        title: item.label,
        group: section.label,
        kind: 'navigate',
        to: item.to,
        icon: item.icon ?? 'circle',
        shortcut: item.shortcut,
      })
    }
  }
  return commands
})

const creationCommands = computed<Command[]>(() =>
  Object.entries(VOUCHER_TYPE_META).map(([key, meta]) => ({
    id: `create-${key}`,
    title: `New ${meta.label}`,
    group: 'Create',
    subtitle: meta.description,
    kind: 'create',
    to: meta.route,
    icon: meta.icon,
    shortcut: meta.shortcut,
  })),
)

const recordCommands = computed<Command[]>(() => {
  const term = query.value.trim().toLowerCase()
  if (!term) return []

  const ledgers = session.ledgers
    .filter((ledger) => ledger.partyKind !== null && ledger.name.toLowerCase().includes(term))
    .slice(0, 6)
    .map((ledger) => ({
      id: `ledger-${ledger.id}`,
      title: ledger.name,
      group: ledger.partyKind === 'customer' ? 'Customers' : 'Suppliers',
      subtitle: 'Open the ledger statement',
      kind: 'record' as const,
      to: `/masters/ledgers?ledger=${ledger.id}`,
      icon: 'person',
    }))

  const items = session.items
    .filter((item) => item.name.toLowerCase().includes(term))
    .slice(0, 6)
    .map((item) => ({
      id: `item-${item.id}`,
      title: item.name,
      group: 'Items',
      subtitle: 'Open the item ledger',
      kind: 'record' as const,
      to: `/masters/items?item=${item.id}`,
      icon: 'inventory_2',
    }))

  return [...ledgers, ...items]
})

const results = computed<Command[]>(() => {
  const term = query.value.trim().toLowerCase()
  const all = [...navigationCommands.value, ...creationCommands.value]

  if (!term) {
    return [...creationCommands.value.slice(0, 4), ...navigationCommands.value.slice(0, 8)]
  }

  const scored = all
    .filter(
      (command) =>
        command.title.toLowerCase().includes(term) ||
        command.group.toLowerCase().includes(term) ||
        (command.subtitle ?? '').toLowerCase().includes(term),
    )
    .sort((left, right) => {
      const leftStarts = left.title.toLowerCase().startsWith(term) ? 0 : 1
      const rightStarts = right.title.toLowerCase().startsWith(term) ? 0 : 1
      return leftStarts - rightStarts
    })

  return [...scored.slice(0, 10), ...recordCommands.value]
})

const grouped = computed(() => {
  const groups = new Map<string, Command[]>()
  for (const command of results.value) {
    const bucket = groups.get(command.group)
    if (bucket) bucket.push(command)
    else groups.set(command.group, [command])
  }
  return [...groups.entries()]
})

watch(
  () => ui.commandPaletteOpen,
  async (isOpen) => {
    if (isOpen) {
      query.value = ''
      activeIndex.value = 0
      await nextTick()
      inputEl.value?.focus()
    }
  },
)

watch(query, () => {
  activeIndex.value = 0
})

function run(command: Command) {
  ui.closePalette()
  void router.push(command.to)
}

function onKeydown(event: KeyboardEvent) {
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      activeIndex.value = Math.min(activeIndex.value + 1, results.value.length - 1)
      break
    case 'ArrowUp':
      event.preventDefault()
      activeIndex.value = Math.max(activeIndex.value - 1, 0)
      break
    case 'Enter': {
      const command = results.value[activeIndex.value]
      if (command) {
        event.preventDefault()
        run(command)
      }
      break
    }
    case 'Escape':
      event.preventDefault()
      ui.closePalette()
      break
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="ui.commandPaletteOpen"
      class="fixed inset-0 z-[120] flex items-start justify-center bg-[#121b2e]/40 p-4 pt-[12vh]"
      @keydown="onKeydown"
    >
      <div class="absolute inset-0" aria-hidden="true" @click="ui.closePalette()" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        class="relative w-full max-w-xl overflow-hidden rounded-md bg-surface-container-lowest shadow-lg"
      >
        <div class="flex items-center gap-space-sm border-b border-surface-container px-space-md py-space-sm">
          <MaterialIcon name="search" :size="17" class="shrink-0 text-outline" />
          <input
            ref="inputEl"
            v-model="query"
            type="text"
            placeholder="Jump to a screen, create a voucher, or find a ledger or item"
            class="w-full bg-transparent text-body-md text-on-surface placeholder:text-outline focus:outline-none"
            aria-label="Search commands"
          />
          <span class="kbd shrink-0">Esc</span>
        </div>

        <div class="max-h-[52vh] overflow-y-auto py-space-sm">
          <template v-if="results.length">
            <div v-for="[group, commands] in grouped" :key="group" class="mb-1">
              <p class="section-label px-space-md py-1">{{ group }}</p>
              <button
                v-for="command in commands"
                :key="command.id"
                type="button"
                class="flex w-full items-center gap-space-sm px-space-md py-space-sm text-left transition-colors"
                :class="
                  results.indexOf(command) === activeIndex
                    ? 'bg-primary-fixed'
                    : 'hover:bg-surface-container'
                "
                @mouseenter="activeIndex = results.indexOf(command)"
                @click="run(command)"
              >
                <span
                  class="flex size-7 shrink-0 items-center justify-center rounded-sm"
                  :class="
                    command.kind === 'create'
                      ? 'bg-primary text-on-primary'
                      : 'bg-surface-container text-on-surface-variant'
                  "
                >
                  <MaterialIcon :name="command.icon" :size="15" />
                </span>
                <span class="min-w-0 flex-1">
                  <span
                    class="block truncate text-body-md font-semibold"
                    :class="results.indexOf(command) === activeIndex ? 'text-on-primary-fixed' : 'text-on-surface'"
                  >
                    {{ command.title }}
                  </span>
                  <span v-if="command.subtitle" class="block truncate text-label-xs text-outline">
                    {{ command.subtitle }}
                  </span>
                </span>
                <span
                  v-if="command.kind === 'create'"
                  class="shrink-0 rounded-full bg-tertiary-fixed px-2 py-0.5 text-[10px] font-bold text-on-tertiary-fixed"
                >
                  Creates data
                </span>
                <span v-else-if="command.shortcut" class="kbd shrink-0">{{ command.shortcut }}</span>
              </button>
            </div>
          </template>

          <div v-else class="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <span class="flex size-9 items-center justify-center rounded-full bg-surface-container">
              <MaterialIcon name="search_off" :size="17" class="text-outline" />
            </span>
            <p class="text-body-md font-semibold text-on-surface">
              No commands match "{{ query }}"
            </p>
            <p class="text-label-sm text-outline">
              Try a screen name, a voucher type, or a ledger name.
            </p>
          </div>
        </div>

        <div
          class="flex items-center justify-between border-t border-surface-container bg-surface-container-low/60 px-space-md py-space-sm text-label-xs text-outline"
        >
          <span class="flex items-center gap-3">
            <span class="flex items-center gap-1"><span class="kbd">↑</span><span class="kbd">↓</span> navigate</span>
            <span class="flex items-center gap-1"><span class="kbd">↵</span> open</span>
          </span>
          <span class="flex items-center gap-1"><span class="kbd">Ctrl</span><span class="kbd">K</span> to open</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>
