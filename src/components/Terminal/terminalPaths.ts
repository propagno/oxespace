import type { IDisposable, Terminal } from '@xterm/xterm'

/**
 * F33 · project paths in a terminal pane (Ctrl+click, Ctrl+Shift+click, right click → path menu). The only part in the
 * renderer's entry chunk: everything else (the link provider, the menu, the open-in client) loads after the pane is up.
 */
export function attachTerminalPaths(terminal: Terminal, host: HTMLElement | null, workspaceId: string | undefined): IDisposable {
  let disposed = false
  let attached: IDisposable | undefined
  if (host && workspaceId) void import('./terminalPathsAttach').then(module => { if (!disposed) attached = module.attach(terminal, host, workspaceId) })
  return { dispose: () => { disposed = true; attached?.dispose() } }
}
