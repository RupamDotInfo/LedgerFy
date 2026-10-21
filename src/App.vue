<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterView, useRouter } from 'vue-router'

import BrandMark from '@/components/layout/BrandMark.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import MaterialIcon from '@/components/ui/MaterialIcon.vue'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const router = useRouter()

onMounted(() => {
  if (!session.ready) {
    void session.bootstrap()
  }
})
</script>

<template>
  <div
    v-if="!session.ready"
    class="flex h-full flex-col items-center justify-center gap-3 bg-surface text-on-surface"
  >
    <BrandMark :size="40" :show-wordmark="false" />
    <p class="text-label-md text-outline">Opening the workspace…</p>
  </div>

  <!-- The local database could not be opened. The original files are untouched. -->
  <div
    v-else-if="session.error"
    class="flex h-full items-center justify-center overflow-y-auto bg-surface px-6 py-10"
  >
    <div class="w-full max-w-lg text-center">
      <span
        class="mx-auto flex size-12 items-center justify-center rounded-full bg-error-container text-error"
      >
        <MaterialIcon name="error" :size="24" />
      </span>
      <h1 class="mt-4 text-headline-md text-on-surface">The workspace could not be opened</h1>
      <p class="mx-auto mt-2 max-w-md text-body-sm leading-relaxed text-outline">
        {{ session.error }}
      </p>
      <p class="mx-auto mt-4 max-w-md rounded-sm bg-surface-container-low p-3 text-left text-label-xs text-outline">
        Your existing books have not been changed. If another copy of LedgerFy is
        using the workspace, close it and try again.
      </p>
      <div class="mt-5 flex items-center justify-center gap-2">
        <BaseButton variant="primary" icon="refresh" @click="session.bootstrap()">
          Try again
        </BaseButton>
      </div>
    </div>
  </div>

  <!-- First run: the workspace holds no company yet. -->
  <div v-else-if="session.needsSetup" class="flex h-full items-center justify-center overflow-y-auto bg-surface px-6 py-10">
    <div class="w-full max-w-xl">
      <div class="text-center">
        <BrandMark :size="44" :show-wordmark="false" />
        <h1 class="mt-4 text-headline-md text-on-surface">Welcome to LedgerFy</h1>
        <p class="mx-auto mt-2 max-w-md text-body-sm leading-relaxed text-outline">
          Set up a company to start recording books, or open the sample workspace
          to look around first. Your books stay on this computer.
        </p>
      </div>

      <div class="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          class="group flex flex-col items-start gap-2 rounded-md bg-surface-container-lowest p-4 text-left shadow-sm transition-all hover:shadow-md"
          @click="router.push('/company/create')"
        >
          <span class="flex size-9 items-center justify-center rounded-md bg-primary text-on-primary">
            <MaterialIcon name="add_business" :size="18" />
          </span>
          <span class="text-body-md font-semibold text-on-surface">Create a company</span>
          <span class="text-label-sm leading-relaxed text-outline">
            Start a fresh set of books with your own details, financial year and
            chart of accounts.
          </span>
        </button>

        <button
          type="button"
          class="group flex flex-col items-start gap-2 rounded-md bg-surface-container-lowest p-4 text-left shadow-sm transition-all hover:shadow-md"
          @click="session.openSampleWorkspace()"
        >
          <span class="flex size-9 items-center justify-center rounded-md bg-secondary-container text-on-secondary-container">
            <MaterialIcon name="science" :size="18" />
          </span>
          <span class="text-body-md font-semibold text-on-surface">Open the sample workspace</span>
          <span class="text-label-sm leading-relaxed text-outline">
            A fictional business with a year of sales, purchases, receipts and
            bank statements, so you can try every screen.
          </span>
        </button>
      </div>

      <p
        v-if="session.loading"
        class="mt-5 flex items-center justify-center gap-2 text-label-sm text-outline"
      >
        <MaterialIcon name="progress_activity" :size="15" class="animate-spin" />
        Preparing the workspace…
      </p>
    </div>
  </div>

  <RouterView v-else />
</template>
