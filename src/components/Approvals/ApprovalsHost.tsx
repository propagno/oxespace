import { Component, lazy, Suspense, useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { approvalsApi } from './approvalsApi'
import { loadCenter, schedulePreload, startApprovals } from './approvalsBoot'

export { OPEN_APPROVAL_HISTORY_EVENT } from './approvalsBoot'

// Rendered only after loadCenter() settled, so this never suspends and a failed load is handled by the fail-safe.
const ApprovalCenter = lazy(() => loadCenter().then(module => ({ default: module.ApprovalCenter })))

/** A crash inside the approval window renders nothing; the fail-safe hands the request back to main. */
class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true } }
  componentDidCatch(error: unknown): void { console.error('[approvals] the approval window failed', error) }
  render(): ReactNode { return this.state.failed ? null : this.props.children }
}

/**
 * Mounted at boot: listens for approval requests and mounts the approval window (its own chunk) when the first one
 * arrives or the history is asked for. The chunk is fetched at idle after the first paint so a request never waits.
 */
export function ApprovalsHost(): ReactElement | null {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const api = approvalsApi()
    const stop = startApprovals({ api, onReady: () => setReady(true) })
    const cancelPreload = schedulePreload()
    return () => { stop(); cancelPreload() }
  }, [])
  if (!ready) return null
  return <Quiet><Suspense fallback={null}><ApprovalCenter /></Suspense></Quiet>
}
