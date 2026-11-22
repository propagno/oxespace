import { create } from 'zustand'

export interface OpenRequestState {
  requestId: string | null
  /** The conversation the opened request belongs to, when the opener knows it (OXE-332): lets the host load it uncached. */
  threadId: string | null
  open: (id: string, threadId?: string) => void
  close: () => void
}

export const useOpenRequest = create<OpenRequestState>(set => ({
  requestId: null,
  threadId: null,
  open: (id, threadId) => set({ requestId: id, threadId: threadId ?? null }),
  close: () => set({ requestId: null, threadId: null })
}))

export function startOpenRequestListener(): () => void {
  if (typeof window === 'undefined') return () => undefined
  const onOpenRequest = window.oxe?.approvals?.onOpenRequest
  if (typeof onOpenRequest !== 'function') return () => undefined
  const unsubscribe = onOpenRequest((requestId: string) => {
    if (typeof requestId === 'string' && requestId.length > 0) {
      useOpenRequest.getState().open(requestId)
    }
  })
  return () => {
    if (typeof unsubscribe === 'function') unsubscribe()
  }
}
