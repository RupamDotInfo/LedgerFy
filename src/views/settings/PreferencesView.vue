<script setup lang="ts">
import { computed, ref } from 'vue'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import { useSessionStore } from '@/stores/session'
import { useToastStore } from '@/stores/toast'
import { formatMoney } from '@/lib/money'
import { formatDate, todayIso } from '@/lib/datetime'

const session = useSessionStore()
const toast = useToastStore()

const currency = computed(() => session.activeCompany?.baseCurrency ?? 'INR')

const SHORTCUT_GROUPS = [
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
      ['Space', 'Open the item list in the grid'],
      ['Alt + C', 'Create the party inline'],
      ['Alt + A', 'Add a ledger allocation line'],
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
      ['F1', 'Show the shortcut reference'],
      ['Ctrl + ,', 'Open preferences'],
      ['Ctrl + B', 'Collapse or expand the sidebar'],
    ],
  },
]

const copyState = ref<'idle' | 'copied' | 'failed'>('idle')

async function copyShortcuts() {
  const text = SHORTCUT_GROUPS.map(
    (group) =>
      `${group.title}\n${group.items.map(([keys, description]) => `  ${keys.padEnd(12)} ${description}`).join('\n')}`,
  ).join('\n\n')

  try {
    await navigator.clipboard.writeText(text)
    copyState.value = 'copied'
    toast.success('Shortcut list copied', 'The list is on the clipboard as plain text.')
  } catch {
    copyState.value = 'failed'
    toast.error('Could not copy', 'The clipboard was not available in this window.')
  }
}

const sampleAmount = 12345678
const sampleDate = todayIso()

const numberRows = computed(() => [
  { label: 'Locale', value: 'en-IN', note: 'Fixed by the shared formatter. Every screen uses it.' },
  {
    label: 'Grouping',
    value: 'Indian',
    note: 'The last three digits are grouped, then the rest in pairs — 12,34,567.',
  },
  {
    label: 'Decimals',
    value: '2',
    note: 'Amounts are held in paise and shown with two decimals.',
  },
  {
    label: 'Negative amounts',
    value: 'Leading minus',
    note: 'A credit balance is shown as a negative figure.',
  },
])

const appearanceRows = [
  {
    label: 'Theme',
    value: 'Light',
    note: 'A light theme only. No dark theme ships in this build, and none is planned for it.',
  },
  {
    label: 'Typeface',
    value: 'Inter',
    note: 'Bundled with the application, so the interface renders with no network access.',
  },
  {
    label: 'Icons',
    value: 'Material Symbols Outlined',
    note: 'Bundled with the application. No second icon library and no inline artwork.',
  },
  {
    label: 'Figures',
    value: 'Tabular, right aligned',
    note: 'Columns of money line up down the page so they can be read at a glance.',
  },
]

const milestonePreferences = [
  'Theme, density and the size of the type',
  'The locale, the number format and the date format',
  'The default voucher type and the default financial year',
  'The page size of the list screens',
  'Whether the sidebar starts open',
]
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      title="Preferences"
      subtitle="How the application looks and behaves"
      icon="tune"
      :breadcrumb="[{ label: 'Settings', to: '/settings/preferences' }, { label: 'Preferences' }]"
    />

    <div class="min-h-0 flex-1 overflow-auto p-space-lg">
      <div
        class="flex items-start gap-space-sm rounded-md border-l-4 border-l-tertiary bg-tertiary-fixed p-space-sm text-body-sm text-on-tertiary-fixed"
        role="status"
      >
        <MaterialIcon name="info" :size="18" class="mt-0.5 shrink-0" />
        <p>
          There is no preferences store in this build, so nothing on this screen is saved. What is
          shown is what is in force today, read from the code that does the work. Every row marked
          <strong>stored with the local database</strong> will become editable when that milestone
          lands.
        </p>
      </div>

      <div class="mt-space-md grid grid-cols-1 items-start gap-space-md xl:grid-cols-2">
        <!-- Display and appearance -->
        <BaseCard title="Display and appearance" description="What the interface looks like">
          <dl class="divide-y divide-surface-container-low">
            <div v-for="row in appearanceRows" :key="row.label" class="flex flex-wrap gap-2 py-2">
              <dt class="w-32 shrink-0 text-label-sm font-semibold text-on-surface">
                {{ row.label }}
              </dt>
              <dd class="min-w-0 flex-1">
                <span class="block text-body-sm text-on-surface">{{ row.value }}</span>
                <span class="block text-label-xs text-outline">{{ row.note }}</span>
              </dd>
              <dd class="shrink-0">
                <BaseBadge tone="neutral" size="xs" icon="lock">Stored with the local database</BaseBadge>
              </dd>
            </div>
          </dl>
        </BaseCard>

        <!-- Number and date format -->
        <BaseCard title="Number and date format" description="How figures and dates are written">
          <dl class="divide-y divide-surface-container-low">
            <div v-for="row in numberRows" :key="row.label" class="flex flex-wrap gap-2 py-2">
              <dt class="w-32 shrink-0 text-label-sm font-semibold text-on-surface">
                {{ row.label }}
              </dt>
              <dd class="min-w-0 flex-1">
                <span class="block text-body-sm text-on-surface">{{ row.value }}</span>
                <span class="block text-label-xs text-outline">{{ row.note }}</span>
              </dd>
            </div>
          </dl>

          <div class="mt-space-md rounded-sm bg-surface-container-low p-space-sm">
            <p class="section-label">As it appears right now</p>
            <dl class="mt-space-xs space-y-1 text-body-sm">
              <div class="flex items-baseline justify-between gap-3">
                <dt class="text-on-surface-variant">An amount</dt>
                <dd class="tabular font-semibold text-on-surface">
                  {{ formatMoney(sampleAmount, currency) }}
                </dd>
              </div>
              <div class="flex items-baseline justify-between gap-3">
                <dt class="text-on-surface-variant">A negative amount</dt>
                <dd class="tabular font-semibold text-on-surface">
                  {{ formatMoney(-sampleAmount, currency) }}
                </dd>
              </div>
              <div class="flex items-baseline justify-between gap-3">
                <dt class="text-on-surface-variant">Today</dt>
                <dd class="tabular font-semibold text-on-surface">{{ formatDate(sampleDate) }}</dd>
              </div>
            </dl>
            <p class="mt-space-xs text-label-xs text-outline">
              These lines are produced by the shared formatter, not written out by hand, so they
              always match the rest of the application.
            </p>
          </div>
        </BaseCard>

        <!-- Defaults -->
        <BaseCard title="Defaults" description="What the application opens with">
          <dl class="divide-y divide-surface-container-low">
            <div class="flex flex-wrap gap-2 py-2">
              <dt class="w-40 shrink-0 text-label-sm font-semibold text-on-surface">
                Default voucher type
              </dt>
              <dd class="min-w-0 flex-1">
                <span class="block text-body-sm text-on-surface">Not set</span>
                <span class="block text-label-xs text-outline">
                  There is no generic new-voucher entry point in this build. Each voucher type is
                  opened on its own screen, and the F-keys open a fixed series each.
                </span>
              </dd>
              <dd class="shrink-0">
                <BaseBadge tone="neutral" size="xs" icon="lock">Stored with the local database</BaseBadge>
              </dd>
            </div>

            <div class="flex flex-wrap gap-2 py-2">
              <dt class="w-40 shrink-0 text-label-sm font-semibold text-on-surface">
                Default financial year
              </dt>
              <dd class="min-w-0 flex-1">
                <span class="block text-body-sm text-on-surface">
                  Open the first open financial year
                </span>
                <span class="block text-label-xs text-outline">
                  This is what the application does today: it takes the first financial year of
                  the company that is not closed. The year now in use is
                  {{ session.activeFinancialYear?.label ?? 'none' }}, and it can be changed for
                  this session from the company switcher in the toolbar.
                </span>
              </dd>
              <dd class="shrink-0">
                <BaseBadge tone="neutral" size="xs" icon="lock">Stored with the local database</BaseBadge>
              </dd>
            </div>

            <div class="flex flex-wrap gap-2 py-2">
              <dt class="w-40 shrink-0 text-label-sm font-semibold text-on-surface">
                Reporting window
              </dt>
              <dd class="min-w-0 flex-1">
                <span class="block text-body-sm text-on-surface">
                  {{ formatDate(session.activePeriod.from) }} to
                  {{ formatDate(session.activePeriod.to) }}
                </span>
                <span class="block text-label-xs text-outline">
                  Taken from the open financial year, cut off at today. This is the window the
                  reports on the home screen use.
                </span>
              </dd>
              <dd class="shrink-0">
                <BaseBadge tone="neutral" size="xs" icon="lock">Stored with the local database</BaseBadge>
              </dd>
            </div>
          </dl>
        </BaseCard>

        <!-- Keyboard shortcuts -->
        <BaseCard
          title="Keyboard shortcuts"
          description="The same list the F1 reference shows"
        >
          <template #actions>
            <BaseButton
              size="sm"
              variant="outlined"
              icon="content_copy"
              @click="copyShortcuts"
            >
              {{ copyState === 'copied' ? 'Copied' : 'Copy the list' }}
            </BaseButton>
          </template>

          <div class="grid grid-cols-1 gap-space-lg md:grid-cols-3">
            <section v-for="group in SHORTCUT_GROUPS" :key="group.title">
              <h3 class="section-label">{{ group.title }}</h3>
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

          <p class="mt-space-sm text-label-xs text-outline">
            These bindings are enforced by the application shell and are active while the window has
            focus. Press
            <span class="kbd">F1</span>
            to open the same list in a dialog.
          </p>
        </BaseCard>
      </div>

      <!-- Milestone -->
      <section class="mt-space-md rounded-md bg-surface-container-lowest p-space-md shadow-sm">
        <header class="flex items-center gap-space-sm">
          <MaterialIcon name="flag" :size="20" class="text-primary" />
          <h2 class="text-headline-sm text-on-surface">What will be stored with the local database</h2>
        </header>
        <p class="mt-0.5 text-label-sm text-outline">
          The local database milestone adds a preferences record per company. These are the
          settings it will hold.
        </p>
        <ul class="mt-space-md grid grid-cols-1 gap-space-sm sm:grid-cols-2 lg:grid-cols-3">
          <li
            v-for="item in milestonePreferences"
            :key="item"
            class="flex items-start gap-2 rounded-sm bg-surface-container-low p-space-sm text-body-sm text-on-surface-variant"
          >
            <MaterialIcon name="check" :size="15" class="mt-0.5 shrink-0 text-primary" />
            {{ item }}
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
