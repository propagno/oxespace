/**
 * OXE-331: a workspace made from the first run keeps the person at Step 2, and the next click is most likely the first
 * run's footer "OxeCode". This warms, while the window is idle, what OxeCode's first paint otherwise loads on that click:
 * the workspace surface, the status bar's chips and usage, the terminal's focus menu and its WebGL renderer. Each part is
 * the same chunk the view renders from (src/lib/chunk.ts), so OxeCode opens without suspending. A failure is ignored:
 * the view loads them itself when it opens.
 */
export function preloadCodeView(): Promise<void> {
  return Promise.all([
    import('../components/Workspace/WorkspaceSurface'),
    import('../lib/panelChunks').then(m => m.INTEGRATIONS_STATUS_CHIPS_CHUNK.load()),
    import('../components/Workspace/usageChunk').then(m => m.USAGE_CHUNK.load()),
    import('../components/Grid/PaneContainer').then(m => m.TERMINAL_FOCUS_MENU_ITEMS_CHUNK.load()),
    import('../components/Terminal/webglAddonLoader').then(m => (m.supportsWebgl2() ? m.loadWebglAddon() : undefined))
  ]).then(() => undefined, () => undefined)
}

/** Runs `task` when the window is idle (or after the next frame where requestIdleCallback is missing); returns a cancel. */
export function whenIdle(task: () => void): () => void {
  const idle = globalThis as { requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void }
  if (typeof idle.requestIdleCallback === 'function') {
    const id = idle.requestIdleCallback(task, { timeout: 500 })
    return () => idle.cancelIdleCallback?.(id)
  }
  const id = setTimeout(task, 50)
  return () => clearTimeout(id)
}
