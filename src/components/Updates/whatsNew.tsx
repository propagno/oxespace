import { useEffect, type ReactElement } from 'react'
import { create } from 'zustand'
import { useUIStore } from '../../store/ui.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { WhatsNewDialog, type WhatsNewTarget } from './WhatsNewDialog'

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
    case 'timeTravel':
      if (activeWsId) void wsStore.updateReviewState({ workspaceId: activeWsId, reviewPanelVisible: true })
      else ui.openNewWorkspace()
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
    <WhatsNewDialog
      onClose={close}
      onOpen={target => {
        close()
        openWhatsNewTarget(target)
      }}
    />
  )
}
