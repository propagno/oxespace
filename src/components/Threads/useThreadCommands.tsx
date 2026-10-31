import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { Command, RefreshCw, Slash } from 'lucide-react'
import type { ThreadCommand, ThreadCommandCatalog, ThreadSnapshot } from '../../../shared/types/thread'
import { CODEX_THREAD_COMMANDS, NATIVE_CLI_COMMANDS } from '../../../shared/threadCommands'
import { hasDesktopCommand } from '../../../shared/threadDesktopCommands'
import { EmptyState, ErrorState, LoadingState, Spinner } from '../../ui'
import { useTranslation } from 'react-i18next'
import { useThreadStore } from '../../store/thread.store'
import { i18n } from '../../i18n'

const LOCAL_NAMES = ['new', 'stop', 'accounts', 'help'] as const
const localNames = new Set<string>(LOCAL_NAMES)
const localCommands = (): ThreadCommand[] => LOCAL_NAMES.map(name => ({ name, description: i18n.t(`thread:commands.local.${name}`), source: 'oxe' }))

/**
 * A command's description in the interface language when the app knows it (the built-in lists of
 * shared/threadCommands.ts); a description the provider reported stays as the provider wrote it.
 */
export function describeThreadCommand(command: ThreadCommand, provider: 'claude' | 'codex'): string {
  const key = `thread:commands.${provider}.${command.name}`, own = `thread:commands.desktop.${command.name}`
  // A command OXESpace itself carries out is described by what it does here, not by the provider.
  if (command.execution === 'desktop') {
    if (i18n.exists(key)) return i18n.t(key as 'thread:commands.codex.model')
    if (i18n.exists(own)) return i18n.t(own as 'thread:commands.desktop.help')
    return command.description
  }
  const builtIn = [...NATIVE_CLI_COMMANDS[provider], ...(provider === 'codex' ? CODEX_THREAD_COMMANDS : [])].find(item => item.name === command.name)
  return builtIn?.description === command.description && i18n.exists(key) ? i18n.t(key as 'thread:commands.codex.model') : command.description
}

export function useThreadCommands({ snapshot, draft, textarea, pending, run, onNewThread, onAccounts, onError }: {
  snapshot: ThreadSnapshot | null; draft: string; textarea: RefObject<HTMLTextAreaElement | null>; pending: boolean
  run: (action: () => Promise<unknown>) => Promise<void>
  onNewThread?: () => void; onAccounts?: () => void; onError: (message: string) => void
}) {
  const { t } = useTranslation('thread')
  const [catalog, setCatalog] = useState<ThreadCommandCatalog>({ commands: [] })
  const [loading, setLoading] = useState(false)
  const [catalogRevision, setCatalogRevision] = useState(0)
  const refreshRequested = useRef(false)
  const [focused, setFocused] = useState(false), [cursor, setCursor] = useState(draft.length)
  const [dismissed, setDismissed] = useState<string | null>(null), [manual, setManual] = useState(false)
  const [selected, setSelected] = useState(0)
  const [popupHeight, setPopupHeight] = useState(360)
  const listId = useId(), menu = useRef<HTMLDivElement>(null)
  // Where the caret goes once the chosen command is on screen. Placed right after that render, not in a later frame:
  // a frame can arrive after the person has already selected or typed, and would collapse their selection.
  const caretAfterChoose = useRef<number | null>(null)
  useLayoutEffect(() => {
    const at = caretAfterChoose.current
    if (at === null) return
    caretAfterChoose.current = null
    textarea.current?.focus(); textarea.current?.setSelectionRange(at, at)
  })
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
    if (!api?.commands) { setLoading(false); setCatalog({ commands: [], warning: i18n.t('thread:commands.restartToLoad') }); return }
    // Typing, cursor movement and popup focus only filter the catalog already loaded for this thread.
    void (forceRefresh ? api.commands(threadId, true) : api.commands(threadId)).then(value => { if (active) setCatalog(value) }).catch(() => {
      if (active) setCatalog({ commands: [], warning: i18n.t('thread:commands.loadFailed') })
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [threadId, provider, rootPath, catalogRevision])
  const commands = useMemo(() => {
    const local = localCommands().filter(command => command.name !== 'new' || onNewThread).filter(command => command.name !== 'accounts' || onAccounts)
    const provider = snapshot?.thread.provider
    // The built-in lists name every native command; only those Thread can run are offered. A command that would only
    // answer "not integrated" is left out of the list (typing it still explains why).
    const baseline = provider ? [...new Map([...NATIVE_CLI_COMMANDS[provider], ...(provider === 'codex' ? CODEX_THREAD_COMMANDS : [])].map(command => [command.name, command])).values()]
      .filter(command => hasDesktopCommand(provider, command.name)) : []
    const native = [...catalog.commands.filter(command => command.execution !== 'unavailable'), ...baseline.filter(command => !catalog.commands.some(item => item.name === command.name)).map(command => ({ ...command, execution: 'desktop' as const }))]
      .map(command => provider ? { ...command, description: describeThreadCommand(command, provider) } : command)
    const all = [...native, ...local.filter(command => !native.some(item => item.name === command.name))]
    if (!query) return all
    return all.filter(command => command.name.toLowerCase().includes(query) || command.description.toLowerCase().includes(query)).sort((a, b) => Number(b.name.toLowerCase().startsWith(query)) - Number(a.name.toLowerCase().startsWith(query)))
    // t: the descriptions follow a language switch.
  }, [catalog, query, onNewThread, onAccounts, snapshot, t]) // eslint-disable-line react-hooks/exhaustive-deps
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
    if (match[2]?.trim()) { onError(t('commands.noArguments', { name: match[1] })); dismiss(); return true }
    if (pending || !snapshot) return true
    switch (match[1]) {
      case 'new': if (onNewThread) { clearCommand(); onNewThread() } else onError(t('commands.newUnavailable')); break
      case 'accounts': if (onAccounts) { clearCommand(); onAccounts() } else onError(t('commands.accountsUnavailable')); break
      case 'help': setDraft('/'); setCursor(1); setDismissed(null); setManual(true); textarea.current?.focus(); break
      case 'stop':
        dismiss()
        if (snapshot.thread.status !== 'running' && snapshot.thread.status !== 'approval') { onError(t('commands.nothingToStop')); break }
        void run(async () => { await window.oxe.thread!.interrupt(snapshot.thread.id); clearCommand() })
        break
    }
    return true
  }
  const choose = (command: ThreadCommand) => {
    if (command.execution === 'unavailable') { onError(command.unavailableReason || t('commands.notIntegrated', { name: command.name })); return }
    if (localNames.has(command.name) && command.source === 'oxe' && !catalog.commands.some(native => native.name === command.name)) { executeLocal(`/${command.name}`); return }
    const suffix = token ? draft.slice(token[0].length).trimStart() : draft
    const text = `/${command.name} ${suffix}`
    caretAfterChoose.current = text.length
    setDraft(text); setManual(false); setDismissed(text); setCursor(text.length)
  }
  const show = () => {
    if (!snapshot || pending) return
    // The store, not this render's copy: a key pressed right after the text changed would see the old text.
    const current = threadId ? useThreadStore.getState().drafts[threadId] ?? '' : draft
    if (!current) { setDraft('/'); setCursor(1) }
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
    // An exact command already typed by the user is ready to submit. Selecting
    // it again only inserts a trailing space and makes Enter feel unresponsive.
    if (event.key === 'Enter' && !event.shiftKey && !manual && token && draft.trim() === token[0] && commands.some(command => command.name.toLowerCase() === token[1].toLowerCase())) return false
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
      <header><Command size={14} /><span>{t('commands.title')}</span>{loading && <Spinner size="sm" label={t('commands.loading')} />}<button type="button" aria-label={t('commands.refresh')} title={t('commands.refresh')} disabled={loading} onMouseDown={event => event.preventDefault()} onClick={() => { refreshRequested.current = true; setCatalogRevision(value => value + 1) }}><RefreshCw size={14} /></button></header>
      <div className="thread-command-list" id={listId} role="listbox" aria-label={t('commands.list')} ref={menu}>
        {commands.map((command, index) => <button key={command.name} type="button" role="option" id={`${listId}-${index}`} aria-selected={activeIndex === index} tabIndex={-1}
          onMouseDown={event => event.preventDefault()} onMouseMove={() => setSelected(index)} onClick={() => choose(command)}>
          <Slash size={14} /><span><strong>/{command.name}{command.argumentHint && <small>{command.argumentHint}</small>}</strong><span>{command.description}</span></span><small>{command.execution === 'desktop' || localNames.has(command.name) && command.source === 'oxe' && !catalog.commands.some(native => native.name === command.name) ? 'Thread' : command.source === 'oxe' ? t('commands.skill') : command.source === 'claude' ? 'Claude' : 'Codex'}</small>
        </button>)}
      </div>
      {!commands.length && (loading ? <LoadingState label={t('commands.loading')} /> : <EmptyState compact title={t('commands.none')} />)}
      {catalog.warning && <ErrorState compact title={catalog.warning} />}
      <footer><span>{t('commands.navigate')}</span><span>{t('commands.select')}</span><span>{t('commands.close')}</span></footer>
    </div> : null
  }
}
