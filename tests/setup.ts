import '@testing-library/jest-dom/vitest'

// Components render English, the source catalog, whatever the machine's language is.
if (typeof window !== 'undefined') {
  const { initI18n } = await import('../src/i18n')
  await initI18n('en')
}

// jsdom intentionally omits Canvas. Returning null models a machine without
// WebGL and lets TerminalView exercise its DOM-renderer fallback without
// printing a not-implemented stack for every test.
if (typeof HTMLCanvasElement !== 'undefined') Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value: () => null
})
