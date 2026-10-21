import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ToastTone = 'success' | 'error' | 'info' | 'warning'

export interface Toast {
  id: number
  tone: ToastTone
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void
}

let nextId = 1

export const useToastStore = defineStore('toast', () => {
  const toasts = ref<Toast[]>([])

  function dismiss(id: number) {
    toasts.value = toasts.value.filter((toast) => toast.id !== id)
  }

  function push(input: Omit<Toast, 'id'> & { timeout?: number }): number {
    const { timeout = 4500, ...toast } = input
    const id = nextId++
    toasts.value = [...toasts.value, { ...toast, id }]
    if (timeout > 0) {
      window.setTimeout(() => dismiss(id), timeout)
    }
    return id
  }

  const success = (title: string, description?: string) =>
    push({ tone: 'success', title, description })
  const error = (title: string, description?: string) =>
    push({ tone: 'error', title, description, timeout: 7000 })
  const info = (title: string, description?: string) => push({ tone: 'info', title, description })
  const warning = (title: string, description?: string) =>
    push({ tone: 'warning', title, description })

  return { toasts, push, dismiss, success, error, info, warning }
})
