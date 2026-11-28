import { useEffect, useState } from 'react'
import { OctagonX, Play, Plus, Power, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button, ErrorState, IconButton } from '../../ui'
import { TerminalPane } from '../Panes/TerminalPane'
import { useTerminalStore } from '../../store/terminal.store'
import { getActiveThreadShellSlot, setActiveThreadShellSlot, THREAD_SHELL_SLOTS, threadShellPane } from '../../lib/threadShell'
import type { ConversationThread } from '../../../shared/types/thread'
import type { WorkspacePane } from '../../../shared/types/workspace'

const MAX_TERMINALS = THREAD_SHELL_SLOTS
/** Terminal slot numbers per Thread; the shells themselves outlive the panel. */
const slots = new Map<string, number[]>()
/** Panes that already had their first automatic start (a stopped shell stays stopped). */
const autoStarted = new Set<string>()

const paneId = threadShellPane

function TerminalTab({ id, label, selected, closable, onSelect, onClose }: {
  id: string; label: string; selected: boolean; closable: boolean; onSelect(): void; onClose(): void
}) {
  const { t } = useTranslation('thread')
  const status = useTerminalStore(state => state.panes[id]?.status ?? 'idle')
  return <span className={`thread-shell-tab${selected ? ' is-selected' : ''}`}>
    <Button variant="ghost" size="sm" className="thread-shell-tab-main" aria-pressed={selected} onClick={onSelect}>
      <i className="thread-terminal-dot" data-status={status} aria-hidden="true" />{label}
    </Button>
    {closable && <IconButton size="sm" className="thread-shell-tab-close" label={t('terminal.closeTab', { label })} title={t('terminal.closeTab', { label })} icon={<X size={12} aria-hidden="true" />} onClick={onClose} />}
  </span>
}

export function ThreadProjectTerminal({ thread }: { thread: ConversationThread }) {
  const { t } = useTranslation('thread')
  const [list, setList] = useState<number[]>(() => slots.get(thread.id) ?? [1])
  const [selected, setSelected] = useState(() => {
    const active = getActiveThreadShellSlot(thread.id)
    const available = slots.get(thread.id) ?? [1]
    return available.includes(active) ? active : (available[0] ?? 1)
  })
  const [error, setError] = useState('')
  useEffect(() => { setActiveThreadShellSlot(thread.id, selected) }, [thread.id, selected])
  const update = (next: number[]): void => { slots.set(thread.id, next); setList(next) }
  const id = paneId(thread.id, selected)
  const act = (promise: Promise<unknown>): void => { void promise.catch(cause => setError(String(cause))) }
  return <section className="thread-project-terminal" aria-label={t('terminal.label')}>
    <header className="thread-terminal-bar">
      <nav aria-label={t('terminal.tabs')}>{list.map(slot => <TerminalTab key={slot} id={paneId(thread.id, slot)} label={t('terminal.tab', { number: slot })} selected={selected === slot} closable={list.length > 1}
        onSelect={() => setSelected(slot)}
        onClose={() => {
          act(window.oxe.terminal.stop({ paneId: paneId(thread.id, slot) }))
          const next = list.filter(value => value !== slot)
          update(next)
          if (selected === slot) setSelected(next[0] ?? 1)
        }} />)}
        <IconButton size="sm" className="thread-terminal-icon" label={t('terminal.new')} title={t('terminal.new')} disabled={list.length >= MAX_TERMINALS}
          icon={<Plus size={14} aria-hidden="true" />}
          onClick={() => { const slot = Math.max(0, ...list) + 1; update([...list, slot]); setSelected(slot) }} />
      </nav>
      <div className="thread-terminal-actions" role="group" aria-label={t('terminal.controls')}>
        <IconButton size="sm" className="thread-terminal-icon" label={t('terminal.start')} title={t('terminal.start')} icon={<Play size={14} aria-hidden="true" />} onClick={() => window.dispatchEvent(new CustomEvent('oxe:start-pane', { detail: { paneId: id } }))} />
        <IconButton size="sm" className="thread-terminal-icon" label={t('terminal.interrupt')} title={t('terminal.interruptTitle')} icon={<OctagonX size={14} aria-hidden="true" />} onClick={() => act(window.oxe.terminal.write({ paneId: id, data: '\u0003' }))} />
        <IconButton size="sm" className="thread-terminal-icon" label={t('terminal.stop')} title={t('terminal.stopTitle')} icon={<Power size={14} aria-hidden="true" />} onClick={() => act(window.oxe.terminal.stop({ paneId: id }))} />
      </div>
    </header>
    {error && <ErrorState compact title={error} />}
    <div className="thread-project-terminal-content">
      {list.map(slot => {
        const slotPaneId = paneId(thread.id, slot)
        const isSelected = selected === slot
        const first = !autoStarted.has(slotPaneId)
        if (isSelected) autoStarted.add(slotPaneId)
        const slotPane: WorkspacePane = { id: slotPaneId, workspaceId: thread.workspaceId, type: 'terminal', rowIndex: 0, columnIndex: 0, shellProfileId: null, status: 'idle', agentProfileId: null, agentName: null, displayName: t('terminal.tab', { number: slot }), createdAt: null, rootPath: thread.rootPath }
        return <div key={slotPaneId} className="thread-terminal-slot" style={{ display: isSelected ? 'flex' : 'none', flex: 1, minHeight: 0 }} aria-hidden={!isSelected}>
          <TerminalPane pane={slotPane} workspaceId={thread.workspaceId} workspaceRootPath={thread.rootPath} autoStart={isSelected && first} />
        </div>
      })}
    </div>
  </section>
}
