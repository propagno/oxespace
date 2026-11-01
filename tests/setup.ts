import '@testing-library/jest-dom/vitest'
import { scrubLiveAppEnv } from '../e2e/helpers/live-app-env'

// Again in each worker (vitest.config.ts scrubs the runner): nothing a test spawns may reach the running app.
scrubLiveAppEnv()

// Components render English, the source catalog, whatever the machine's language is.
if (typeof window !== 'undefined') {
  const { initI18n, loadNamespace } = await import('../src/i18n')
  await initI18n('en')
  // Lazy views load their catalog on first render (in the app, under Suspense); tests render them directly.
  await loadNamespace('oxequery')
  await loadNamespace('pods')
  await loadNamespace('post')
  await loadNamespace('voice')
}

// jsdom intentionally omits Canvas. Returning null models a machine without
// WebGL and lets TerminalView exercise its DOM-renderer fallback without
// printing a not-implemented stack for every test.
if (typeof HTMLCanvasElement !== 'undefined') Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value: () => null
})
