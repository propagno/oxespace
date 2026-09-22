import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { Command, RefreshCw, Slash } from 'lucide-react'
import type { ThreadCommand, ThreadCommandCatalog, ThreadSnapshot } from '../../../shared/types/thread'
import { CODEX_THREAD_COMMANDS, NATIVE_CLI_COMMANDS } from '../../../shared/threadCommands'
import { hasDesktopCommand } from '../../../shared/threadDesktopCommands'
import { useThreadStore } from '../../store/thread.store'

const LOCAL_COMMANDS: ThreadCommand[] = [
  { name: 'new', description: 'Start a new thread', source: 'oxe' },
  { name: 'stop', description: 'Interrupt the current turn', source: 'oxe' },
  { name: 'accounts', description: 'Connect your Claude or Codex subscription', source: 'oxe' },
  { name: 'help', description: 'Show available commands and skills', source: 'oxe' }
]
const localNames = new Set(LOCAL_COMMANDS.map(command => command.name))

export function useThreadCommands({ snapshot, draft, textarea, pending, run, onNewThread, onAccounts, onError }: {
  snapshot: ThreadSnapshot | null; draft: string; textarea: RefObject<HTMLTextAreaElement | null>; pending: boolean
  run: (action: () => Promise<unknown>) => Promise<void>
  onNewThread?: () => void; onAccounts?: () => void; onError: (message: string) => void
}) {
  const [catalog, setCatalog] = useState<ThreadCommandCatalog>({ commands: [] })
  const [loading, setLoading] = useState(false)
  const [catalogRevision, setCatalogRevision] = useState(0)
  const refreshRequested = useRef(false)
  const [focused, setFocused] = useState(false), [cursor, setCursor] = useState(draft.length)
  const [dismissed, setDismissed] = useState<string | null>(null), [manual, setManual] = useState(false)
  const [selected, setSelected] = useState(0)
  const [popupHeight, setPopupHeight] = useState(360)
  const listId = useId(), menu = useRef<HTMLDivElement>(null)
  const token = draft.match(/^\/([a-z0-9_:-]*)(?=\s|$)/i)
  const open = Boolean(snapshot && focused && !pending && dismissed !== draft && (manual || token && cursor <= token[0].length))
  const query = manual ? '' : token?.[1].toLowerCase() ?? ''
  const threadId = snapshot?.thread.id
  const provider = snapshot?.thread.provider, rootPath = snapshot?.thread.rootPath
  useLayoutEffect(() => {
    if (!open) return
    const form = textarea.current?.closest('form')
    const measure = () => {
      const header = form?.closest('.thread-view')?.querySelector('.thread-heading')
      if (form) setPopupHeight(Math.max(80, Math.min(360, form.getBoundingClientRect().top - (header?.getBoundingClientRect().bottom ?? 48) - 16)))
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    if (form) observer?.observe(form)
    window.addEventListener('resize', measure)
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure) }
  }, [open, textarea])
  useEffect(() => { setCatalog({ commands: [] }); setDismissed(null); setManual(false); setSelected(0) }, [threadId, provider, rootPath])
  useEffect(() => {
    if (!threadId) return
    let active = true
    const forceRefresh = refreshRequested.current
    refreshRequested.current = false
    setLoading(true)
    const api = window.oxe?.thread
    if (!api?.commands) { setLoading(false); setCatalog({ commands: [], warning: 'Update and restart the application to load agent commands.' }); return }
    // Typing, cursor movement and popup focus only filter the catalog already loaded for this thread.
    void (forceRefresh ? api.commands(threadId, true) : api.commands(threadId)).then(value => { if (active) setCatalog(value) }).catch(() => {
      if (active) setCatalog({ commands: [], warning: 'Could not load agent commands. Use Refresh commands to retry.' })
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [threadId, provider, rootPath, catalogRevision])
  const commands = useMemo(() => {
    const local = LOCAL_COMMANDS.filter(command => command.name !== 'new' || onNewThread).filter(command => command.name !== 'accounts' || onAccounts)
    const baseline = snapshot ? [...new Map([...NATIVE_CLI_COMMANDS[snapshot.thread.provider], ...(snapshot.thread.provider === 'codex' ? CODEX_THREAD_COMMANDS : [])].map(command => [command.name, command])).values()] : []
    const native = [...catalog.commands, ...baseline.filter(command => !catalog.commands.some(item => item.name === command.name)).map(command => ({ ...command, execution: snapshot && hasDesktopCommand(snapshot.thread.provider, command.name) ? 'desktop' as const : 'unavailable' as const }))]
    const all = [...native, ...local.filter(command => !native.some(item => item.name === command.name))]
    if (!query) return all
    return all.filter(command => command.name.toLowerCase().includes(query) || command.description.toLowerCase().includes(query)).sort((a, b) => Number(b.name.toLowerCase().startsWith(query)) - Number(a.name.toLowerCase().startsWith(query)))
  }, [catalog, query, onNewThread, onAccounts, snapshot])
  useEffect(() => { setSelected(0) }, [query, threadId])
  const activeIndex = Math.min(selected, Math.max(0, commands.length - 1))
  useLayoutEffect(() => { if (open) menu.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' }) }, [open, activeIndex])
  const setDraft = (text: string) => { if (threadId) useThreadStore.getState().setDraft(threadId, text) }
  const dismiss = () => { setDismissed(draft); setManual(false) }
  const clearCommand = () => {
    if (threadId && useThreadStore.getState().drafts[threadId] === draft && /^\/\S*\s*$/.test(draft)) setDraft('')
    dismiss()
  }
  const executeLocal = (text: string): boolean => {
    const match = text.trim().match(/^\/(new|stop|accounts|help)(?:\s+([\s\S]*))?$/)
    if (!match) return false
    if (match[1] === 'new' || snapshot?.thread.provider === 'codex' && match[1] === 'stop') return false
    if (catalog.commands.some(command => command.name === match[1])) return false
    if (match[2]?.trim()) { onError(`/${match[1]} does not take arguments.`); dismiss(); return true }
    if (pending || !snapshot) return true
    switch (match[1]) {
      case 'new': if (onNewThread) { clearCommand(); onNewThread() } else onError('New thread is unavailable.'); break
      case 'accounts': if (onAccounts) { clearCommand(); onAccounts() } else onError('Agent accounts are unavailable.'); break
      case 'help': setDraft('/'); setCursor(1); setDismissed(null); setManual(true); textarea.current?.focus(); break
      case 'stop':
        dismiss()
        if (snapshot.thread.status !== 'running' && snapshot.thread.status !== 'approval') { onError('There is no running turn to stop.'); break }
        void run(async () => { await window.oxe.thread!.interrupt(snapshot.thread.id); clearCommand() })
        break
    }
    return true
  }
  const choose = (command: ThreadCommand) => {
    if (command.execution === 'unavailable') { onError(command.unavailableReason || `/${command.name} is not integrated with Thread yet.`); return }
    if (localNames.has(command.name) && command.source === 'oxe' && !catalog.commands.some(native => native.name === command.name)) { executeLocal(`/${command.name}`); return }
    const suffix = token ? draft.slice(token[0].length).trimStart() : draft
    const text = `/${command.name} ${suffix}`
    setDraft(text); setManual(false); setDismissed(text); setCursor(text.length)
    requestAnimationFrame(() => { textarea.current?.focus(); textarea.current?.setSelectionRange(text.length, text.length) })
  }
  const show = () => {
    if (!snapshot || pending) return
    if (!draft) { setDraft('/'); setCursor(1) }
    setFocused(true); setDismissed(null); setManual(true); textarea.current?.focus()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return true
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key === '/') { event.preventDefault(); event.stopPropagation(); show(); return true }
    if (!open) return false
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); return true }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); setSelected((activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + commands.length) % Math.max(1, commands.length)); return true
    }
    if ((event.key === 'Enter' && !event.shiftKey || event.key === 'Tab' && !event.shiftKey) && commands.length) {
      event.preventDefault(); choose(commands[activeIndex]); return true
    }
    return false
  }
  return {
    open, show, executeLocal, onKeyDown,
    onFocus: () => setFocused(true), onBlur: () => { setFocused(false); setManual(false) },
    onChange: (value: string, position: number) => { setDraft(value); setCursor(position); setDismissed(null); setManual(false) },
    onSelect: (position: number) => setCursor(position),
    inputProps: { 'aria-autocomplete': 'list' as const, 'aria-haspopup': 'listbox' as const, 'aria-controls': open ? listId : undefined, 'aria-activedescendant': open && commands.length ? `${listId}-${activeIndex}` : undefined },
    popup: open ? <div className="thread-command-popup" style={{ maxHeight: popupHeight }}>
      <header><Command size={13} /><span>Commands & skills</span>{loading && <small role="status">Loading…</small>}<button type="button" aria-label="Refresh commands" title="Refresh commands" disabled={loading} onMouseDown={event => event.preventDefault()} onClick={() => { refreshRequested.current = true; setCatalogRevision(value => value + 1) }}><RefreshCw size={13} /></button></header>
      <div className="thread-command-list" id={listId} role="listbox" aria-label="Thread commands" ref={menu}>
        {commands.map((command, index) => <button key={command.name} type="button" role="option" id={`${listId}-${index}`} aria-selected={activeIndex === index} tabIndex={-1}
          onMouseDown={event => event.preventDefault()} onMouseMove={() => setSelected(index)} onClick={() => choose(command)}>
          <Slash size={14} /><span><strong>/{command.name}{command.argumentHint && <small>{command.argumentHint}</small>}</strong><span>{command.description}</span></span><small>{command.execution === 'unavailable' ? 'Unavailable' : command.execution === 'desktop' || localNames.has(command.name) && command.source === 'oxe' && !catalog.commands.some(native => native.name === command.name) ? 'Thread' : command.source === 'oxe' ? 'OXE skill' : command.source === 'claude' ? 'Claude' : 'Codex'}</small>
        </button>)}
      </div>
      {!commands.length && <p role="status">{loading ? 'Loading commands…' : 'No matching commands. You can still type a command directly.'}</p>}
      {catalog.warning && <p className="thread-command-warning" role="status">{catalog.warning}</p>}
      <footer><span>↑ ↓ navigate</span><span>Enter select</span><span>Esc close</span></footer>
    </div> : null
  }
}
