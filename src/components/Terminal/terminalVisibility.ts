/**
 * Visibility detection for TerminalView hosts (OXE-349 / OXE-443).
 *
 * A mounted TerminalView can be hidden without unmounting when:
 * - its workspace is inactive (`.workspace-host.workspace-host-hidden`),
 * - another pane is maximized in WorkspaceGrid (`.workspace-panel--suppressed` /
 *   `.workspace-row-panel--suppressed`) or WorkspaceSplitGrid (`.split-pane-slot`
 *   with `visibility: hidden`),
 * - the Thread view is hidden (`.thread-host` with `display: none` or `aria-hidden="true"`), or
 * - another tab is selected inside ThreadProjectTerminal (`.thread-terminal-slot` with
 *   `display: none` or `aria-hidden="true"`).
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
  const threadSlot = host.closest<HTMLElement>('.thread-terminal-slot')
  if (threadSlot && (threadSlot.style.display === 'none' || threadSlot.getAttribute('aria-hidden') === 'true')) {
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
    '.thread-host',
    '.thread-terminal-slot'
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

/**
 * OXE-443 · Schedules a cancellable post-layout reveal callback after two animation frames
 * so Chromium completes `content-visibility: visible` layout before WebGL creation and fit.
 */
export function createRevealScheduler(onReveal: () => void): { schedule: () => void; cancel: () => void } {
  let frameA: number | null = null
  let frameB: number | null = null

  const cancel = (): void => {
    if (frameA !== null) {
      window.cancelAnimationFrame(frameA)
      frameA = null
    }
    if (frameB !== null) {
      window.cancelAnimationFrame(frameB)
      frameB = null
    }
  }

  const schedule = (): void => {
    cancel()
    frameA = window.requestAnimationFrame(() => {
      frameA = null
      frameB = window.requestAnimationFrame(() => {
        frameB = null
        onReveal()
      })
    })
  }

  return { schedule, cancel }
}

export interface WorkspaceSurfaceVisibilityInput {
  workspaceId: string
  activeWorkspaceId: string | null
  applicationView: string
  paneIds: readonly string[]
  maximizedPaneId: string | null
  activePaneId: string | null
  isIntegrationPanelOpen: boolean
  isSearchPanelOpen: boolean
  containersOpen: boolean
}

export interface WorkspaceSurfaceVisibility {
  isSelectedWorkspace: boolean
  isActive: boolean
  maximizedPaneId: string | null
  integrationVisible: boolean
  searchVisible: boolean
  containersVisible: boolean
  activePaneId: string | null
}

/**
 * OXE-443 · Computes WorkspaceSurface visibility props so switching between OxeCode, OxeChat,
 * and OxeQuery preserves the selected workspace's maximized pane and global side panels without
 * triggering layout churn or unmounting side drawers while `.workspace-host-hidden` hides it.
 */
export function resolveWorkspaceSurfaceVisibility(input: WorkspaceSurfaceVisibilityInput): WorkspaceSurfaceVisibility {
  const isSelectedWorkspace = input.workspaceId === input.activeWorkspaceId
  const isActive = isSelectedWorkspace && input.applicationView === 'code'
  const ownsMaximized = input.maximizedPaneId !== null && input.paneIds.includes(input.maximizedPaneId)
  return {
    isSelectedWorkspace,
    isActive,
    maximizedPaneId: ownsMaximized ? input.maximizedPaneId : null,
    integrationVisible: isSelectedWorkspace && input.isIntegrationPanelOpen,
    searchVisible: isSelectedWorkspace && input.isSearchPanelOpen,
    containersVisible: isSelectedWorkspace && input.containersOpen,
    activePaneId: isActive ? input.activePaneId : null
  }
}
