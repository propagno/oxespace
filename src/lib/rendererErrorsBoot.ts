import type { RendererErrorBoundary } from './rendererErrors'

/**
 * The boot side of renderer error reporting: the listeners and the boundary hook are here, the report itself
 * (stack hashing, the rate limit, the IPC call) loads with the first error, so it is not in the boot bundle.
 */
const report = () => import('./rendererErrors')

let installed = false
/** Errors nothing caught, and promises nobody handled. Installed once at boot. */
export function installRendererErrorReporting(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', event => { const error = event.error ?? { name: 'Error' }; void report().then(m => m.reportRendererError(m.rendererErrorReport('uncaught', error))).catch(() => undefined) })
  window.addEventListener('unhandledrejection', event => { const reason = event.reason; void report().then(m => m.reportRendererError(m.rendererErrorReport('unhandledRejection', reason))).catch(() => undefined) })
}

/** What an ErrorBoundary caught, reported once the report module is in. Never throws. */
export function reportBoundaryError(error: unknown, boundary: RendererErrorBoundary, component: string | undefined, componentStack: string | null | undefined): Promise<void> {
  return report().then(m => m.reportRendererError(m.rendererErrorReport('boundary', error, { boundary, component: component ?? m.firstComponent(componentStack) }))).catch(() => undefined)
}
