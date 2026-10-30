import { WebglAddon } from '@xterm/addon-webgl'
import type { Terminal } from '@xterm/xterm'
import { MAX_WEBGL_CONTEXTS } from './webglBudget'

// Browsers cap WebGL contexts per tab (Chrome: 16). When exceeded, the oldest
// context is lost, unexpectedly breaking older terminals. Shared with the MRU
// trim in App.tsx, which budgets mounted panes against the same limit.
let activeWebglContexts = 0
let webgl2Supported: boolean | null = null

/**
 * Preflight: can we actually get a WebGL2 context? @xterm/addon-webgl needs one,
 * and on GPU-less hosts (corporate VMs, RDP, some VPN/remote desktops) its
 * failure surfaces asynchronously and crashes the pane. Only load the addon when
 * a real context is obtainable; otherwise stay on xterm's DOM renderer.
 */
function supportsWebgl2(): boolean {
  if (webgl2Supported !== null) return webgl2Supported
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2')
    if (!gl) {
      webgl2Supported = false
      return false
    }
    // Release the probe context so we don't hold a GPU slot.
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    webgl2Supported = true
    return true
  } catch {
    webgl2Supported = false
    return false
  }
}

export interface WebglRenderer {
  /** Draw with WebGL (when the host can) or give the context back and draw with the DOM renderer. */
  setEnabled(enabled: boolean): void
  dispose(): void
}

/**
 * GPU-accelerated renderer for one terminal. The default DOM renderer repaints every changed
 * row on the main thread; WebGL offloads that to the GPU, at the price of a context, a glyph
 * atlas and framebuffers in the GPU process — which is why only the panes the budget picks hold
 * one. The scrollback lives in xterm's buffer, not the renderer, so switching loses nothing.
 *
 * In GPU-less environments (corporate VMs, RDP, some VPN/remote desktops)
 * WebGL is unavailable or unstable. The @xterm/addon-webgl failure surfaces
 * ASYNCHRONOUSLY (render tick / context loss), so a synchronous try/catch
 * around loadAddon can't contain it — the classic "Cannot read properties
 * of undefined (reading '_isDisposed')" then escapes and (without a boundary)
 * blanks the whole app. So we PREFLIGHT a real WebGL2 context first and only
 * load the addon when it actually works; otherwise we stay on the DOM
 * renderer. Disposal is also guarded so teardown can never throw.
 */
export function createWebglRenderer(terminal: Terminal): WebglRenderer {
  let addon: WebglAddon | null = null
  let counted = false
  let disposed = false

  const repaint = (): void => {
    try { terminal.refresh(0, terminal.rows - 1) } catch { /* disposed */ }
  }
  const release = (): void => {
    const current = addon
    addon = null
    try { current?.dispose() } catch { /* already torn down */ }
    if (counted) { activeWebglContexts--; counted = false }
  }
  const load = (): void => {
    if (addon) return
    if (activeWebglContexts >= MAX_WEBGL_CONTEXTS) {
      console.warn(`[OXESpace] WebGL context limit reached (${MAX_WEBGL_CONTEXTS}), using DOM renderer`)
      return
    }
    if (!supportsWebgl2()) {
      console.warn('[OXESpace] WebGL2 not available, using DOM renderer')
      return
    }
    try {
      const next = new WebglAddon()
      next.onContextLoss(() => {
        if (addon !== next) { try { next.dispose() } catch { /* already torn down */ } return }
        release()
        // The WebGL canvas has just been removed. Force xterm onto the DOM renderer
        // now, otherwise the terminal stays blank: re-applying a cloned theme
        // rebuilds its colors without a no-op self-assignment.
        setTimeout(() => {
          if (disposed) return
          try { terminal.options.theme = { ...(terminal.options.theme ?? {}) } } catch { /* disposed */ }
          repaint()
        }, 50)
      })
      terminal.loadAddon(next)
      addon = next
      activeWebglContexts++
      counted = true
    } catch (err) {
      console.warn('[OXESpace] WebGL renderer unavailable, using DOM renderer', err)
      addon = null
    }
  }

  return {
    setEnabled(enabled) {
      if (disposed || enabled === (addon !== null)) return
      if (enabled) load()
      else release()
      // Whichever renderer now owns the screen draws it once; the buffer is unchanged.
      repaint()
    },
    dispose() {
      disposed = true
      release()
    }
  }
}
