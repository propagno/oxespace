import '@testing-library/jest-dom/vitest'

// Components render English, the source catalog, whatever the machine's language is.
if (typeof window !== 'undefined') {
  const { initI18n, loadNamespace } = await import('../src/i18n')
  await initI18n('en')
  // Lazy views load their catalog on first render (in the app, under Suspense); tests render them directly.
  await loadNamespace('oxequery')
  await loadNamespace('pods')
}

// jsdom intentionally omits Canvas. Returning null models a machine without
// WebGL and lets TerminalView exercise its DOM-renderer fallback without
// printing a not-implemented stack for every test.
if (typeof HTMLCanvasElement !== 'undefined') Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value: () => null
})
