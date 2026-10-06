import { useState } from 'react'
import { TerminalPane } from '../Panes/TerminalPane'
import type { ConversationThread } from '../../../shared/types/thread'
import type { WorkspacePane } from '../../../shared/types/workspace'

const slots = new Map<string, number>()
export function ThreadProjectTerminal({ thread }: { thread: ConversationThread }) {
  const [count, setCount] = useState(slots.get(thread.id) ?? 1)
  const [selected, setSelected] = useState(1)
  const [error, setError] = useState('')
  const pane: WorkspacePane = { id: `thread-shell:${thread.id}:${selected}`, workspaceId: thread.workspaceId, type: 'terminal', rowIndex: 0, columnIndex: 0, shellProfileId: null, status: 'idle', agentProfileId: null, agentName: null, displayName: `Terminal ${selected}`, createdAt: null, rootPath: thread.rootPath }
  return <section className="thread-project-terminal" aria-label="Project terminal">
    <header><nav aria-label="Project terminals">{Array.from({ length: count }, (_, index) => <button type="button" key={index} aria-pressed={selected === index + 1} onClick={() => setSelected(index + 1)}>Terminal {index + 1}</button>)}</nav><button type="button" disabled={count >= 8} onClick={() => { slots.set(thread.id, count + 1); setCount(count + 1); setSelected(count + 1) }}>New terminal</button></header>
    <div className="thread-project-terminal-actions"><button type="button" onClick={() => window.dispatchEvent(new CustomEvent('oxe:start-pane', { detail: { paneId: pane.id } }))}>Start shell</button><button type="button" onClick={() => void window.oxe.terminal.write({ paneId: pane.id, data: '\u0003' }).catch(error => setError(String(error)))}>Interrupt command</button><button type="button" onClick={() => void window.oxe.terminal.stop({ paneId: pane.id }).catch(error => setError(String(error)))}>Stop shell</button></div>
    {error && <p role="alert">{error}</p>}
    <p>Interactive project shell · Closing this panel keeps the process running. After restarting OXESpace, start a new shell.</p>
    <div className="thread-project-terminal-content"><TerminalPane key={pane.id} pane={pane} workspaceId={thread.workspaceId} workspaceRootPath={thread.rootPath} autoStart={false} /></div>
  </section>
}
