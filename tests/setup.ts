import '@testing-library/jest-dom/vitest'

// jsdom intentionally omits Canvas. Returning null models a machine without
// WebGL and lets TerminalView exercise its DOM-renderer fallback without
// printing a not-implemented stack for every test.
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value: () => null
})
