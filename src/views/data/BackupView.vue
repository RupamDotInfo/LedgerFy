<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseEmptyState from '@/components/ui/BaseEmptyState.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import { useSessionStore } from '@/stores/session'
import { useToastStore } from '@/stores/toast'
import { isDesktopRuntime } from '@/lib/native'
import { formatDateTime } from '@/lib/datetime'

interface BackupInfo {
  name: string
  path: string
  sizeBytes: number
  createdAt: string
  verified: boolean
}

interface DataLocation {
  root: string
  backupDir: string
  platform: string
  databasePath: string
  schemaVersion: number
  error: string | null
}

interface RuntimeInfo {
  version: string
  startedAt: string
  offline: boolean
  databaseAvailable: boolean
}

const session = useSessionStore()
const toast = useToastStore()

const native = ref(isDesktopRuntime())
const loading = ref(false)
const creating = ref(false)
const error = ref<string | null>(null)

const backups = ref<BackupInfo[]>([])
const location = ref<DataLocation | null>(null)
const runtime = ref<RuntimeInfo | null>(null)

const isDemoRepository = computed(() => session.repository.info.kind === 'demo')

// ---------------------------------------------------------------------------
// Reading the native state
// ---------------------------------------------------------------------------

async function loadBackups() {
  if (!native.value) {
    backups.value = []
    return
  }
  try {
    backups.value = await invoke<BackupInfo[]>('list_database_backups')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'The backup folder could not be read.'
  }
}

async function loadLocation() {
  if (!native.value) return
  try {
    location.value = await invoke<DataLocation>('data_location')
  } catch (cause) {
    error.value =
      cause instanceof Error ? cause.message : 'The application data directory could not be read.'
  }
  try {
    runtime.value = await invoke<RuntimeInfo>('runtime_info')
  } catch {
    runtime.value = null
  }
}

async function refresh() {
  loading.value = true
  error.value = null
  await Promise.all([loadBackups(), loadLocation()])
  loading.value = false
}

onMounted(refresh)
watch(() => session.activeCompanyId, refresh)

// ---------------------------------------------------------------------------
// Creating a backup
// ---------------------------------------------------------------------------

async function createBackup() {
  if (!native.value) return
  creating.value = true
  error.value = null
  try {
    const created = await invoke<BackupInfo>('create_database_backup', {
      label: session.activeCompany?.name ?? 'workspace',
    })
    await loadBackups()
    if (created.verified) {
      toast.success(
        'Backup written and verified',
        `${created.name} was reopened and checked before it was kept.`,
      )
    } else {
      toast.warning(
        'Backup written but not verified',
        `${created.name} could not be read back. Treat it as unverified.`,
      )
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'The backup could not be written.'
    error.value = message
    toast.error('Backup failed', message)
  } finally {
    creating.value = false
  }
}

// ---------------------------------------------------------------------------
// Restoring
// ---------------------------------------------------------------------------

const restoreOpen = ref(false)
const restoreTarget = ref<BackupInfo | null>(null)
const restoring = ref(false)

function openRestore(backup: BackupInfo) {
  restoreTarget.value = backup
  restoreOpen.value = true
}

async function confirmRestore() {
  const target = restoreTarget.value
  if (!target) return

  restoring.value = true
  error.value = null
  try {
    await invoke<BackupInfo>('restore_database_backup', { name: target.name })

    // The workspace was replaced, so the open session no longer matches it.
    await session.bootstrap()
    if (session.activeCompanyId) {
      await session.switchCompany(session.activeCompanyId)
    }

    restoreOpen.value = false
    restoreTarget.value = null
    await loadBackups()
    toast.success(
      'Workspace restored',
      'The backup was verified and put in place. A copy of the previous database was kept in the backup folder.',
    )
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'The backup could not be restored.'
    error.value = message
    toast.error('Restore failed', message)
  } finally {
    restoring.value = false
  }
}

// ---------------------------------------------------------------------------
// Deleting
// ---------------------------------------------------------------------------

const deleteTarget = ref<BackupInfo | null>(null)
const deleteOpen = ref(false)
const deleting = ref(false)

function openDelete(backup: BackupInfo) {
  deleteTarget.value = backup
  deleteOpen.value = true
}

async function confirmDelete() {
  const target = deleteTarget.value
  if (!target) return
  deleting.value = true
  error.value = null
  try {
    await invoke('delete_database_backup', { name: target.name })
    deleteOpen.value = false
    deleteTarget.value = null
    await loadBackups()
    toast.success('Backup deleted', `${target.name} was removed from the backup folder.`)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'The backup could not be deleted.'
    error.value = message
    toast.error('Delete failed', message)
  } finally {
    deleting.value = false
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

const verifiedCount = computed(() => backups.value.filter((backup) => backup.verified).length)
const unverifiedCount = computed(() => backups.value.length - verifiedCount.value)

/** `BaseEmptyState` renders the icon component without a name, so bind one here. */
const NoFolderIcon = () => h(MaterialIcon, { name: 'folder_off', size: 19 })
const NoBackupIcon = () => h(MaterialIcon, { name: 'backup', size: 19 })
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      title="Backup and restore"
      subtitle="Write a verified snapshot of the workspace, and read one back"
      icon="backup"
      :breadcrumb="[
        { label: 'Data and tools', to: '/data/integrity' },
        { label: 'Backup and restore' },
      ]"
    >
      <template #actions>
        <BaseButton
          size="sm"
          variant="primary"
          icon="add"
          :disabled="!native"
          :loading="creating"
          @click="createBackup"
        >
          Create backup
        </BaseButton>
      </template>
    </PageHeader>

    <div class="min-h-0 flex-1 overflow-auto p-space-lg">
      <!-- Where the data lives -->
      <section class="rounded-md bg-surface-container-lowest p-space-md shadow-sm">
        <header class="flex items-center gap-space-sm">
          <MaterialIcon name="folder_open" :size="20" class="text-primary" />
          <h2 class="text-headline-sm text-on-surface">Where the data lives</h2>
        </header>

        <div v-if="loading" class="mt-space-md space-y-space-sm">
          <BaseSkeleton class="h-5 w-2/3" />
          <BaseSkeleton class="h-5 w-1/2" />
        </div>

        <div v-else-if="native && location" class="mt-space-md space-y-space-sm">
          <dl class="grid grid-cols-1 gap-space-sm sm:grid-cols-2 lg:grid-cols-4">
            <div class="rounded-sm bg-surface-container-low p-space-sm">
              <dt class="section-label">Workspace database</dt>
              <dd class="mt-0.5 break-all text-body-sm text-on-surface">
                {{ location.databasePath }}
              </dd>
            </div>
            <div class="rounded-sm bg-surface-container-low p-space-sm">
              <dt class="section-label">Backup folder</dt>
              <dd class="mt-0.5 break-all text-body-sm text-on-surface">
                {{ location.backupDir }}
              </dd>
            </div>
            <div class="rounded-sm bg-surface-container-low p-space-sm">
              <dt class="section-label">Schema version</dt>
              <dd class="mt-0.5 text-body-sm text-on-surface tabular">
                {{ location.schemaVersion }}
              </dd>
            </div>
            <div class="rounded-sm bg-surface-container-low p-space-sm">
              <dt class="section-label">Platform</dt>
              <dd class="mt-0.5 text-body-sm text-on-surface">{{ location.platform }}</dd>
            </div>
          </dl>
          <p v-if="runtime" class="text-label-sm text-outline">
            LedgerFy {{ runtime.version }} · running offline · started
            {{ formatDateTime(runtime.startedAt) }}
          </p>
        </div>

        <div v-else class="mt-space-md space-y-space-sm">
          <div
            class="flex items-start gap-space-sm rounded-sm border-l-4 border-l-tertiary bg-tertiary-fixed p-space-sm text-body-sm text-on-tertiary-fixed"
            role="status"
          >
            <MaterialIcon name="info" :size="18" class="mt-0.5 shrink-0" />
            <p>
              This window is running the application in a browser, so the workspace is the
              <strong>in-memory sample repository</strong>. It has no on-disk location: nothing the
              books do is written to disk. The database, the backup folder and restore are native
              capabilities of the desktop application.
            </p>
          </div>
          <p class="text-label-sm text-outline">
            Run <span class="kbd">npm run tauri:dev</span> to open the desktop shell, where the
            database, the backup folder, the backup list and restore are available.
          </p>
        </div>
      </section>

      <!-- What a backup contains -->
      <section class="mt-space-md rounded-md bg-surface-container-lowest p-space-md shadow-sm">
        <header class="flex items-center gap-space-sm">
          <MaterialIcon name="inventory_2" :size="20" class="text-primary" />
          <h2 class="text-headline-sm text-on-surface">What a backup contains</h2>
        </header>

        <div class="mt-space-md grid grid-cols-1 gap-space-md md:grid-cols-2">
          <div class="rounded-sm bg-secondary-container/30 p-space-sm">
            <p class="flex items-center gap-1 text-label-md font-semibold text-on-secondary-container">
              <MaterialIcon name="check_circle" :size="15" />
              Included in the snapshot
            </p>
            <ul class="mt-space-xs space-y-1 text-body-sm text-on-surface-variant">
              <li>Every company in the workspace, with its financial years</li>
              <li>Ledgers, parties, items, tax categories and the supporting masters</li>
              <li>Every voucher with its double-entry lines, item lines and tax breakup</li>
              <li>Stock movements, bank statement lines and the audit trail</li>
              <li>The schema version, so a restore can be checked before it is used</li>
            </ul>
          </div>

          <div class="rounded-sm bg-tertiary-fixed/50 p-space-sm">
            <p class="flex items-center gap-1 text-label-md font-semibold text-on-tertiary-fixed">
              <MaterialIcon name="block" :size="15" />
              Not included
            </p>
            <ul class="mt-space-xs space-y-1 text-body-sm text-on-surface-variant">
              <li>Preferences, user accounts and role assignments</li>
              <li>Attachments, scanned documents and logos</li>
              <li>Bank statement files that were imported but not reconciled</li>
              <li>Anything stored outside the workspace database</li>
            </ul>
          </div>
        </div>

        <p
          v-if="isDemoRepository"
          class="mt-space-md rounded-sm bg-surface-container-low p-space-sm text-body-sm text-on-surface-variant"
        >
          The sample repository is held in memory. A backup taken here captures a
          <strong>snapshot of the books as they stand now</strong>, not a copy of a live database
          file. Closing the window discards everything the books held, and the backup file keeps
          the snapshot.
        </p>
      </section>

      <!-- Error -->
      <p
        v-if="error"
        class="mt-space-md flex items-start gap-space-sm rounded-md border-l-4 border-l-error bg-error-container p-space-sm text-body-sm text-on-error-container"
        role="alert"
      >
        <MaterialIcon name="error" :size="18" class="mt-0.5 shrink-0" />
        {{ error }}
      </p>

      <!-- Backup list -->
      <section class="mt-space-md overflow-hidden rounded-md bg-surface-container-lowest shadow-sm">
        <header class="flex flex-wrap items-center justify-between gap-3 px-space-md py-space-sm">
          <div class="flex items-center gap-space-sm">
            <MaterialIcon name="list" :size="20" class="text-primary" />
            <h2 class="text-headline-sm text-on-surface">Backups on disk</h2>
          </div>
          <div class="flex items-center gap-2">
            <BaseBadge tone="positive" size="xs" icon="verified">
              {{ verifiedCount }} verified
            </BaseBadge>
            <BaseBadge v-if="unverifiedCount" tone="danger" size="xs" icon="gpp_maybe">
              {{ unverifiedCount }} unverified
            </BaseBadge>
          </div>
        </header>

        <div v-if="loading" class="space-y-space-sm p-space-md">
          <BaseSkeleton v-for="index in 3" :key="index" class="h-12" />
        </div>

        <template v-else-if="!native">
          <BaseEmptyState
            title="No backup folder in the browser build"
            description="The backup folder belongs to the desktop application. Open LedgerFy as a desktop app to list, write and restore backups."
            :icon="NoFolderIcon"
          >
            <BaseButton size="sm" variant="outlined" icon="refresh" @click="refresh">
              Check again
            </BaseButton>
          </BaseEmptyState>
        </template>

        <template v-else-if="backups.length">
          <ul class="divide-y divide-surface-container-low">
            <li
              v-for="backup in backups"
              :key="backup.name"
              class="flex flex-wrap items-center gap-3 px-space-md py-space-sm"
            >
              <span
                class="flex size-8 shrink-0 items-center justify-center rounded-sm bg-surface-container text-on-surface-variant"
                aria-hidden="true"
              >
                <MaterialIcon name="database" :size="18" />
              </span>

              <div class="min-w-0 flex-1">
                <p class="truncate text-body-md font-semibold text-on-surface">{{ backup.name }}</p>
                <p class="truncate text-label-xs text-outline">
                  {{ formatBytes(backup.sizeBytes) }} · {{ formatDateTime(backup.createdAt) }} ·
                  {{ backup.path }}
                </p>
              </div>

              <BaseBadge v-if="backup.verified" tone="positive" size="xs" icon="verified">
                Verified
              </BaseBadge>
              <BaseBadge v-else tone="danger" size="xs" icon="gpp_maybe">Unverified</BaseBadge>

              <div class="flex items-center gap-1.5">
                <BaseButton
                  size="xs"
                  variant="outlined"
                  icon="restore"
                  :disabled="!backup.verified"
                  @click="openRestore(backup)"
                >
                  Restore
                </BaseButton>
                <BaseButton
                  size="xs"
                  variant="text"
                  icon="delete"
                  aria-label="Delete backup"
                  @click="openDelete(backup)"
                >
                  Delete
                </BaseButton>
              </div>
            </li>
          </ul>
        </template>

        <BaseEmptyState
          v-else
          title="No backups yet"
          description="Create a backup to write a verified snapshot of the workspace into the backup folder."
          :icon="NoBackupIcon"
        >
          <BaseButton
            size="sm"
            variant="primary"
            icon="add"
            :disabled="!native"
            :loading="creating"
            @click="createBackup"
          >
            Create backup
          </BaseButton>
        </BaseEmptyState>
      </section>
    </div>

    <!-- Restore confirmation -->
    <BaseModal
      :open="restoreOpen"
      title="Restore this backup?"
      :description="restoreTarget?.name ?? ''"
      size="md"
      @close="restoreOpen = false"
    >
      <div v-if="restoreTarget" class="space-y-space-md pt-space-xs">
        <div
          v-if="!restoreTarget.verified"
          class="flex items-start gap-space-sm rounded-sm border-l-4 border-l-error bg-error-container p-space-sm text-body-sm text-on-error-container"
          role="alert"
        >
          <MaterialIcon name="error" :size="18" class="mt-0.5 shrink-0" />
          <p>
            This backup could not be verified when it was listed, so it is not offered for restore.
            Take a fresh backup instead.
          </p>
        </div>

        <p class="text-body-sm text-on-surface-variant">
          This backup was taken on
          <strong>{{ formatDateTime(restoreTarget.createdAt) }}</strong> and is
          {{ formatBytes(restoreTarget.sizeBytes) }}.
        </p>

        <ul class="space-y-1 text-body-sm text-on-surface-variant">
          <li class="flex items-start gap-1.5">
            <MaterialIcon name="arrow_forward" :size="15" class="mt-0.5 shrink-0 text-outline" />
            Restoring replaces the <strong>whole workspace</strong>, not one company. Every
            company, master and voucher in the current database is replaced by the ones in the
            backup.
          </li>
          <li class="flex items-start gap-1.5">
            <MaterialIcon name="arrow_forward" :size="15" class="mt-0.5 shrink-0 text-outline" />
            The backup is opened and checked before anything is replaced. If it fails that check,
            nothing is touched.
          </li>
          <li class="flex items-start gap-1.5">
            <MaterialIcon name="arrow_forward" :size="15" class="mt-0.5 shrink-0 text-outline" />
            A copy of the current database is kept in the backup folder before the restore, so
            the previous state can be put back by hand.
          </li>
          <li class="flex items-start gap-1.5">
            <MaterialIcon name="arrow_forward" :size="15" class="mt-0.5 shrink-0 text-outline" />
            The open company is reloaded afterwards, so the workspace you see matches the
            restored database.
          </li>
        </ul>
      </div>

      <template #footer>
        <BaseButton size="sm" variant="text" @click="restoreOpen = false">Cancel</BaseButton>
        <BaseButton
          size="sm"
          variant="primary"
          icon="restore"
          :loading="restoring"
          :disabled="!restoreTarget?.verified"
          @click="confirmRestore"
        >
          Restore now
        </BaseButton>
      </template>
    </BaseModal>

    <!-- Delete confirmation -->
    <BaseModal
      :open="deleteOpen"
      title="Delete this backup?"
      :description="deleteTarget?.name ?? ''"
      size="sm"
      @close="deleteOpen = false"
    >
      <p class="pt-space-xs text-body-sm text-on-surface-variant">
        The file is removed from the backup folder and cannot be recovered from LedgerFy. If it was
        the only copy of a snapshot, take a new backup before continuing.
      </p>

      <template #footer>
        <BaseButton size="sm" variant="text" @click="deleteOpen = false">Keep it</BaseButton>
        <BaseButton
          size="sm"
          variant="danger"
          icon="delete"
          :loading="deleting"
          @click="confirmDelete"
        >
          Delete backup
        </BaseButton>
      </template>
    </BaseModal>
  </div>
</template>
