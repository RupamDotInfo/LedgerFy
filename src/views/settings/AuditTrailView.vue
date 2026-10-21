<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BasePagination from '@/components/ui/BasePagination.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import DataTable, { type TableColumn } from '@/components/ui/DataTable.vue'
import FilterBar from '@/components/ui/FilterBar.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import StatTile from '@/components/ui/StatTile.vue'
import { useSessionStore } from '@/stores/session'
import { formatDateTime } from '@/lib/datetime'
import type { AuditEvent } from '@/domain/types'

type AuditRow = {
  id: string
  timestamp: string
  actor: string
  action: string
  recordType: string
  recordLabel: string
  recordId: string
  detail: string
}

const session = useSessionStore()

const events = ref<AuditEvent[]>([])
const allEvents = ref<AuditEvent[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

const from = ref('')
const to = ref('')
const actor = ref('')
const action = ref('')
const recordType = ref('')

const page = ref(1)
const pageSize = ref(25)

const companyId = computed(() => session.activeCompanyId)

const columns: TableColumn[] = [
  { key: 'timestamp', label: 'When', sortable: true, width: '180px' },
  { key: 'actor', label: 'Actor', sortable: true, width: '160px' },
  { key: 'action', label: 'Action', sortable: true, width: '180px' },
  { key: 'recordLabel', label: 'Record' },
  { key: 'detail', label: 'Detail' },
]

async function loadOptions() {
  if (!companyId.value) {
    allEvents.value = []
    return
  }
  try {
    allEvents.value = await session.repository.listAuditEvents(companyId.value)
  } catch {
    allEvents.value = []
  }
}

async function load() {
  if (!companyId.value) {
    events.value = []
    loading.value = false
    return
  }
  loading.value = true
  error.value = null
  try {
    events.value = await session.repository.listAuditEvents(companyId.value, {
      from: from.value ? `${from.value}T00:00:00.000Z` : undefined,
      to: to.value ? `${to.value}T23:59:59.999Z` : undefined,
      actor: actor.value || undefined,
      action: action.value || undefined,
      recordType: recordType.value || undefined,
    })
  } catch (cause) {
    error.value =
      cause instanceof Error ? cause.message : 'The audit events could not be read.'
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await loadOptions()
  await load()
})

watch(companyId, async () => {
  page.value = 1
  await loadOptions()
  await load()
})

watch([from, to, actor, action, recordType], () => {
  page.value = 1
  void load()
})

function uniqueValues(key: 'actor' | 'action' | 'recordType'): string[] {
  const values = new Set(allEvents.value.map((event) => event[key]))
  return [...values].filter(Boolean).sort((left, right) => left.localeCompare(right))
}

const actorOptions = computed(() => [
  { value: '', label: 'All actors' },
  ...uniqueValues('actor').map((value) => ({ value, label: value })),
])

const actionOptions = computed(() => [
  { value: '', label: 'All actions' },
  ...uniqueValues('action').map((value) => ({ value, label: value })),
])

const recordTypeOptions = computed(() => [
  { value: '', label: 'All record types' },
  ...uniqueValues('recordType').map((value) => ({ value, label: value })),
])

const rows = computed<AuditRow[]>(() =>
  events.value.map((event) => ({
    id: event.id,
    timestamp: event.timestamp,
    actor: event.actor,
    action: event.action,
    recordType: event.recordType,
    recordLabel: event.recordLabel,
    recordId: event.recordId,
    detail: event.detail ?? '',
  })),
)

const distinctActors = computed(() => new Set(rows.value.map((row) => row.actor)).size)
const distinctActions = computed(() => new Set(rows.value.map((row) => row.action)).size)
const distinctRecordTypes = computed(() => new Set(rows.value.map((row) => row.recordType)).size)

const sortedRows = computed(() =>
  [...rows.value].sort((left, right) => (left.timestamp < right.timestamp ? 1 : -1)),
)

const totalPages = computed(() => Math.max(1, Math.ceil(sortedRows.value.length / pageSize.value)))

const pagedRows = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return sortedRows.value.slice(start, start + pageSize.value)
})

watch(totalPages, (count) => {
  if (page.value > count) page.value = count
})

function clearFilters() {
  from.value = ''
  to.value = ''
  actor.value = ''
  action.value = ''
  recordType.value = ''
}

const filtersActive = computed(
  () => Boolean(from.value || to.value || actor.value || action.value || recordType.value),
)

function actionTone(value: string): 'positive' | 'info' | 'warning' | 'neutral' {
  if (value.includes('post')) return 'positive'
  if (value.includes('delete') || value.includes('void')) return 'warning'
  if (value.includes('create') || value.includes('update') || value.includes('save')) return 'info'
  return 'neutral'
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      title="Audit trail"
      subtitle="What was done to the books, and who did it"
      icon="history"
      :breadcrumb="[{ label: 'Settings', to: '/settings/preferences' }, { label: 'Audit trail' }]"
    >
      <template #actions>
        <BaseButton size="sm" variant="outlined" icon="refresh" :loading="loading" @click="load">
          Refresh
        </BaseButton>
      </template>
    </PageHeader>

    <FilterBar>
      <BaseInput v-model="from" type="date" size="sm" label="From" class="w-40" />
      <BaseInput v-model="to" type="date" size="sm" label="To" class="w-40" />
      <BaseSelect v-model="actor" size="sm" label="Actor" :options="actorOptions" class="w-52" />
      <BaseSelect v-model="action" size="sm" label="Action" :options="actionOptions" class="w-52" />
      <BaseSelect
        v-model="recordType"
        size="sm"
        label="Record type"
        :options="recordTypeOptions"
        class="w-48"
      />
      <template #trailing>
        <BaseButton
          size="sm"
          variant="text"
          icon="filter_alt_off"
          :disabled="!filtersActive"
          @click="clearFilters"
        >
          Clear
        </BaseButton>
      </template>
    </FilterBar>

    <div class="min-h-0 flex-1 overflow-auto p-space-lg">
      <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Events"
          :value="String(rows.length)"
          icon="history"
          tone="info"
          hint="In the filtered set"
        />
        <StatTile
          label="Actors"
          :value="String(distinctActors)"
          icon="person"
          hint="Distinct actors in the filtered set"
        />
        <StatTile
          label="Actions"
          :value="String(distinctActions)"
          icon="bolt"
          hint="Distinct actions in the filtered set"
        />
        <StatTile
          label="Record types"
          :value="String(distinctRecordTypes)"
          icon="category"
          hint="Distinct record types in the filtered set"
        />
      </div>

      <p
        v-if="error"
        class="mt-space-md flex items-start gap-space-sm rounded-md border-l-4 border-l-error bg-error-container p-space-sm text-body-sm text-on-error-container"
        role="alert"
      >
        <MaterialIcon name="error" :size="18" class="mt-0.5 shrink-0" />
        {{ error }}
      </p>

      <section
        class="mt-space-md flex min-h-0 flex-col overflow-hidden rounded-md bg-surface-container-lowest shadow-sm"
      >
        <DataTable
          :columns="columns"
          :rows="pagedRows"
          row-key="id"
          :loading="loading"
          :clickable="false"
          empty-title="No audit events"
          empty-description="Nothing was recorded for these filters. Widen the date range or clear the filters."
        >
          <template #cell:timestamp="{ row }">
            <span class="tabular text-on-surface-variant">{{ formatDateTime(row.timestamp) }}</span>
          </template>
          <template #cell:actor="{ row }">
            <span class="flex items-center gap-1.5">
              <MaterialIcon name="person" :size="14" class="shrink-0 text-outline" />
              <span class="font-semibold text-on-surface">{{ row.actor }}</span>
            </span>
          </template>
          <template #cell:action="{ row }">
            <BaseBadge :tone="actionTone(row.action)" size="xs">{{ row.action }}</BaseBadge>
          </template>
          <template #cell:recordLabel="{ row }">
            <span class="block truncate font-semibold text-on-surface">{{ row.recordLabel }}</span>
            <span class="block text-label-xs text-outline">{{ row.recordType }}</span>
          </template>
          <template #cell:detail="{ row }">
            <span class="text-on-surface-variant">{{ row.detail || '—' }}</span>
          </template>
        </DataTable>

        <BasePagination
          :page="page"
          :page-size="pageSize"
          :total="sortedRows.length"
          label="Audit events"
          @update:page="page = $event"
          @update:page-size="pageSize = $event"
        />
      </section>

      <p class="mt-space-sm text-label-xs text-outline">
        The events are read from the repository for
        {{ session.activeCompany?.name ?? 'the active company' }}. The date range is matched against
        the time of the event, not the date of the voucher it refers to.
      </p>
    </div>
  </div>
</template>
