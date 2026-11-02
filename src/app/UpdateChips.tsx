import { Suspense, lazy, useEffect, type ReactElement } from 'react'
import { ErrorBoundary } from '../components/common/ErrorBoundary'
import { useUpdaterStore } from '../store/updater.store'

// The update chips load only when an update shows (src/store/updater.store.ts decides); they carry the release
// link, and with it the external-link checks, out of the boot bundle.
const UpdateBanner = lazy(() => import('../components/Updates/UpdateBanner').then(m => ({ default: m.UpdateBanner })))
const AppUpdateIndicator = lazy(() => import('../components/Updates/AppUpdateIndicator').then(m => ({ default: m.AppUpdateIndicator })))

/** The title bar's update chips: RTK and the app, each only when there is something to install. A failure shows nothing. */
export function UpdateChips(): ReactElement {
  // Update state from main, read once at start.
  useEffect(() => { useUpdaterStore.getState().bootstrap() }, [])
  const appUpdateShown = useUpdaterStore(state => ['available', 'downloading', 'downloaded'].includes(state.app.status))
  const rtkUpdateShown = useUpdaterStore(state => state.rtk.updateAvailable || state.rtk.updating)
  return <ErrorBoundary id="title-bar" component="UpdateChips" fallback={null}>
    {rtkUpdateShown && <Suspense fallback={null}><UpdateBanner /></Suspense>}
    {appUpdateShown && <Suspense fallback={null}><AppUpdateIndicator /></Suspense>}
  </ErrorBoundary>
}
