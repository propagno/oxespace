import type { WebglAddon } from '@xterm/addon-webgl'

// @xterm/addon-webgl loads on first use, in its own chunk, so it stays off the boot path
// (scripts/verify-bundle-budgets.mjs). Until it arrives a pane draws with the DOM renderer.
let webglAddonClass: typeof WebglAddon | null = null
let webglAddonLoading: Promise<void> | null = null
let webgl2Supported: boolean | null = null

/** The addon's class once it has loaded, or null while it has not. */
export function loadedWebglAddon(): typeof WebglAddon | null {
  return webglAddonClass
}

export function loadWebglAddon(): Promise<void> {
  return webglAddonLoading ??= import('@xterm/addon-webgl').then(module => { webglAddonClass = module.WebglAddon })
}

/**
 * Preflight: can we actually get a WebGL2 context? @xterm/addon-webgl needs one,
 * and on GPU-less hosts (corporate VMs, RDP, some VPN/remote desktops) its
 * failure surfaces asynchronously and crashes the pane. Only load the addon when
 * a real context is obtainable; otherwise stay on xterm's DOM renderer.
 */
export function supportsWebgl2(): boolean {
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
