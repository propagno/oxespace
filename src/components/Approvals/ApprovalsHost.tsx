import { useEffect, useState, type ComponentType, type ReactElement } from 'react'
import { ErrorBoundary } from '../common/ErrorBoundary'
import { i18n } from '../../i18n'
import { approvalsApi } from './approvalsApi'
import { handBackAll, schedulePreload, startApprovals } from './approvalsBoot'

export { OPEN_APPROVAL_HISTORY_EVENT } from './approvalsBoot'

/**
 * What stands in for the approval window when it crashed after mounting: every request it held, and every one that
 * arrives later, goes back to main's own dialog (`approvals.unavailable`, once each), and the person is told where to
 * answer. Never an answer, and never nothing (R4).
 */
function ApprovalsUnavailable(): ReactElement {
  useEffect(() => { handBackAll() }, [])
  return <p role="status" data-testid="approvals-unavailable" style={{ position: 'fixed', insetInline: 0, bottom: 0, margin: 0, padding: 'var(--space-2) var(--space-3)', background: 'var(--intent-warning-bg)', color: 'var(--text-primary)', fontSize: 'var(--text-sm)', zIndex: 1000 }}>
    {i18n.t('approvals.unavailableWindow')}
  </p>
}

/**
 * Mounted at boot: listens for approval requests and mounts the approval window (its own chunk) when the first one
 * arrives or the history is asked for. The chunk is fetched at idle after the first paint so a request never waits.
 * A window without the preload has no channel and listens to nothing. A crash inside the approval window (it sits
 * outside the page's boundary) hands every request it held back to main.
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
  return Center && <ErrorBoundary label={i18n.t('approvals.boundaryLabel')} fallback={<ApprovalsUnavailable />}><Center /></ErrorBoundary>
}
