import { Suspense, lazy, useEffect, type ReactElement } from 'react'
import { ErrorBoundary } from '../components/common/ErrorBoundary'
import { useUpdaterStore } from '../store/updater.store'

// The update chip loads only when an update shows (src/store/updater.store.ts decides); it carries the release
// link, and with it the external-link checks, out of the boot bundle.
const AppUpdateIndicator = lazy(() => import('../components/Updates/AppUpdateIndicator').then(m => ({ default: m.AppUpdateIndicator })))

/** The title bar's update chip: the app's, only when there is something to install. A failure shows nothing. */
export function UpdateChips(): ReactElement {
  // Update state from main, read once at start.
  useEffect(() => { useUpdaterStore.getState().bootstrap() }, [])
  const appUpdateShown = useUpdaterStore(state => ['available', 'downloading', 'downloaded'].includes(state.app.status))
  return <ErrorBoundary id="title-bar" component="UpdateChips" fallback={null}>
    {appUpdateShown && <Suspense fallback={null}><AppUpdateIndicator /></Suspense>}
  </ErrorBoundary>
}
