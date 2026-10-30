import { lazy, Suspense, type ReactElement } from 'react'
import { create } from 'zustand'

export interface ToastInput {
  title: string
  description?: string
  intent?: 'info' | 'success' | 'warning' | 'danger'
  action?: { label: string; run: () => void }
  /** Milliseconds before it closes on its own, overriding the reading-time rule; 0 keeps it until dismissed. */
  duration?: number
}
export interface ToastItem extends ToastInput {
  id: number
  /** Same intent, title and description: a repeat merges into the toast already showing. */
  key: string
  /** How many times it was raised while showing. */
  count: number
  /** Resolved milliseconds before it closes (0: stays). */
  timeout: number
}

const MAX_TOASTS = 4
/** Repeats that arrive within this window are announced once, with the final count. */
export const REPEAT_ANNOUNCE_MS = 700
let counter = 0

/**
 * How long a toast stays: 4 s plus about 60 ms per character of title and description, between 4 and 12 s.
 * Failures stay until dismissed. A caller's own `duration` wins.
 */
export function toastDuration({ title, description, intent, duration }: ToastInput): number {
  if (duration !== undefined) return Math.max(0, duration)
  if (intent === 'danger') return 0
  const characters = title.length + (description?.length ?? 0)
  return Math.min(12_000, Math.max(4_000, 4_000 + characters * 60))
}

const keyOf = (toast: ToastInput): string => [toast.intent ?? 'info', toast.title, toast.description ?? ''].join('\u0000')

/** The toasts showing, for the stack (src/ui/ToastStack.tsx). */
export const useToasts = create<{ items: ToastItem[]; push: (toast: ToastInput) => number; dismiss: (id: number) => void }>(set => ({
  items: [],
  push: toast => {
    const key = keyOf(toast)
    let id = 0
    set(state => {
      const same = state.items.find(item => item.key === key)
      if (same) {
        id = same.id
        // A new object restarts its timer; the latest action is the one that runs.
        return { items: state.items.map(item => item === same ? { ...item, ...toast, count: item.count + 1, timeout: toastDuration(toast) } : item) }
      }
      id = ++counter
      return { items: [...state.items, { ...toast, id, key, count: 1, timeout: toastDuration(toast) }].slice(-MAX_TOASTS) }
    })
    return id
  },
  dismiss: id => set(state => ({ items: state.items.filter(item => item.id !== id) }))
}))

/** Shows a short message in the corner. Use for results of actions, not for questions. Repeats merge into one toast with a count. */
export function toast(input: ToastInput): number {
  return useToasts.getState().push(input)
}
export function dismissToast(id: number): void {
  useToasts.getState().dismiss(id)
}

/** The stack loads after boot, in its own chunk: the boot bundle carries only the store above. */
const ToastStack = lazy(() => import('./ToastStack'))

/** Mount once near the root of the app. */
export function Toaster(): ReactElement {
  return <Suspense fallback={null}><ToastStack /></Suspense>
}
