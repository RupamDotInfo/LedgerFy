<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { invoke, isTauri } from '@tauri-apps/api/core'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import { useSessionStore } from '@/stores/session'

/**
 * The native shell is only present inside the Tauri webview. `isTauri()` reads
 * a global that is only injected when `withGlobalTauri` is enabled, so the IPC
 * bridge is probed as well — that is what `invoke` itself uses.
 */
function nativeAvailable(): boolean {
  if (isTauri()) return true
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

interface RuntimeInfo {
  version: string
  startedAt: string
  offline: boolean
}

interface PlannedRole {
  role: string
  covers: string
}

interface PlannedPermission {
  permission: string
  scope: string
  note: string
}

const session = useSessionStore()

const runtime = ref<RuntimeInfo | null>(null)
const platform = ref('Browser build')

onMounted(async () => {
  if (!nativeAvailable()) return
  try {
    runtime.value = await invoke<RuntimeInfo>('runtime_info')
    platform.value = 'Desktop application'
  } catch {
    runtime.value = null
  }
})

const PLANNED_ROLES: PlannedRole[] = [
  {
    role: 'Owner',
    covers: 'Everything, including company settings, users, backups and closing a period.',
  },
  {
    role: 'Accountant',
    covers: 'Vouchers of every type in the open periods, masters, reports and reconciliation.',
  },
  {
    role: 'Cashier',
    covers: 'Receipts, payments and cash entries. Read-only everywhere else.',
  },
  {
    role: 'Auditor',
    covers: 'Read-only across the books, plus the audit trail and the integrity checks.',
  },
  {
    role: 'Viewer',
    covers: 'Reports and statements only. Nothing can be written.',
  },
]

const PLANNED_PERMISSIONS: PlannedPermission[] = [
  {
    permission: 'Create voucher',
    scope: 'Any company the user has been given',
    note: 'Draft vouchers of every type. The user may not post them.',
  },
  {
    permission: 'Post voucher',
    scope: 'Any company the user has been given',
    note: 'Moves a draft into the books. The entry is then written to the audit trail.',
  },
  {
    permission: 'Edit a posted voucher',
    scope: 'Open periods only',
    note: 'A posted voucher in a closed period cannot be edited, only reversed.',
  },
  {
    permission: 'Close a period',
    scope: 'The company the user owns',
    note: 'Owner only. Closing a period is a one-way action in the plan.',
  },
  {
    permission: 'Manage users',
    scope: 'The company the user owns',
    note: 'Owner only. Grants and removes roles.',
  },
  {
    permission: 'Backup',
    scope: 'The machine the application runs on',
    note: 'Takes a backup and reads one back. The file itself is never uploaded.',
  },
  {
    permission: 'Delete master',
    scope: 'Masters that are not in use',
    note: 'A master that is used by a voucher may only be deactivated.',
  },
]

const companyName = computed(() => session.activeCompany?.name ?? 'no company')
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      title="Users and roles"
      subtitle="Who can work in this workspace, and what they may do"
      icon="group"
      :breadcrumb="[{ label: 'Settings', to: '/settings/preferences' }, { label: 'Users and roles' }]"
    >
      <template #actions>
        <BaseBadge tone="neutral" size="sm" icon="person">Single user</BaseBadge>
      </template>
    </PageHeader>

    <div class="min-h-0 flex-1 overflow-auto p-space-lg">
      <div class="grid grid-cols-1 items-start gap-space-md xl:grid-cols-2">
        <!-- The operator -->
        <BaseCard
          title="The local operator"
          description="The single user this workspace is built for"
        >
          <div
            class="flex items-start gap-space-sm rounded-sm border-l-4 border-l-tertiary bg-tertiary-fixed p-space-sm text-body-sm text-on-tertiary-fixed"
            role="status"
          >
            <MaterialIcon name="info" :size="18" class="mt-0.5 shrink-0" />
            <p>
              No accounts are configured and none can be added in this build. LedgerFy runs in
              single-user local mode: whoever opens the application on this machine is the
              operator, and the application keeps no record of who that is.
            </p>
          </div>

          <dl class="mt-space-md divide-y divide-surface-container-low">
            <div class="flex flex-wrap items-baseline justify-between gap-2 py-2">
              <dt class="text-label-sm font-semibold text-on-surface">Operator</dt>
              <dd class="text-body-sm text-on-surface-variant">
                The person using this window — no account, no name, no role
              </dd>
            </div>
            <div class="flex flex-wrap items-baseline justify-between gap-2 py-2">
              <dt class="text-label-sm font-semibold text-on-surface">Working on</dt>
              <dd class="text-body-sm text-on-surface-variant">{{ companyName }}</dd>
            </div>
            <div class="flex flex-wrap items-baseline justify-between gap-2 py-2">
              <dt class="text-label-sm font-semibold text-on-surface">Running on</dt>
              <dd class="text-body-sm text-on-surface-variant">{{ platform }}</dd>
            </div>
            <div class="flex flex-wrap items-baseline justify-between gap-2 py-2">
              <dt class="text-label-sm font-semibold text-on-surface">Version</dt>
              <dd class="tabular text-body-sm text-on-surface-variant">
                {{ runtime?.version ?? '0.1.0' }}
              </dd>
            </div>
            <div class="flex flex-wrap items-baseline justify-between gap-2 py-2">
              <dt class="text-label-sm font-semibold text-on-surface">Network</dt>
              <dd class="text-body-sm text-on-surface-variant">
                {{ runtime ? 'Offline — no data leaves this machine' : 'Browser build — nothing is sent anywhere' }}
              </dd>
            </div>
          </dl>

          <div class="mt-space-md grid grid-cols-1 gap-space-sm sm:grid-cols-2">
            <BaseInput
              model-value=""
              label="Display name"
              readonly
              hint="Not editable — there is no account to attach a name to."
            />
            <BaseInput
              model-value=""
              label="Role"
              readonly
              hint="Not editable — roles arrive with the local database."
            />
          </div>
        </BaseCard>

        <!-- Why there is no user list -->
        <BaseCard title="Why there is no user list" description="The plan, stated plainly">
          <p class="text-body-sm text-on-surface-variant">
            Role-based access control needs two things this build does not have yet: a local
            database that holds accounts, and a place to keep the ledger of who did what. Both
            arrive with the <strong>local database and LAN multi-user</strong> milestone, which is
            also when the application stops being a single window on one desk.
          </p>

          <ol class="mt-space-md space-y-2">
            <li
              v-for="(item, index) in [
                'The local database holds the account records, the roles and the grants.',
                'The audit trail gains an actor that is a user rather than a machine.',
                'A user can be given one company or several.',
                'The same books can be opened on more than one machine on the same network.',
              ]"
              :key="index"
              class="flex items-start gap-2 text-body-sm text-on-surface-variant"
            >
              <span
                class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-container text-[10px] font-bold text-on-surface-variant"
              >
                {{ index + 1 }}
              </span>
              {{ item }}
            </li>
          </ol>

          <p class="mt-space-md rounded-sm bg-surface-container-low p-space-sm text-label-sm text-on-surface-variant">
            Until then, the audit trail records the local operator as a single actor, and every
            action in the books is trusted because there is only one person making it.
          </p>
        </BaseCard>
      </div>

      <!-- Planned roles -->
      <section class="mt-space-md rounded-md bg-surface-container-lowest p-space-md shadow-sm">
        <header class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-space-sm">
            <MaterialIcon name="badge" :size="20" class="text-primary" />
            <h2 class="text-headline-sm text-on-surface">Roles that will exist</h2>
          </div>
          <BaseBadge tone="warning" size="xs" icon="science">A plan, not a setting</BaseBadge>
        </header>
        <p class="mt-0.5 text-label-sm text-outline">
          These roles are what the permission list below will be grouped into. None of them can be
          assigned yet.
        </p>

        <ul class="mt-space-md grid grid-cols-1 gap-space-sm md:grid-cols-2 xl:grid-cols-3">
          <li
            v-for="role in PLANNED_ROLES"
            :key="role.role"
            class="rounded-sm bg-surface-container-low p-space-sm"
          >
            <p class="flex items-center gap-1 text-label-md font-semibold text-on-surface">
              <MaterialIcon name="person" :size="15" class="text-outline" />
              {{ role.role }}
            </p>
            <p class="mt-0.5 text-label-sm text-on-surface-variant">{{ role.covers }}</p>
          </li>
        </ul>
      </section>

      <!-- Permission readiness -->
      <section class="mt-space-md overflow-hidden rounded-md bg-surface-container-lowest shadow-sm">
        <header class="flex flex-wrap items-center justify-between gap-2 px-space-md py-space-sm">
          <div class="flex items-center gap-space-sm">
            <MaterialIcon name="admin_panel_settings" :size="20" class="text-primary" />
            <h2 class="text-headline-sm text-on-surface">Permission readiness</h2>
          </div>
          <BaseBadge tone="warning" size="xs" icon="science">A plan, not a setting</BaseBadge>
        </header>
        <p class="px-space-md pb-space-sm text-label-sm text-outline">
          The permissions each role will be built from, and the scope each one will carry. Nothing
          here is enforced today: in single-user local mode every action is allowed.
        </p>

        <div class="overflow-x-auto">
          <table class="w-full min-w-[640px] text-left text-body-sm">
            <thead class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline">
              <tr>
                <th scope="col" class="px-space-md py-2">Permission</th>
                <th scope="col" class="px-space-md py-2">Planned scope</th>
                <th scope="col" class="px-space-md py-2">What it will mean</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-surface-container-low">
              <tr v-for="row in PLANNED_PERMISSIONS" :key="row.permission">
                <td class="px-space-md py-2 font-semibold text-on-surface">
                  {{ row.permission }}
                </td>
                <td class="px-space-md py-2 text-on-surface-variant">{{ row.scope }}</td>
                <td class="px-space-md py-2 text-on-surface-variant">{{ row.note }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p class="border-t border-surface-container px-space-md py-2 text-label-xs text-outline">
          A permission that is not granted is refused in the interface, and the refusal is written
          to the audit trail. The
          <RouterLink to="/settings/audit" class="font-semibold text-primary hover:underline">
            audit trail
          </RouterLink>
          screen shows the events of the local operator today.
        </p>
      </section>
    </div>
  </div>
</template>
