import { vi } from 'vitest'
import { scrubLiveAppEnv } from '../e2e/helpers/live-app-env'

// Again in each worker (vitest.config.ts scrubs the runner): nothing a test spawns may reach the running app.
scrubLiveAppEnv()

if (typeof window !== 'undefined') {
  await import('@testing-library/jest-dom/vitest')

  // Components render English, the source catalog, whatever the machine's language is.
  const { initI18n, loadNamespace } = await import('../src/i18n')
  await initI18n('en')
  // Lazy views load their catalog on first render (in the app, under Suspense); tests render them directly.
  await loadNamespace('oxequery')
  await loadNamespace('pods')

  // jsdom intentionally omits Canvas. Returning null models a machine without
  // WebGL and lets TerminalView exercise its DOM-renderer fallback without
  // printing a not-implemented stack for every test.
  if (typeof HTMLCanvasElement !== 'undefined') Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => null
  })

  // OXE-408: no real Monaco in jsdom. The Changes diff view and the editors load Monaco lazily. In a busy run its chunk
  // was already transformed by an earlier file, so it finished loading inside a test that never asked for an editor
  // (pp05-changes-empty, typing in the file filter) and the real editor mounted in jsdom, which lacks what it needs
  // (ResizeObserver, matchMedia, a 2D canvas). Its throw unmounted the panel under the test, in some runs only. A test
  // that drives an editor mocks both modules with its own double, which wins over this default; the default renders an
  // inert placeholder and never calls onMount.
  vi.doMock('@monaco-editor/react', async () => {
    const { createElement } = await import('react')
    const placeholder = (kind: string) => function MonacoPlaceholder() { return createElement('div', { 'data-monaco-placeholder': kind }) }
    const Editor = placeholder('editor')
    return { default: Editor, Editor, DiffEditor: placeholder('diff'), loader: { config() {}, init: () => new Promise(() => {}) }, useMonaco: () => null }
  })
  vi.doMock('../src/lib/monacoSetup', () => ({}))

  // OXE-408: a conversation's open tool panel is per-thread state in this store, kept in memory between tests. A case
  // that opened the Changes panel left it open for the next case's conversation of the same id, which then mounted
  // ChangesPanel against a window.oxe double without git (f5-working-set › nothing pending, no bar). Each test starts
  // from the store's initial state, as each app start does.
  const { afterEach } = await import('vitest')
  const { useThreadWorkbenchStore } = await import('../src/store/thread-workbench.store')
  const initialWorkbench = useThreadWorkbenchStore.getInitialState()
  afterEach(() => { useThreadWorkbenchStore.setState(initialWorkbench, true) })
}
