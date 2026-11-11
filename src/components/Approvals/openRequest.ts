import { create } from 'zustand'

export interface OpenRequestState {
  requestId: string | null
  open: (id: string) => void
  close: () => void
}

export const useOpenRequest = create<OpenRequestState>(set => ({
  requestId: null,
  open: id => set({ requestId: id }),
  close: () => set({ requestId: null })
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
