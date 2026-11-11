import { Suspense, lazy, useEffect, type ReactElement } from 'react'
import { useApprovalsStore } from '../components/Approvals/approvals.store'
import { ErrorBoundary } from '../components/common/ErrorBoundary'
import { updateChipView } from '../components/Updates/updateChip'
import { useUpdaterStore } from '../store/updater.store'

// The update chip loads only when an update shows (src/store/updater.store.ts decides); it carries the release
// link, and with it the external-link checks, out of the boot bundle.
const AppUpdateIndicator = lazy(() => import('../components/Updates/AppUpdateIndicator').then(m => ({ default: m.AppUpdateIndicator })))

/** The title bar's update chip: the app's, unless a critical approval holds or the version was deferred. */
export function UpdateChips(): ReactElement {
  // Update state from main, read once at start.
  useEffect(() => { useUpdaterStore.getState().bootstrap() }, [])
  const app = useUpdaterStore(state => state.app)
  const dismissedVersion = useUpdaterStore(state => state.dismissedVersion)
  const criticalHold = useApprovalsStore(state => state.queue.some(req => req.risk === 'critical'))
  const deferred = app.status === 'downloaded' && app.availableVersion !== null && dismissedVersion === app.availableVersion
  const appUpdateShown = !deferred && updateChipView(app, { criticalHold }) !== null
  return <ErrorBoundary id="title-bar" component="UpdateChips" fallback={null}>
    {appUpdateShown && <Suspense fallback={null}><AppUpdateIndicator /></Suspense>}
  </ErrorBoundary>
}
