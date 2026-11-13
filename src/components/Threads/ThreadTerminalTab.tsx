import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight, TerminalSquare } from 'lucide-react'

/** A terminal pane in one of this conversation's places (BACKEND #704 §A18). */
export interface ThreadPaneEntry {
  paneId: string
  title: string
  workspaceId: string
  placeId: string
  via: string
  group: 'agent' | 'yours'
}

interface PanesBridge {
  panes?: (threadId: string) => Promise<ThreadPaneEntry[] | null | undefined>
  onPlacesChanged?: (listener: (event: { threadId?: string } | undefined) => void) => () => void
}

function bridge(): PanesBridge | undefined {
  return (window as unknown as { oxe?: { thread?: PanesBridge } }).oxe?.thread
}

/** Opens a pane in OxeCode: App switches the view, activates its workspace and focuses the terminal. */
export function openPaneInCode(pane: Pick<ThreadPaneEntry, 'paneId' | 'workspaceId'>): void {
  window.dispatchEvent(new CustomEvent('oxe:open-pane', { detail: { paneId: pane.paneId, workspaceId: pane.workspaceId } }))
}

function PaneGroup(props: { title: string; panes: ThreadPaneEntry[]; openLabel: string }): ReactElement | null {
  if (props.panes.length === 0) return null
  return (
    <section className="thread-terminal-group">
      <h3>{props.title}</h3>
      <ul>
        {props.panes.map(pane => <li key={pane.paneId} data-pane-id={pane.paneId}>
          <button type="button" className="thread-terminal-row" title={props.openLabel} onClick={() => openPaneInCode(pane)}>
            <TerminalSquare size={14} aria-hidden="true" />
            <span className="thread-terminal-row-title">{pane.title}</span>
            <span className="thread-terminal-row-open">{props.openLabel}<ArrowUpRight size={12} aria-hidden="true" /></span>
          </button>
        </li>)}
      </ul>
    </section>
  )
}

/** The task's Terminal tab (DESIGN U4.4): the agent's panes and yours whose cwd is in a place; it follows quietly, no toast. */
export function ThreadTerminalTab(props: { threadId: string }): ReactElement {
  const { threadId } = props
  const { t } = useTranslation('thread')
  const [panes, setPanes] = useState<ThreadPaneEntry[]>([])

  useEffect(() => {
    const api = bridge()
    let alive = true
    const read = (): void => {
      void api?.panes?.(threadId).then(value => { if (alive) setPanes(Array.isArray(value) ? value : []) }, () => undefined)
    }
    setPanes([])
    read()
    const off = api?.onPlacesChanged?.(event => {
      if (event?.threadId && event.threadId !== threadId) return
      read()
    })
    return () => { alive = false; off?.() }
  }, [threadId])

  const agent = panes.filter(pane => pane.group === 'agent')
  const yours = panes.filter(pane => pane.group === 'yours')
  return (
    <div className="thread-terminal-tab">
      <PaneGroup title={t('terminalTab.agent')} panes={agent} openLabel={t('terminalTab.open')} />
      <PaneGroup title={t('terminalTab.yours')} panes={yours} openLabel={t('terminalTab.open')} />
      {panes.length === 0 && <p className="thread-terminal-empty">{t('terminalTab.empty')}</p>}
    </div>
  )
}
