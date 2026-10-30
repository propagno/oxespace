import type { Terminal } from '@xterm/xterm'
import type { WebglRenderer } from './webglRenderer'

/**
 * The WebGL renderer for one terminal, loaded on first use: @xterm/addon-webgl and its wrapper stay off the boot
 * path (scripts/verify-bundle-budgets.mjs). Until the module arrives the pane draws with xterm's DOM renderer;
 * then it takes whatever the budget last granted.
 */
export function createLazyWebglRenderer(terminal: Terminal): WebglRenderer {
  let enabled = false
  let disposed = false
  let renderer: WebglRenderer | null = null
  let loading: Promise<void> | null = null
  const load = (): Promise<void> => loading ??= import('./webglRenderer')
    .then(({ createWebglRenderer }) => {
      if (disposed) return
      renderer = createWebglRenderer(terminal)
      if (enabled) renderer.setEnabled(true)
    })
    .catch((err: unknown) => { console.warn('[OXESpace] WebGL renderer did not load, using DOM renderer', err) })

  return {
    setEnabled(next) {
      enabled = next
      if (renderer) renderer.setEnabled(next)
      else if (next) void load()
    },
    dispose() {
      disposed = true
      renderer?.dispose()
      renderer = null
    }
  }
}
