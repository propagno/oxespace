import { useState } from 'react'
import { OctagonX, Play, Plus, Power, X } from 'lucide-react'
import { TerminalPane } from '../Panes/TerminalPane'
import { useTerminalStore } from '../../store/terminal.store'
import type { ConversationThread } from '../../../shared/types/thread'
import type { WorkspacePane } from '../../../shared/types/workspace'

const MAX_TERMINALS = 8
/** Terminal slot numbers per Thread; the shells themselves outlive the panel. */
const slots = new Map<string, number[]>()
/** Panes that already had their first automatic start (a stopped shell stays stopped). */
const autoStarted = new Set<string>()

const paneId = (threadId: string, slot: number): string => `thread-shell:${threadId}:${slot}`

function TerminalTab({ id, label, selected, closable, onSelect, onClose }: {
  id: string; label: string; selected: boolean; closable: boolean; onSelect(): void; onClose(): void
}) {
  const status = useTerminalStore(state => state.panes[id]?.status ?? 'idle')
  return <span className={`thread-terminal-tab${selected ? ' is-selected' : ''}`}>
    <button type="button" className="thread-terminal-tab-main" aria-pressed={selected} onClick={onSelect}>
      <i className="thread-terminal-dot" data-status={status} aria-hidden="true" />{label}
    </button>
    {closable && <button type="button" className="thread-terminal-tab-close" aria-label={`Close ${label}`} title={`Close ${label}`} onClick={onClose}><X size={12} aria-hidden="true" /></button>}
  </span>
}

export function ThreadProjectTerminal({ thread }: { thread: ConversationThread }) {
  const [list, setList] = useState<number[]>(() => slots.get(thread.id) ?? [1])
  const [selected, setSelected] = useState(list[0] ?? 1)
  const [error, setError] = useState('')
  const update = (next: number[]): void => { slots.set(thread.id, next); setList(next) }
  const id = paneId(thread.id, selected)
  const pane: WorkspacePane = { id, workspaceId: thread.workspaceId, type: 'terminal', rowIndex: 0, columnIndex: 0, shellProfileId: null, status: 'idle', agentProfileId: null, agentName: null, displayName: `Terminal ${selected}`, createdAt: null, rootPath: thread.rootPath }
  const first = !autoStarted.has(id)
  autoStarted.add(id)
  const act = (promise: Promise<unknown>): void => { void promise.catch(cause => setError(String(cause))) }
  return <section className="thread-project-terminal" aria-label="Project terminal">
    <header className="thread-terminal-bar">
      <nav aria-label="Project terminals">{list.map(slot => <TerminalTab key={slot} id={paneId(thread.id, slot)} label={`Terminal ${slot}`} selected={selected === slot} closable={list.length > 1}
        onSelect={() => setSelected(slot)}
        onClose={() => {
          act(window.oxe.terminal.stop({ paneId: paneId(thread.id, slot) }))
          const next = list.filter(value => value !== slot)
          update(next)
          if (selected === slot) setSelected(next[0] ?? 1)
        }} />)}
        <button type="button" className="thread-terminal-icon" aria-label="New terminal" title="New terminal" disabled={list.length >= MAX_TERMINALS}
          onClick={() => { const slot = Math.max(0, ...list) + 1; update([...list, slot]); setSelected(slot) }}><Plus size={14} aria-hidden="true" /></button>
      </nav>
      <div className="thread-terminal-actions" role="group" aria-label="Shell controls">
        <button type="button" className="thread-terminal-icon" aria-label="Start shell" title="Start shell" onClick={() => window.dispatchEvent(new CustomEvent('oxe:start-pane', { detail: { paneId: id } }))}><Play size={14} aria-hidden="true" /></button>
        <button type="button" className="thread-terminal-icon" aria-label="Interrupt command" title="Interrupt command (Ctrl+C)" onClick={() => act(window.oxe.terminal.write({ paneId: id, data: '\u0003' }))}><OctagonX size={14} aria-hidden="true" /></button>
        <button type="button" className="thread-terminal-icon" aria-label="Stop shell" title="Stop shell — closing this panel keeps the process running" onClick={() => act(window.oxe.terminal.stop({ paneId: id }))}><Power size={14} aria-hidden="true" /></button>
      </div>
    </header>
    {error && <p role="alert" className="thread-terminal-error">{error}</p>}
    <div className="thread-project-terminal-content"><TerminalPane key={pane.id} pane={pane} workspaceId={thread.workspaceId} workspaceRootPath={thread.rootPath} autoStart={first} /></div>
  </section>
}
