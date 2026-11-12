import { lazy, Suspense, useEffect, type ReactElement } from 'react'
import { create } from 'zustand'
import { useUIStore } from '../../store/ui.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import type { WhatsNewTarget } from './WhatsNewDialog'

const WhatsNewDialog = lazy(() => import('./WhatsNewDialog').then(m => ({ default: m.WhatsNewDialog })))

export interface WhatsNewState {
  open: boolean
  show: () => void
  close: () => void
}

export const useWhatsNew = create<WhatsNewState>(set => ({
  open: false,
  show: () => set({ open: true }),
  close: () => set({ open: false })
}))

function openWhatsNewTarget(target: WhatsNewTarget): void {
  const ui = useUIStore.getState()
  const wsStore = useWorkspaceStore.getState()
  const activeWsId = wsStore.activeWorkspaceId
  switch (target) {
    case 'browser':
      if (activeWsId) ui.openWebPreview(activeWsId)
      else ui.openNewWorkspace()
      return
    case 'approvals':
      ui.openSettingsPage('agent-permissions')
      return
    case 'httpCalls':
      ui.openSettingsPage('activity')
      return
  }
}

export function WhatsNewHost(): ReactElement | null {
  const open = useWhatsNew(state => state.open)
  const close = useWhatsNew(state => state.close)

  useEffect(() => () => {
    useWhatsNew.setState({ open: false })
  }, [])

  if (!open) return null

  return (
    <Suspense fallback={null}>
      <WhatsNewDialog
        onClose={close}
        onOpen={target => {
          close()
          openWhatsNewTarget(target)
        }}
      />
    </Suspense>
  )
}
