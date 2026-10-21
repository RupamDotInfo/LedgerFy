<script setup lang="ts">
/**
 * The structures of the company.
 *
 * A structure says what a finished item is made of. A draft can be edited and
 * released; a released structure is immutable, so it shows no edit control and
 * says so.
 */

import { computed, onMounted, ref, watch } from 'vue'

import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseEmptyState from '@/components/ui/BaseEmptyState.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import StatTile from '@/components/ui/StatTile.vue'
import { buildBom, type BomContext } from '@/domain/production'
import { formatQuantity, quantityFromString } from '@/domain/quantity'
import type { Bom, BomLine } from '@/domain/types'
import type { BomWithLines } from '@/repositories/contracts'
import { useSessionStore } from '@/stores/session'
import { useToastStore } from '@/stores/toast'

const session = useSessionStore()
const toast = useToastStore()

const structures = ref<BomWithLines[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const busy = ref(false)

const itemNames = computed(() => {
  const map = new Map<string, string>()
  for (const item of session.items) map.set(item.id, item.name)
  return map
})

const itemOptions = computed(() =>
  session.items
    .filter((item) => item.isInventory)
    .map((item) => ({ value: item.id, label: item.name })),
)

const releasedCount = computed(
  () => structures.value.filter((entry) => entry.bom.status === 'released').length,
)
const draftCount = computed(
  () => structures.value.filter((entry) => entry.bom.status === 'draft').length,
)

async function load() {
  const companyId = session.activeCompanyId
  if (!companyId) {
    structures.value = []
    loading.value = false
    return
  }
  loading.value = true
  error.value = null
  try {
    structures.value = await session.repository.listBoms(companyId)
  } catch (cause) {
    error.value =
      cause instanceof Error ? cause.message : 'The structures could not be loaded.'
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => [session.activeCompanyId, session.activeYearId], load)

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'The request was refused.'
}

/**
 * The context the domain needs to write a structure.
 *
 * The released structures are read with their components, because a structure
 * that would consume itself has to be found whichever structure in the cycle is
 * being written.
 */
function bomContext(companyId: string): BomContext {
  return {
    companyId,
    items: new Map(session.items.map((item) => [item.id, item])),
    releasedBoms: structures.value
      .filter((entry) => entry.bom.status === 'released')
      .map((entry) => ({ bom: entry.bom, lines: entry.lines })),
    idFactory: () => `bom-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`,
    now: () => new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Writing a structure
// ---------------------------------------------------------------------------

interface ComponentRow {
  itemId: string
  quantity: string
}

const editorOpen = ref(false)
const editing = ref<BomWithLines | null>(null)
const editorItemId = ref('')
const editorOutput = ref('1')
const editorNarration = ref('')
const editorComponents = ref<ComponentRow[]>([])
const editorError = ref<string | null>(null)

function openCreate() {
  editing.value = null
  editorItemId.value = itemOptions.value[0]?.value ?? ''
  editorOutput.value = '1'
  editorNarration.value = ''
  editorComponents.value = [{ itemId: itemOptions.value[0]?.value ?? '', quantity: '1' }]
  editorError.value = null
  editorOpen.value = true
}

function openEdit(entry: BomWithLines) {
  if (entry.bom.status !== 'draft') return
  editing.value = entry
  editorItemId.value = entry.bom.itemId
  editorOutput.value = String(entry.bom.outputQuantityMilli / 1000)
  editorNarration.value = entry.bom.narration
  editorComponents.value = entry.lines.map((line) => ({
    itemId: line.itemId,
    quantity: String(line.quantityMilli / 1000),
  }))
  editorError.value = null
  editorOpen.value = true
}

function addComponent() {
  editorComponents.value = [
    ...editorComponents.value,
    { itemId: itemOptions.value[0]?.value ?? '', quantity: '1' },
  ]
}

function removeComponent(index: number) {
  editorComponents.value = editorComponents.value.filter((_, position) => position !== index)
}

async function saveStructure() {
  const companyId = session.activeCompanyId
  if (!companyId) return
  if (!editorItemId.value) {
    editorError.value = 'Choose the item the structure makes.'
    return
  }
  let outputQuantityMilli: number
  try {
    outputQuantityMilli = quantityFromString(editorOutput.value)
    if (outputQuantityMilli <= 0) throw new Error('The output quantity must be greater than zero.')
  } catch (cause) {
    editorError.value = messageOf(cause)
    return
  }
  const lines: Array<{ itemId: string; quantityMilli: number; conversionMilli: number }> = []
  try {
    for (const component of editorComponents.value) {
      if (!component.itemId) continue
      const quantityMilli = quantityFromString(component.quantity)
      if (quantityMilli <= 0) {
        throw new Error('A component quantity must be greater than zero.')
      }
      lines.push({ itemId: component.itemId, quantityMilli, conversionMilli: 1000 })
    }
    if (!lines.length) throw new Error('A structure must have at least one component.')
  } catch (cause) {
    editorError.value = messageOf(cause)
    return
  }
  editorError.value = null

  busy.value = true
  try {
    const built = buildBom(
      {
        itemId: editorItemId.value,
        outputQuantityMilli,
        effectiveFrom: editing.value?.bom.effectiveFrom ?? null,
        narration: editorNarration.value,
        lines,
      },
      bomContext(companyId),
    )
    let bom: Bom = built.bom
    let bomLines: BomLine[] = built.lines
    if (editing.value) {
      bom = {
        ...built.bom,
        id: editing.value.bom.id,
        version: editing.value.bom.version,
        status: editing.value.bom.status,
        createdAt: editing.value.bom.createdAt,
      }
      bomLines = built.lines.map((line) => ({ ...line, bomId: bom.id }))
    }
    await session.repository.saveBom(bom, bomLines)
    editorOpen.value = false
    toast.success(
      editing.value ? 'Structure saved' : 'Structure created',
      `${itemNames.value.get(bom.itemId) ?? 'The structure'} version ${bom.version} is saved as a draft.`,
    )
    await load()
  } catch (cause) {
    editorError.value = messageOf(cause)
    toast.error('The structure was not saved', messageOf(cause))
  } finally {
    busy.value = false
  }
}

// ---------------------------------------------------------------------------
// Releasing a structure
// ---------------------------------------------------------------------------

const releaseTarget = ref<BomWithLines | null>(null)
const releaseError = ref<string | null>(null)

function openRelease(entry: BomWithLines) {
  if (entry.bom.status !== 'draft') return
  releaseTarget.value = entry
  releaseError.value = null
}

async function confirmRelease() {
  const companyId = session.activeCompanyId
  const target = releaseTarget.value
  if (!companyId || !target) return
  busy.value = true
  try {
    await session.repository.releaseBom(companyId, target.bom.id)
    releaseTarget.value = null
    toast.success(
      'Structure released',
      `${itemNames.value.get(target.bom.itemId) ?? 'The structure'} version ${target.bom.version} cannot be changed from now on.`,
    )
    await load()
  } catch (cause) {
    releaseError.value = messageOf(cause)
    toast.error('The structure was not released', messageOf(cause))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <PageHeader
      title="Bill of materials"
      subtitle="What each finished item is made of"
      icon="account_tree"
    >
      <template #actions>
        <BaseButton
          size="sm"
          variant="text"
          icon="arrow_back"
          @click="$router.push('/production')"
        >
          Production
        </BaseButton>
        <BaseButton size="sm" variant="primary" icon="add" @click="openCreate">
          New structure
        </BaseButton>
      </template>
    </PageHeader>

    <div class="min-h-0 flex-1 overflow-auto p-space-lg">
      <div v-if="loading" class="space-y-space-md">
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-4">
          <BaseSkeleton v-for="index in 4" :key="index" class="h-24" />
        </div>
        <BaseSkeleton class="h-72" />
      </div>

      <div
        v-else-if="error"
        class="rounded-md border-l-4 border-l-error bg-error-container p-space-md text-body-md text-on-error-container"
        role="alert"
      >
        <p class="font-semibold">The structures could not be loaded</p>
        <p class="mt-0.5">{{ error }}</p>
      </div>

      <template v-else>
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Structures"
            :value="String(structures.length)"
            icon="account_tree"
            hint="The structures of this company"
          />
          <StatTile
            label="Released"
            :value="String(releasedCount)"
            icon="lock"
            tone="positive"
            hint="Immutable once released"
          />
          <StatTile
            label="Drafts"
            :value="String(draftCount)"
            icon="edit_note"
            tone="warning"
            hint="Editable until they are released"
          />
          <StatTile
            label="Components"
            :value="String(structures.reduce((sum, entry) => sum + entry.lines.length, 0))"
            icon="inventory_2"
            tone="info"
            hint="Named across every structure"
          />
        </div>

        <section class="mt-space-md overflow-hidden rounded-md bg-surface-container-lowest shadow-sm">
          <header class="flex flex-wrap items-center justify-between gap-3 px-space-md py-space-sm">
            <div class="flex items-center gap-space-sm">
              <MaterialIcon name="list_alt" :size="20" class="text-primary" />
              <h2 class="text-headline-sm text-on-surface">Structures</h2>
            </div>
            <BaseBadge tone="neutral" size="xs">{{ structures.length }}</BaseBadge>
          </header>

          <div v-if="structures.length" class="overflow-x-auto">
            <table class="w-full text-left text-body-sm">
              <thead
                class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline"
              >
                <tr>
                  <th scope="col" class="px-space-md py-2.5">Item</th>
                  <th scope="col" class="px-space-sm py-2.5 text-right">Version</th>
                  <th scope="col" class="px-space-sm py-2.5 text-right">Output</th>
                  <th scope="col" class="px-space-sm py-2.5 text-right">Components</th>
                  <th scope="col" class="px-space-sm py-2.5">Status</th>
                  <th scope="col" class="px-space-md py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-surface-container-low">
                <tr v-for="entry in structures" :key="entry.bom.id">
                  <td class="px-space-md py-2.5">
                    <div class="font-semibold text-on-surface">
                      {{ itemNames.get(entry.bom.itemId) ?? 'Unknown item' }}
                    </div>
                    <div v-if="entry.bom.narration" class="text-label-xs text-outline">
                      {{ entry.bom.narration }}
                    </div>
                  </td>
                  <td class="px-space-sm py-2.5 text-right text-numeric-sm tabular text-on-surface">
                    {{ entry.bom.version }}
                  </td>
                  <td class="px-space-sm py-2.5 text-right text-numeric-sm tabular text-on-surface">
                    {{ formatQuantity(entry.bom.outputQuantityMilli) }}
                  </td>
                  <td class="px-space-sm py-2.5 text-right text-numeric-sm tabular text-on-surface">
                    {{ entry.lines.length }}
                  </td>
                  <td class="px-space-sm py-2.5">
                    <BaseBadge
                      :tone="entry.bom.status === 'released' ? 'positive' : 'neutral'"
                      size="xs"
                      :icon="entry.bom.status === 'released' ? 'lock' : 'edit_note'"
                    >
                      {{ entry.bom.status === 'released' ? 'Released' : 'Draft' }}
                    </BaseBadge>
                    <span
                      v-if="entry.bom.status === 'released'"
                      class="ml-2 text-label-xs text-outline"
                    >
                      Immutable
                    </span>
                  </td>
                  <td class="px-space-md py-2.5 text-right">
                    <div class="flex items-center justify-end gap-space-sm">
                      <template v-if="entry.bom.status === 'draft'">
                        <BaseButton size="xs" variant="text" icon="edit" @click="openEdit(entry)">
                          Edit
                        </BaseButton>
                        <BaseButton
                          size="xs"
                          variant="outlined"
                          icon="lock"
                          @click="openRelease(entry)"
                        >
                          Release
                        </BaseButton>
                      </template>
                      <span
                        v-else
                        class="inline-flex items-center gap-1 text-label-xs text-outline"
                      >
                        <MaterialIcon name="lock" :size="14" />
                        A released structure cannot be changed
                      </span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <BaseEmptyState
            v-else
            title="No structures yet"
            description="A structure says what a finished item is made of. Raise one to start."
            :icon="MaterialIcon"
          />
        </section>
      </template>
    </div>

    <BaseModal
      :open="editorOpen"
      :title="editing ? 'Edit the structure' : 'New structure'"
      description="Name the components and the quantity each one takes for the output quantity."
      size="lg"
      @close="editorOpen = false"
    >
      <div class="space-y-space-md">
        <BaseSelect
          v-model="editorItemId"
          :options="itemOptions"
          label="Item the structure makes"
          size="sm"
        />
        <div class="grid grid-cols-1 gap-space-md sm:grid-cols-2">
          <BaseInput
            v-model="editorOutput"
            label="Output quantity"
            size="sm"
            align="right"
            suffix="units"
            hint="How many units the structure makes."
          />
          <BaseInput v-model="editorNarration" label="Narration" size="sm" />
        </div>

        <div>
          <div class="mb-space-sm flex items-center justify-between">
            <span class="text-label-sm text-on-surface-variant">Components</span>
            <BaseButton size="xs" variant="text" icon="add" @click="addComponent">
              Add component
            </BaseButton>
          </div>
          <div class="overflow-hidden rounded-md border border-outline-variant">
            <table class="w-full text-left text-body-sm">
              <thead
                class="bg-surface-container-low text-label-xs uppercase tracking-wider text-outline"
              >
                <tr>
                  <th scope="col" class="px-space-md py-2">Component</th>
                  <th scope="col" class="px-space-sm py-2 text-right">Quantity</th>
                  <th scope="col" class="px-space-md py-2 text-right">Remove</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-surface-container-low">
                <tr v-for="(component, index) in editorComponents" :key="index">
                  <td class="px-space-md py-2">
                    <BaseSelect
                      v-model="component.itemId"
                      :options="itemOptions"
                      size="sm"
                    />
                  </td>
                  <td class="px-space-sm py-2">
                    <BaseInput
                      v-model="component.quantity"
                      size="sm"
                      align="right"
                      suffix="units"
                    />
                  </td>
                  <td class="px-space-md py-2 text-right">
                    <BaseButton
                      size="xs"
                      variant="text"
                      icon="delete"
                      :disabled="editorComponents.length === 1"
                      @click="removeComponent(index)"
                    >
                      Remove
                    </BaseButton>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <p
          v-if="editorError"
          class="rounded-sm bg-error-container px-space-sm py-space-xs text-body-sm text-on-error-container"
          role="alert"
        >
          {{ editorError }}
        </p>
      </div>

      <template #footer>
        <BaseButton size="sm" variant="text" @click="editorOpen = false">Close</BaseButton>
        <BaseButton size="sm" variant="primary" icon="save" :loading="busy" @click="saveStructure">
          Save structure
        </BaseButton>
      </template>
    </BaseModal>

    <BaseModal
      :open="Boolean(releaseTarget)"
      title="Release the structure"
      description="A released structure is immutable. A change means a new version."
      size="sm"
      @close="releaseTarget = null"
    >
      <p class="text-body-md text-on-surface-variant">
        {{
          releaseTarget
            ? `${itemNames.get(releaseTarget.bom.itemId) ?? 'This structure'} version ${releaseTarget.bom.version} will be locked. It will be snapshotted by every production order released against it.`
            : ''
        }}
      </p>
      <p
        v-if="releaseError"
        class="mt-space-sm rounded-sm bg-error-container px-space-sm py-space-xs text-body-sm text-on-error-container"
        role="alert"
      >
        {{ releaseError }}
      </p>

      <template #footer>
        <BaseButton size="sm" variant="text" @click="releaseTarget = null">Close</BaseButton>
        <BaseButton size="sm" variant="primary" icon="lock" :loading="busy" @click="confirmRelease">
          Release
        </BaseButton>
      </template>
    </BaseModal>
  </div>
</template>
