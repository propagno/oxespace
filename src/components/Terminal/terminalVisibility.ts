/**
 * Visibility detection for TerminalView hosts (OXE-349).
 *
 * A mounted TerminalView can be hidden without unmounting when:
 * - its workspace is inactive (`.workspace-host.workspace-host-hidden`),
 * - another pane is maximized in WorkspaceGrid (`.workspace-panel--suppressed` /
 *   `.workspace-row-panel--suppressed`) or WorkspaceSplitGrid (`.split-pane-slot`
 *   with `visibility: hidden`), or
 * - the Thread view is hidden (`.thread-host` with `display: none` or `aria-hidden="true"`).
 */

export function isTerminalHostHidden(host: HTMLElement | null): boolean {
  if (!host) return false
  if (host.style.display === 'none' || host.style.visibility === 'hidden') return true
  if (host.closest('.workspace-host.workspace-host-hidden')) return true
  if (host.closest('.workspace-panel--suppressed, .workspace-row-panel--suppressed')) return true
  const splitSlot = host.closest<HTMLElement>('.split-pane-slot')
  if (splitSlot && splitSlot.style.visibility === 'hidden') return true
  const threadHost = host.closest<HTMLElement>('.thread-host')
  if (threadHost && (threadHost.style.display === 'none' || threadHost.getAttribute('aria-hidden') === 'true')) {
    return true
  }
  return false
}

export function observeTerminalVisibility(
  host: HTMLElement,
  onChange: (hidden: boolean) => void
): () => void {
  if (typeof MutationObserver !== 'function') return () => undefined

  const targets = new Set<HTMLElement>([host])
  const selectors = [
    '.workspace-host',
    '.workspace-panel',
    '.workspace-row-panel',
    '.split-pane-slot',
    '.thread-host'
  ]
  for (const selector of selectors) {
    const ancestor = host.closest<HTMLElement>(selector)
    if (ancestor) targets.add(ancestor)
  }

  let lastHidden = isTerminalHostHidden(host)
  const observer = new MutationObserver(() => {
    const nextHidden = isTerminalHostHidden(host)
    if (nextHidden === lastHidden) return
    lastHidden = nextHidden
    onChange(nextHidden)
  })

  for (const target of targets) {
    observer.observe(target, {
      attributes: true,
      attributeFilter: ['class', 'style', 'aria-hidden']
    })
  }

  return () => observer.disconnect()
}
