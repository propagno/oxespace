import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react'
import type { TerminalPresence } from '../../../shared/types/ipc/terminal'
import { useUIStore } from '../../store/ui.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { computePanePresence, paneRole, reportPanePresence } from './terminalPresence'

interface DomPresence { hostHidden: boolean; onScreen: boolean; focusWithin: boolean }

const isHostHidden = (host: Element | null): boolean => host?.classList.contains('workspace-host-hidden') ?? false

/**
 * The pane's presence (F16), from its workspace host, whether it is on screen, the active and
 * maximized panes, and the keyboard focus. With `report`, every change goes to the main process,
 * which paces the pane's output by it, and an unmounted view counts as hidden.
 */
export function useTerminalPresence(options: {
  paneId: string
  workspaceId?: string
  hostRef: RefObject<HTMLElement | null>
  report: boolean
}): { presence: TerminalPresence; presenceRef: MutableRefObject<TerminalPresence> } {
  const { paneId, workspaceId, hostRef, report } = options
  const activePaneId = useUIStore((s) => s.activePaneId)
  const maximizedPaneId = useUIStore((s) => s.maximizedPaneId)
  const role = useWorkspaceStore((s) => workspaceId
    ? paneRole(s.workspaces.find((w) => w.id === workspaceId)?.panes, paneId, activePaneId, maximizedPaneId)
    : 'other')
  const flags = { active: role === 'active' || role === 'active-suppressed', suppressed: role === 'suppressed' || role === 'active-suppressed' }
  const flagsRef = useRef(flags)

  const [dom, setDom] = useState<DomPresence>({ hostHidden: false, onScreen: true, focusWithin: false })
  const presence = computePanePresence({ ...dom, ...flags })
  const presenceRef = useRef(presence)
  // Before every other effect of the pane, so they read this commit's presence.
  useEffect(() => {
    flagsRef.current = flags
    presenceRef.current = presence
  })

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const workspaceHost = host.closest('.workspace-host')
    let current: DomPresence = { hostHidden: isHostHidden(workspaceHost), onScreen: true, focusWithin: host.contains(document.activeElement) }
    const update = (patch: Partial<DomPresence>): void => {
      current = { ...current, ...patch }
      presenceRef.current = computePanePresence({ ...current, ...flagsRef.current })
      setDom(current)
    }
    // Read now, so the view mounting right after this effect already knows (a hidden pane never takes WebGL).
    update({})
    const hostObserver = workspaceHost ? new MutationObserver(() => update({ hostHidden: isHostHidden(workspaceHost) })) : null
    hostObserver?.observe(workspaceHost!, { attributes: true, attributeFilter: ['class'] })
    // A `display: none` ancestor (a closed panel) or a scrolled-away view stops intersecting.
    const screenObserver = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => {
        const last = entries[entries.length - 1]
        if (last) update({ onScreen: last.isIntersecting })
      })
      : null
    screenObserver?.observe(host)
    const onFocusIn = (): void => { if (!current.focusWithin) update({ focusWithin: true }) }
    const onFocusOut = (event: FocusEvent): void => {
      const inside = event.relatedTarget instanceof Node && host.contains(event.relatedTarget)
      if (current.focusWithin !== inside) update({ focusWithin: inside })
    }
    host.addEventListener('focusin', onFocusIn)
    host.addEventListener('focusout', onFocusOut)
    return () => {
      hostObserver?.disconnect()
      screenObserver?.disconnect()
      host.removeEventListener('focusin', onFocusIn)
      host.removeEventListener('focusout', onFocusOut)
    }
  }, [hostRef, paneId])

  useEffect(() => {
    if (report) reportPanePresence(paneId, presence)
  }, [paneId, presence, report])

  // The view is gone: nothing draws the pane until one attaches again.
  useEffect(() => () => { if (report) reportPanePresence(paneId, 'hidden', true) }, [paneId, report])

  return { presence, presenceRef }
}
