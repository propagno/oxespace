import { useEffect, useState, type ComponentType, type ReactElement } from 'react'
import { ErrorBoundary } from '../common/ErrorBoundary'
import { approvalsApi } from './approvalsApi'
import { schedulePreload, startApprovals } from './approvalsBoot'

export { OPEN_APPROVAL_HISTORY_EVENT } from './approvalsBoot'

/**
 * Mounted at boot: listens for approval requests and mounts the approval window (its own chunk) when the first one
 * arrives or the history is asked for. The chunk is fetched at idle after the first paint so a request never waits.
 * A window without the preload has no channel and listens to nothing. A crash inside the approval window renders
 * nothing (it sits outside the page's boundary); the fail-safe hands its request back to main.
 */
export function ApprovalsHost(): ReactElement | null {
  // The approval window's component, from its own chunk (loadCenter, a dynamic import), once it is loaded and needed.
  // Held in state instead of React.lazy: the chunk has settled before it renders, so there is nothing to suspend for,
  // and a failed load stays with the fail-safe instead of throwing during render.
  const [Center, setCenter] = useState<ComponentType | null>(null)
  useEffect(() => {
    const api = approvalsApi()
    if (!api) return
    const stop = startApprovals({ api, onReady: module => setCenter(() => module.ApprovalCenter) })
    const cancelPreload = schedulePreload()
    return () => { stop(); cancelPreload() }
  }, [])
  return Center && <ErrorBoundary fallback={null}><Center /></ErrorBoundary>
}
