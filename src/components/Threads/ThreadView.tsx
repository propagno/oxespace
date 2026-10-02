import { AgentProviderIcon } from '../Sidebar/AgentProviderIcon'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Activity, AlertCircle, ArrowDown, ArrowUp, Check, ChevronDown, Copy, CornerDownLeft, GitBranch, ListTodo, Loader2, MessageSquarePlus, Mic, Minus, Paperclip, Pencil, Pin, Plus, Slash, Square, TerminalSquare, Type, Waypoints, X } from 'lucide-react'
import { ThreadMarkdown } from './ThreadMarkdown'
import { formatNativeUserText } from '../../../shared/native-session-text'
import { blocksThreadInput, PARTIAL_NATIVE_HISTORY_NOTICE } from '../../../shared/threadHistoryNotice'
import { ThreadFailureCard, ThreadUsageDetails } from './ThreadFailureCard'
import type { Workspace } from '../../../shared/types/workspace'
import type { ThreadAttachment, ThreadCommandResult, ThreadEvent } from '../../../shared/types/thread'
import type { DelegationTask } from '../../../shared/types/delegation'
import type { SessionSummary } from '../../../shared/types/session'
import { useGitBranch } from '../../hooks/useGitBranch'
import { useThreadStore } from '../../store/thread.store'
import { THREAD_FONT_DEFAULT, THREAD_FONT_MAX, THREAD_FONT_MIN, useThreadPrefs } from '../../store/thread-prefs.store'
import { useAccountStore, selectAccount } from '../../store/account.store'
import { accountContext, accountMessage } from './ProviderAccountsPanel'
import { useThreadCommands } from './useThreadCommands'
import { DesktopDialog } from '../Navigation/DesktopDialog'
import { DetailList } from '../Navigation/DetailList'
import { ThreadConfigurationBar } from './ThreadConfigurationBar'
import { ThreadActivityGroup } from './ThreadActivityGroup'
import { ThreadLiveActivity } from './ThreadLiveActivity'
import { threadQuickReplies } from './threadQuickReplies'
import { buildThreadTimeline, flattenThreadTimeline } from './threadTimelineModel'
import { threadTurnPresentation } from './threadTurnPresentation'
import { ThreadTimelineWindow } from './ThreadTimeline'
import { deriveThreadComposerState } from './threadComposerState'
import { hasDesktopCommand } from '../../../shared/threadDesktopCommands'
import { useUIStore } from '../../store/ui.store'
import { useThreadWorkbenchStore } from '../../store/thread-workbench.store'
import { ThreadFileActivity, ThreadTurnChanges } from './ThreadFileActivity'
import { ThreadChangesPanel, type ThreadReviewComment } from './ThreadChangesPanel'
import { ThreadPlan } from './ThreadPlan'
import { ThreadConversationActions } from './ThreadConversationActions'
import { ThreadRequestCard } from './ThreadRequestCard'
import { ThreadApprovalDetails } from './ThreadApprovalDetails'
import { ThreadPromptQueue } from './ThreadPromptQueue'
import { ThreadSubagentActivity } from './ThreadSubagentActivity'
import { VoiceHud } from '../Voice/VoiceHud'
import { DelegationCreateDialog } from '../Delegation/DelegationCreateDialog'
import { useOxeVoice } from '../../hooks/useOxeVoice'
import { turnChanges, type ThreadChangeEntry } from './threadChanges'
import './ThreadWorkbench.css'
import { Dialog, Popover } from 'radix-ui'
import './ThreadView.css'

function authText(text: string): boolean { return /^Failed to authenticate:|^OAuth token (?:has expired|revoked)/i.test(text) }
function sessionDate(timestamp: number): string { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp) }
function threadError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '') || 'Could not complete the action.'
}

function ThreadMessageBody({ text, role }: { text: string; role: 'user' | 'assistant' }) {
  const [expanded, setExpanded] = useState(false)
  const longPrompt = role === 'user' && (text.length > 800 || text.split('\n').length > 12)
  if (!longPrompt) return <ThreadMarkdown text={text} />
  return <div className="thread-long-prompt">
    {expanded ? <ThreadMarkdown text={text} /> : <p className="thread-long-prompt-preview">{text.replace(/\s+/g, ' ').slice(0, 240).trimEnd()}…</p>}
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Show less' : 'Show full message'}</button>
  </div>
}

export function ThreadView({ workspace, threadId, active = true, onActivate, onCloseCell, onNewThread, onAccounts, onDelegations }: { workspace?: Workspace; threadId?: string | null; active?: boolean; onActivate?: () => void; onCloseCell?: () => void; onNewThread?: () => void; onAccounts?: () => void; onDelegations?: () => void }) {
  const storeSelectedId = useThreadStore(state => state.selectedId)
  const snapshot = useThreadStore(state => threadId ? state.selectedId === threadId ? state.snapshot : state.snapshotCache[threadId] ?? null : state.snapshot)
  const selectedId = threadId ?? storeSelectedId
  const threadFontSize = useThreadPrefs(state => state.fontSize)
  const setThreadFontSize = useThreadPrefs(state => state.setFontSize)
  const workbench = useRef<HTMLDivElement>(null)
  const [availableWidth, setAvailableWidth] = useState(0)
  const review = useThreadWorkbenchStore(state => selectedId ? state.views[selectedId] : undefined)
  const reviewWidth = useThreadWorkbenchStore(state => state.width)
  const drawer = availableWidth > 0 && availableWidth < 1120
  const draft = useThreadStore(state => snapshot ? state.drafts[snapshot.thread.id] ?? '' : '')
  const attachments = useThreadStore(state => snapshot ? state.attachments[snapshot.thread.id] ?? [] : [])
  const [error, setError] = useState(''), [pending, setPending] = useState(false), [loadingEarlier, setLoadingEarlier] = useState(false), [showEnd, setShowEnd] = useState(false)
  const [outgoing, setOutgoing] = useState<{ threadId: string; text: string; attachments: ThreadAttachment[]; knownEvents: Set<string> } | null>(null)
  const [newMessages, setNewMessages] = useState(0)
  const [panel, setPanel] = useState<ThreadCommandResult | null>(null)
  const [resumeTasks, setResumeTasks] = useState<DelegationTask[]>([])
  const [resumeNotice, setResumeNotice] = useState('')
  const [nativeSessions, setNativeSessions] = useState<SessionSummary[]>([])
  const [nativeResumeNotice, setNativeResumeNotice] = useState('')
  const [nativeResumeId, setNativeResumeId] = useState('')
  const [resumeQuery, setResumeQuery] = useState('')
  const [openControl, setOpenControl] = useState<'model' | 'effort' | 'permissions' | null>(null)
  const [rename, setRename] = useState('')
  const [editingTurn, setEditingTurn] = useState<{ id: string; text: string; rewind: number } | null>(null)
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const [delegationOpen, setDelegationOpen] = useState(false)
  const timeline = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null), textarea = useRef<HTMLTextAreaElement>(null), fileInput = useRef<HTMLInputElement>(null)
  const updateTimelineViewport = useRef<(() => void) | null>(null)
  const following = useRef(true), initialized = useRef(false), lastCount = useRef(0), actionInFlight = useRef(false)
  const userScrollIntent = useRef(false)
  const lastScrollDirection = useRef<'up' | 'down' | null>(null)
  const scrollIntentTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const restoreTop = useRef<number | null>(null)
  const restoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (restoreTimer.current) clearTimeout(restoreTimer.current)
    if (scrollIntentTimer.current) clearTimeout(scrollIntentTimer.current)
  }, [])
  const branch = useGitBranch(workspace?.id ?? '', snapshot?.thread.rootPath ?? workspace?.rootPath ?? '')
  const api = window.oxe?.thread
  const voice = useOxeVoice({ enabled: Boolean(active && snapshot && !snapshot.thread.cliActive), onFinalText: text => {
    if (!snapshot) return
    const current = useThreadStore.getState().drafts[snapshot.thread.id] ?? ''
    useThreadStore.getState().setDraft(snapshot.thread.id, `${current}${current && !/\s$/.test(current) ? ' ' : ''}${text} `)
    requestAnimationFrame(() => textarea.current?.focus())
  } })
  useEffect(() => {
    if (!active) return
    const toggle = () => voice.toggle(), start = () => voice.startHold(), end = () => voice.endHold()
    window.addEventListener('oxe:thread-toggle-voice', toggle)
    window.addEventListener('oxe:thread-voice-hold-start', start)
    window.addEventListener('oxe:thread-voice-hold-end', end)
    return () => { window.removeEventListener('oxe:thread-toggle-voice', toggle); window.removeEventListener('oxe:thread-voice-hold-start', start); window.removeEventListener('oxe:thread-voice-hold-end', end) }
  }, [active, voice])
  useEffect(() => {
    const node = workbench.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setAvailableWidth(node.clientWidth))
    observer.observe(node)
    setAvailableWidth(node.clientWidth)
    return () => observer.disconnect()
  }, [])
  const openFile = (entry: ThreadChangeEntry) => { if (snapshot) useThreadWorkbenchStore.getState().setView(snapshot.thread.id, { panel: 'changes', selection: entry.key }) }
  const closeReview = () => { if (snapshot) useThreadWorkbenchStore.getState().setView(snapshot.thread.id, { panel: null }); requestAnimationFrame(() => textarea.current?.focus()) }
  const addReviewComment = (comment: ThreadReviewComment) => {
    if (!snapshot) return
    const reference = `Review comment: ${comment.path} (${comment.side} line ${comment.line})\nEvidence: ${comment.revision}\n> ${comment.content}\n\n${comment.body}`
    const current = useThreadStore.getState().drafts[snapshot.thread.id] ?? ''
    useThreadStore.getState().setDraft(snapshot.thread.id, current ? `${current}\n\n${reference}` : reference)
    if (drawer) closeReview()
    else requestAnimationFrame(() => textarea.current?.focus())
  }
  const appendToConversation = (prompt: string) => {
    if (!snapshot) return
    const current = useThreadStore.getState().drafts[snapshot.thread.id] ?? ''
    useThreadStore.getState().setDraft(snapshot.thread.id, current ? `${current}\n\n${prompt}` : prompt)
    if (drawer) closeReview()
    else requestAnimationFrame(() => textarea.current?.focus())
  }
  const context = accountContext(snapshot?.thread.provider ?? 'claude', snapshot?.thread.workspaceId ?? workspace?.id ?? '', snapshot?.thread)
  const account = useAccountStore(selectAccount(context))
  const contextKey = JSON.stringify(context)
  useEffect(() => { const ctx = JSON.parse(contextKey); if (ctx.workspaceId) void useAccountStore.getState().read(ctx) }, [contextKey])
  const running = snapshot?.thread.status === 'running' || snapshot?.thread.status === 'approval'
  const cliVisible = false
  const turns = useMemo(() => buildThreadTimeline(snapshot?.events ?? []), [snapshot?.events])
  const newestCompletedChange = useMemo(() => {
    for (let index = turns.length - 1; index >= 0; index--) {
      const turn = turns[index]
      if (turn.events.some(event => event.type === 'completed' && event.status === 'completed') && turnChanges(turn.events).length > 0) {
        return `${turn.id}:${turn.events.filter(event => event.type === 'turn-diff').map(event => event.type === 'turn-diff' ? `${event.id}:${event.files.length}` : '').join(',')}`
      }
    }
    return ''
  }, [turns])
  const seenChanges = useRef<{ threadId: string; marker: string } | null>(null)
  useEffect(() => {
    if (!snapshot) return
    const previous = seenChanges.current
    if (!previous || previous.threadId !== snapshot.thread.id) { seenChanges.current = { threadId: snapshot.thread.id, marker: newestCompletedChange }; return }
    if (!newestCompletedChange || previous.marker === newestCompletedChange) return
    previous.marker = newestCompletedChange
    if (active && availableWidth >= 1000 && !review?.panel) useThreadWorkbenchStore.getState().setView(snapshot.thread.id, { panel: 'changes' })
  }, [snapshot, newestCompletedChange, active, availableWidth, review?.panel])
  const timelineRows = useMemo(() => flattenThreadTimeline(turns), [turns])
  const pendingMessage = outgoing && snapshot?.thread.id === outgoing.threadId && !snapshot.events.some(event => event.type === 'message' && event.role === 'user' && event.text === outgoing.text && !outgoing.knownEvents.has(event.id)) ? outgoing : null
  const lastResult = snapshot?.events.filter(e => e.type === 'completed').at(-1)
  const lastConversationMessage = snapshot?.events.filter(e => e.type === 'message').at(-1)
  const quickReplies = lastConversationMessage?.type === 'message' && lastConversationMessage.role === 'assistant' && snapshot?.thread.status === 'idle' && !snapshot.events.some(e => e.type === 'request' && e.request.state === 'pending')
    ? threadQuickReplies(lastConversationMessage.text) : []
  const authFailure = snapshot?.thread.status === 'failed' && (lastResult?.type === 'completed' && lastResult.errorCode === 'authentication' || turns.at(-1)?.events.some(e => e.type === 'message' && e.role === 'assistant' && authText(e.text)))
  const needsLogin = Boolean(snapshot && (authFailure || account && (account.state !== 'connected' || account.method !== 'subscription')))
  const degradedConnection = snapshot?.thread.connection?.state === 'degraded' ? snapshot.thread.connection : undefined
  const lastPrompt = snapshot?.events.filter(e => e.type === 'message' && e.role === 'user').at(-1)
  const cancelScrollRestore = (direction?: 'up' | 'down') => {
    userScrollIntent.current = true
    lastScrollDirection.current = direction ?? null
    if (scrollIntentTimer.current) clearTimeout(scrollIntentTimer.current)
    scrollIntentTimer.current = setTimeout(() => { userScrollIntent.current = false; scrollIntentTimer.current = null }, 900)
    restoreTop.current = null
    if (restoreTimer.current) clearTimeout(restoreTimer.current)
    restoreTimer.current = null
  }
  const scrollEnd = () => { if (timeline.current) { cancelScrollRestore('down'); userScrollIntent.current = false; following.current = true; timeline.current.scrollTop = timeline.current.scrollHeight; setShowEnd(false); setNewMessages(0) } }
  const copyMessage = async (id: string, text: string) => {
    let copied = false
    try { copied = await window.oxe?.clipboard?.writeText(text) ?? false } catch { /* Browser clipboard remains available. */ }
    if (!copied) { try { await navigator.clipboard.writeText(text); copied = true } catch { /* Report the failed copy below. */ } }
    if (copied) setCopiedMessageId(id)
    else setError('Could not copy this message.')
  }
  const loadEarlier = async () => {
    const el = timeline.current
    if (!el || !snapshot?.page?.hasMore || loadingEarlier) return
    const previousHeight = el.scrollHeight
    setLoadingEarlier(true)
    try {
      const count = await useThreadStore.getState().loadEarlier(snapshot.thread.id)
      if (count) requestAnimationFrame(() => { if (timeline.current) timeline.current.scrollTop += timeline.current.scrollHeight - previousHeight })
    } catch { setError('Could not load earlier messages. Try again.') }
    finally { setLoadingEarlier(false) }
  }
  useLayoutEffect(() => {
    const el = timeline.current
    if (!el || !snapshot || !el.clientHeight) return
    if (!initialized.current) {
      const saved = useThreadStore.getState().scrollPositions[snapshot.thread.id]
      following.current = saved?.following ?? true
      restoreTop.current = saved && !saved.following ? saved.top : null
      el.scrollTop = saved && !saved.following ? saved.top : el.scrollHeight
      if (restoreTop.current !== null) {
        if (restoreTimer.current) clearTimeout(restoreTimer.current)
        restoreTimer.current = setTimeout(() => {
          if (timeline.current) timeline.current.scrollTop = restoreTop.current ?? timeline.current.scrollTop
          restoreTop.current = null
          if (timeline.current) useThreadStore.getState().setScroll(snapshot.thread.id, timeline.current.scrollTop, false)
        }, 500)
      }
      initialized.current = true
      lastCount.current = snapshot.events.length
    } else if (following.current) el.scrollTop = el.scrollHeight
    if (!following.current && snapshot.events.length > lastCount.current) setNewMessages(count => count + snapshot.events.length - lastCount.current)
    lastCount.current = snapshot.events.length
    setShowEnd(!following.current)
  }, [snapshot, cliVisible])
  useEffect(() => {
    const node = content.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const el = timeline.current
      if (!el?.clientHeight) return
      el.closest<HTMLElement>('.thread-view')?.style.setProperty('--thread-scrollbar-width', `${el.offsetWidth - el.clientWidth}px`)
      if (restoreTop.current !== null) {
        // Estimated virtual rows can initially clamp a saved position. Retry
        // as their real heights arrive, before persisting a provisional offset.
        el.scrollTop = restoreTop.current
      } else if (following.current) el.scrollTop = el.scrollHeight
    })
    observer.observe(node)
    if (timeline.current) observer.observe(timeline.current)
    return () => observer.disconnect()
  }, [cliVisible])
  useLayoutEffect(() => { const el = textarea.current; if (el) { el.style.height = '0px'; el.style.height = `${Math.min(144, Math.max(40, el.scrollHeight))}px` } }, [draft])
  const action = async (run: () => Promise<unknown>, onSettled?: (success: boolean) => void): Promise<void> => {
    if (actionInFlight.current) return
    actionInFlight.current = true
    setPending(true); setError('')
    let success = false
    try { await run(); if (snapshot) await useThreadStore.getState().refresh(snapshot.thread.id); success = true }
    catch (error) {
      if (String(error).includes('THREAD_AUTH_REQUIRED')) { await useAccountStore.getState().read(context); onAccounts?.(); setError('Connect your subscription before sending.') }
      else setError(threadError(error))
    } finally { onSettled?.(success); actionInFlight.current = false; setPending(false) }
  }
  const commands = useThreadCommands({ snapshot, draft, textarea, pending, run: action, onNewThread, onAccounts, onError: setError })
  const runCommand = async (text: string) => {
    if (!snapshot || !api?.command) throw Error('Restart the updated application to use integrated commands')
    const id = snapshot.thread.id
    if (text.trim() === '/usage') {
      useUIStore.getState().openUsage()
      if (useThreadStore.getState().drafts[id] === text) useThreadStore.getState().setDraft(id, '')
      return
    }
    const result = await api.command(id, text)
    if (result.kind === 'navigate') {
      if (result.threadId) useThreadStore.getState().adopt(await api.read(result.threadId))
      else await useThreadStore.getState().load()
      setPanel(null)
    } else if (result.surface === 'model' || result.surface === 'effort' || result.surface === 'permissions') setOpenControl(result.surface)
    else if (result.surface === 'accounts') onAccounts?.()
    else if (result.surface === 'settings') useUIStore.setState({ isSettingsOpen: true, settingsInitialPage: undefined })
    else if (result.surface === 'changes') useThreadWorkbenchStore.getState().setView(id, { panel: 'project' })
    else if (result.surface === 'commands') { commands.show(); return }
    else if (result.surface === 'sessions') {
      const tasks: DelegationTask[] = []
      let notice = ''
      setNativeSessions([])
      setNativeResumeNotice('')
      setResumeQuery('')
      try {
        let cursor: string | undefined
        let inspected = 0
        do {
          const page = await window.oxe.delegation.status(snapshot.thread.workspaceId, cursor, 100)
          inspected += page.tasks.length
          tasks.push(...page.tasks.filter(task => task.destinationThreadId || task.nativeSession))
          cursor = page.nextCursor ?? undefined
        } while (cursor && inspected < 1000)
        if (cursor) notice = 'Showing sessions from the first 1,000 tasks. Search the complete history in Delegated Work.'
      } catch { notice = 'Delegated sessions could not be loaded. Saved conversations are still available.' }
      setResumeTasks(tasks)
      setResumeNotice(notice)
      try {
        if (!window.oxe.session?.list) throw Error('Session discovery is unavailable')
        const sessions = await window.oxe.session.list({ workspaceId: snapshot.thread.workspaceId, workspaceRootPath: snapshot.thread.rootPath, provider: snapshot.thread.provider })
        const matching = sessions.filter(session => session.provider === snapshot.thread.provider && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(session.sessionId))
        setNativeSessions(matching)
      } catch { setNativeResumeNotice('Could not list provider sessions. You can still enter an exact native session ID below.') }
      setPanel({ ...result, title: 'Resume work' })
    }
    else if (result.surface === 'delegations') {
      if (result.text) {
        let cursor: string | undefined
        let found: Awaited<ReturnType<typeof window.oxe.delegation.status>>['tasks'][number] | undefined
        do {
          const page = await window.oxe.delegation.status(snapshot.thread.workspaceId, cursor, 100)
          found = page.tasks.find(task => task.id === result.text)
          cursor = page.nextCursor ?? undefined
        } while (!found && cursor)
        if (!found) throw Error(`Delegation ${result.text} was not found in this project.`)
        setPanel({ kind: 'panel', title: found.objective, rows: [
          { label: 'Task ID', detail: found.id }, { label: 'State', detail: found.state },
          { label: 'Branch', detail: found.branch }, { label: 'Worktree', detail: found.path },
          { label: 'Base commit', detail: found.baseSha }, { label: 'Provider', detail: found.nativeSession?.provider ?? found.agentProfileId },
          { label: 'Native session', detail: found.nativeSession?.nativeSessionId ?? 'Not yet observed' },
          { label: 'Handoff revision', detail: String(found.knowledgeBundle?.revision ?? 1) }
        ], text: found.context ?? found.handoff })
      } else {
        const status = await window.oxe.delegation.status(snapshot.thread.workspaceId, undefined, 100)
        setPanel({ ...result, title: 'Delegated work', rows: status.tasks.map(task => ({
          label: task.objective, detail: `${task.branch} · ${task.state}\nTask ${task.id}\n${task.path}${task.nativeSession ? `\n${task.nativeSession.provider} session ${task.nativeSession.nativeSessionId} · generation ${task.nativeSession.generation}` : ''}`,
          ...(task.destinationThreadId ? { id: task.destinationThreadId } : {})
        })) })
      }
    }
    else if (result.kind === 'panel') { setRename(snapshot.thread.title); setPanel(result) }
    if (useThreadStore.getState().drafts[id] === text) useThreadStore.getState().setDraft(id, '')
    await useThreadStore.getState().refresh(id)
  }
  const openDelegatedSession = async (task: DelegationTask) => {
    if (!task.destinationThreadId || !api) throw Error('This delegation has no saved Thread conversation. Open Delegated Work for recovery options.')
    const originWorkspaceId = task.originWorkspaceId ?? task.workspaceId
    if (task.recoveryActions?.includes('resume') && snapshot?.thread.workspaceId === originWorkspaceId) await window.oxe.delegation.control(originWorkspaceId, task.id, 'resume')
    useThreadStore.getState().adopt(await api.read(task.destinationThreadId))
    setPanel(null)
  }
  const resumeMatches = (parts: Array<string | number | null | undefined>) => !resumeQuery.trim() || parts.some(value => String(value ?? '').toLowerCase().includes(resumeQuery.trim().toLowerCase()))
  const uploadFiles = async (files: File[]) => {
    if (!snapshot || !api?.attach || !files.length) return
    const id = snapshot.thread.id
    await action(async () => {
      for (const file of files.slice(0, Math.max(0, 8 - attachments.length))) {
        if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) throw Error(`${file.name} is not a supported image`)
        const attachment = await api.attach!(id, { name: file.name, mimeType: file.type as import('../../../shared/types/thread').ThreadAttachment['mimeType'], data: await file.arrayBuffer() })
        useThreadStore.getState().addAttachment(id, attachment)
      }
    })
  }
  const removeAttachment = async (attachmentId: string) => {
    if (!snapshot || !api?.removeAttachment) return
    const id = snapshot.thread.id
    await action(async () => { await api.removeAttachment!(id, attachmentId); useThreadStore.getState().removeAttachment(id, attachmentId) })
  }
  const send = (mode: 'queue' | 'steer' = 'queue') => {
    if (!snapshot || pending || actionInFlight.current || (!draft.trim() && !attachments.length)) return
    const command = draft.trim().match(/^\/([\w:-]+)/)?.[1]
    if (command && hasDesktopCommand(snapshot.thread.provider, command) && api?.command) { void action(() => runCommand(draft)); return }
    if (commands.executeLocal(draft)) return
    if (snapshot.thread.cliActive) { setError('The native CLI owns this conversation. Recover it before sending a message.'); return }
    const text = draft, id = snapshot.thread.id
    const attachmentIds = attachments.map(value => value.id)
    const message = text || 'Please inspect the attached image.'
    if (/^\s*\//.test(text)) {
      void action(async () => { if (mode === 'steer') await api!.steer!(id, message, attachmentIds); else await api!.send(id, message, attachmentIds); if (useThreadStore.getState().drafts[id] === text) useThreadStore.getState().setDraft(id, ''); useThreadStore.getState().clearAttachments(id); scrollEnd() })
      return
    }
    setOutgoing({ threadId: id, text: message, attachments, knownEvents: new Set(snapshot.events.map(event => event.type === 'message' ? event.id : '')) })
    useThreadStore.getState().setDraft(id, '')
    useThreadStore.getState().clearAttachments(id)
    requestAnimationFrame(scrollEnd)
    void action(() => mode === 'steer' ? api!.steer!(id, message, attachmentIds) : api!.send(id, message, attachmentIds), sent => {
      if (!sent) {
        const store = useThreadStore.getState()
        if (!store.drafts[id]) store.setDraft(id, text)
        for (const attachment of attachments) store.addAttachment(id, attachment)
      }
      setOutgoing(null)
      if (sent) requestAnimationFrame(scrollEnd)
    })
  }
  const composerState = deriveThreadComposerState(snapshot?.thread, pending)
  const returnFromCli = async () => {
    if (!snapshot) return
    if (api?.recover) await api.recover(snapshot.thread.id)
    else await api!.cli!.stop(snapshot.thread.id)
    await useThreadStore.getState().refresh(snapshot.thread.id)
    await useAccountStore.getState().read(context)
    initialized.current = false
  }
  return <div ref={workbench} className={`thread-workbench${drawer ? ' is-drawer' : ''}${active ? ' is-active-cell' : ''}`} onPointerDown={onActivate} onKeyDown={event => { if (event.key === 'Escape' && review?.panel && !panel && !commands.open && !openControl) { event.preventDefault(); closeReview() } }}>
    <section className="thread-view" aria-label="Conversation" style={{ '--thread-reader-font-size': `${threadFontSize}px` } as React.CSSProperties}>
    <header className="thread-heading"><div className="thread-heading-identity"><h1>{snapshot?.thread.title ?? 'Project conversations'}</h1><span className="thread-heading-context" title={snapshot?.thread.rootPath ?? workspace?.rootPath}>{workspace?.name ?? 'Your projects'}{branch?.branch && <><GitBranch size={12} />{branch.branch}</>}</span>
      {snapshot && <ThreadConversationActions thread={snapshot.thread} disabled={pending} onCommand={command => void action(async () => { setPanel(null); await runCommand(command) })}
        onExport={api?.exportPortable ? () => void action(async () => { const path = await api.exportPortable!(snapshot.thread.id); if (path) setPanel({ kind: 'panel', title: 'Conversation exported', text: path }) }) : undefined}
        onImport={api?.importPortable ? () => { setPending(true); setError(''); void api.importPortable!(snapshot.thread.id).then(imported => { if (imported) useThreadStore.getState().adopt(imported) }).catch(cause => setError(cause instanceof Error ? cause.message : 'Could not import conversation.')).finally(() => setPending(false)) } : undefined} />}</div>
      <div className="thread-heading-actions">
      {snapshot && <button type="button" className="thread-icon-action" aria-label="Background activity" title="Local jobs and delegated work" aria-pressed={review?.panel === 'background'} onClick={() => useThreadWorkbenchStore.getState().setView(snapshot.thread.id, { panel: review?.panel === 'background' ? null : 'background' })}><Activity size={15} /></button>}
      <Popover.Root><Popover.Trigger asChild><button type="button" className="thread-icon-action" aria-label="Thread text size" title="Thread text size"><Type size={15} /></button></Popover.Trigger>
        <Popover.Portal><Popover.Content className="thread-font-popover" side="bottom" align="end" sideOffset={8}>
          <strong>Conversation text</strong><span>Adjust reading size</span>
          <div className="thread-font-controls"><button type="button" aria-label="Decrease thread text size" disabled={threadFontSize <= THREAD_FONT_MIN} onClick={() => setThreadFontSize(threadFontSize - 1)}><Minus size={14} /></button><output aria-label="Thread text size">{threadFontSize}px</output><button type="button" aria-label="Increase thread text size" disabled={threadFontSize >= THREAD_FONT_MAX} onClick={() => setThreadFontSize(threadFontSize + 1)}><Plus size={14} /></button></div>
          <button type="button" className="thread-font-reset" disabled={threadFontSize === THREAD_FONT_DEFAULT} onClick={() => setThreadFontSize(THREAD_FONT_DEFAULT)}>Reset to default</button>
          <Popover.Arrow className="thread-font-arrow" /></Popover.Content></Popover.Portal></Popover.Root>
      {snapshot && <button type="button" className="thread-review-trigger" aria-label="Open thread review" title="Review conversation changes" aria-expanded={Boolean(review?.panel)} onClick={() => useThreadWorkbenchStore.getState().setView(snapshot.thread.id, { panel: review?.panel ? null : "changes" })}><GitBranch size={14} /><span>Review</span></button>}
      {snapshot && <button type="button" className="thread-review-trigger" aria-label="Delegate work" title="Delegate to a persistent worktree Thread" disabled={pending || running} onClick={() => setDelegationOpen(true)}><Waypoints size={14} /><span>Delegate</span></button>}
      {onDelegations && <button type="button" className="thread-review-trigger" aria-label="Delegated work" title="Open saved delegated work" onClick={onDelegations}><ListTodo size={14} /><span>Delegated work</span></button>}
      {snapshot && <button type="button" className="thread-icon-action" aria-label={snapshot.thread.pinned ? 'Unpin thread' : 'Pin thread'} title={snapshot.thread.pinned ? 'Unpin thread' : 'Pin thread'} disabled={pending} onClick={() => void action(() => api!.pin(snapshot.thread.id, !snapshot.thread.pinned))}><Pin size={15} /></button>}
      {onCloseCell && <button type="button" className="thread-icon-action" aria-label="Close side-by-side conversation" title="Close side-by-side conversation" onClick={onCloseCell}><X size={15} /></button>}
      </div>
    </header>
    <div ref={timeline} className="thread-timeline" tabIndex={0} aria-label="Conversation history" onWheel={event => cancelScrollRestore(event.deltaY < 0 ? 'up' : 'down')} onTouchStart={() => cancelScrollRestore()} onTouchMove={() => cancelScrollRestore()} onPointerDown={() => cancelScrollRestore()} onPointerMove={event => { if (event.buttons) cancelScrollRestore() }} onKeyDown={event => cancelScrollRestore(['Home', 'PageUp', 'ArrowUp'].includes(event.key) ? 'up' : ['End', 'PageDown', 'ArrowDown'].includes(event.key) ? 'down' : undefined)} onScroll={e => {
      const el = e.currentTarget; if (!el.clientHeight || !snapshot) return
      updateTimelineViewport.current?.()
      if (restoreTop.current !== null) return
      if (el.scrollTop <= 32 && snapshot.page?.hasMore && !loadingEarlier) void loadEarlier()
      const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight <= 64
      if (following.current && !atEnd && !userScrollIntent.current) {
        requestAnimationFrame(() => { if (following.current && timeline.current === el) el.scrollTop = el.scrollHeight })
        return
      }
      // Measurements can shrink a long timeline until the browser clamps its
      // scrollTop near the end. That is not an intentional return to the end.
      following.current = atEnd && !(lastScrollDirection.current === 'up' && !following.current)
      if (following.current) lastScrollDirection.current = null
      setShowEnd(!following.current); if (following.current) setNewMessages(0)
      useThreadStore.getState().setScroll(snapshot.thread.id, el.scrollTop, following.current)
    }}>
      <div ref={content} className="thread-reading-column">
        {snapshot?.page?.hasMore && <button type="button" className="thread-load-earlier" disabled={loadingEarlier} onClick={() => void loadEarlier()}>{loadingEarlier ? <Loader2 size={13} className="thread-spin" /> : <ArrowUp size={13} />}Load earlier messages</button>}
        {!snapshot && <div className="thread-welcome"><span className="thread-welcome-mark"><MessageSquarePlus size={26} strokeWidth={1.5} /></span><h2>{selectedId ? 'Opening conversation…' : 'What would you like to work on?'}</h2><p>{selectedId ? 'Loading the selected conversation.' : 'Select + beside a project to start a conversation, or add a project in the sidebar.'}</p></div>}
        <ThreadTimelineWindow key={snapshot?.thread.id ?? 'empty'} rows={timelineRows} scrollRef={timeline} followingRef={following} onViewportUpdateRef={updateTimelineViewport}>{({ event, key, turnId, turnEvents, firstInTurn, lastInTurn }) => <section className={`thread-turn thread-virtual-turn${firstInTurn ? ' is-turn-start' : ''}${lastInTurn ? ' is-turn-end' : ''}`} data-turn-id={turnId}>{(() => {
          if (event.type === 'activity-group') return <ThreadActivityGroup key={key} events={event.events} onDiagnostics={() => snapshot && useThreadWorkbenchStore.getState().setView(snapshot.thread.id, { panel: 'diagnostics' })} />
          if (event.type === 'plan') return <ThreadPlan key={key} event={event} />
          if (event.type === 'subagent') return <ThreadSubagentActivity key={key} event={event} compact />
          if (event.type === 'tool' && event.files?.length) return <ThreadFileActivity key={key} event={event} root={snapshot?.thread.rootPath ?? ''} threadId={snapshot!.thread.id} onOpen={openFile} />
          if (event.type === 'message') {
            if (event.role === 'assistant' && authText(event.text)) return null
            const displayText = event.role === 'user' && event.id.startsWith('native:') ? formatNativeUserText(event.text) : event.text
            if (!displayText) return null
            const final = event.role === 'assistant' && threadTurnPresentation(turnEvents).finalMessageId === event.id
            return <article key={key} className={`thread-message thread-message-${event.role}${final ? ' is-final-response' : ''}`}>
              {event.role === 'assistant' && (final || turnEvents.find(value => value.type === 'message' && value.role === 'assistant') === event) && <div className="thread-agent-label"><AgentProviderIcon provider={snapshot?.thread.provider ?? 'claude'} size={16} />{snapshot?.thread.provider === 'claude' ? 'Claude' : 'Codex'}{final && <span className="thread-final-label">Final response</span>}</div>}
              <ThreadMessageBody text={displayText} role={event.role} />
              {event.role === 'assistant' && event.id === lastConversationMessage?.id && quickReplies.length > 0 && <div className="thread-quick-replies" aria-label="Suggested replies"><small>Choose a reply to review before sending</small><div>{quickReplies.map(option => <button type="button" key={option.value} onClick={() => { useThreadStore.getState().setDraft(snapshot!.thread.id, option.value); requestAnimationFrame(() => textarea.current?.focus()) }}>{option.label}</button>)}</div></div>}
              {event.attachments?.length ? <div className="thread-message-attachments" aria-label="Message attachments">{event.attachments.map(attachment => <span key={attachment.id}><Paperclip size={11} />{attachment.name}<small>{Math.ceil(attachment.bytes / 1024)} KB</small></span>)}</div> : null}
              <div className="thread-message-actions">
                <button type="button" aria-label={copiedMessageId === event.id ? 'Message copied' : final ? 'Copy final response' : event.role === 'assistant' ? 'Copy response' : 'Copy message'} title={copiedMessageId === event.id ? 'Copied' : final ? 'Copy final response' : event.role === 'assistant' ? 'Copy response' : 'Copy message'} onClick={() => void copyMessage(event.id, displayText)}>{copiedMessageId === event.id ? <Check size={13} /> : <Copy size={13} />}{final && <span>{copiedMessageId === event.id ? 'Copied' : 'Copy'}</span>}</button>
                {event.role === 'user' && snapshot?.thread.provider === 'codex' && !running && <button type="button" aria-label="Edit and retry this message" title="Edit and retry" onClick={() => {
                  const index = turns.findIndex(turn => turn.id === event.id)
                  setEditingTurn({ id: event.id, text: event.text, rewind: Math.max(1, turns.length - Math.max(0, index)) })
                }}><Pencil size={13} /></button>}
              </div>
            </article>
          }
          if (event.type === 'tool') return <details key={key} className="thread-tool"><summary><ChevronDown size={12} />{event.state === 'running' ? <Loader2 size={12} className="thread-spin" /> : event.state === 'failed' ? <AlertCircle size={12} /> : <Check size={12} />}{event.name}<small>{event.state}</small></summary>{event.detail && <pre>{event.detail}</pre>}</details>
          if (event.type === 'request') return <ThreadRequestCard key={key} request={event.request} turnResult={turnEvents.find((value): value is Extract<ThreadEvent, { type: 'completed' }> => value.type === 'completed')?.status} disabled={pending} onRespond={response => action(() => api!.respond!(snapshot!.thread.id, event.id, response))} />
          if (event.type === 'approval') {
            if (snapshot?.events.some(value => value.type === 'request' && value.id === event.id)) return null
            const unresolved = snapshot?.thread.status === 'approval' && !snapshot.events.some(e => e.type === 'approval-resolved' && e.id === event.id)
            return <details key={key} className="thread-approval" open={Boolean(unresolved)}><summary><AlertCircle size={13} />{event.title}</summary><ThreadApprovalDetails command={event.detail} fileChanges={event.title === 'Approve file changes'} />{unresolved && <div className="thread-approval-actions"><button type="button" disabled={pending} onClick={() => void action(() => api!.approve(snapshot!.thread.id, event.id, 'accept'))}>Approve</button><button type="button" disabled={pending} onClick={() => void action(() => api!.approve(snapshot!.thread.id, event.id, 'decline'))}>Decline</button></div>}</details>
          }
          if (event.type === 'completed') return event.status === 'failed' ? <ThreadFailureCard key={key} event={event} latest={event === lastResult} onAccounts={onAccounts} disabled={pending} onRetry={(() => { const prompt = turnEvents.find(value => value.type === 'message' && value.role === 'user'); return prompt?.type === 'message' ? () => void action(() => api!.send(snapshot!.thread.id, prompt.text, prompt.attachments?.map(attachment => attachment.id) ?? [])) : undefined })()} refreshUsage={snapshot?.thread.provider === 'codex' && api?.command ? async () => {
            const result = await api.command!(snapshot.thread.id, '/usage')
            if (!result.usage) throw Error('Usage unavailable')
            return result.usage
          } : undefined} /> : event.status === 'interrupted' ? <p key={key} className="thread-turn-status"><AlertCircle size={13} />{event.error || 'Interrupted'}</p> : null
          return null
        })()}{lastInTurn && turnEvents.some(value => value.type === 'completed') && <ThreadTurnChanges events={turnEvents} root={snapshot?.thread.rootPath ?? ''} onOpen={openFile} />}{lastInTurn && turnEvents.some(value => value.type === 'completed') && <ThreadTurnTiming turn={snapshot?.turns?.find(value => value.id === turnId)} events={turnEvents} />}</section>}</ThreadTimelineWindow>
        {pendingMessage && <article className="thread-message thread-message-user thread-message-outgoing" aria-label="Sending message"><ThreadMessageBody text={pendingMessage.text} role="user" />{pendingMessage.attachments.length > 0 && <div className="thread-message-attachments" aria-label="Message attachments">{pendingMessage.attachments.map(attachment => <span key={attachment.id}><Paperclip size={11} />{attachment.name}<small>{Math.ceil(attachment.bytes / 1024)} KB</small></span>)}</div>}<small className="thread-message-outgoing-status">Sending…</small></article>}
        {running && snapshot && <ThreadLiveActivity snapshot={snapshot} onDiagnostics={() => useThreadWorkbenchStore.getState().setView(snapshot.thread.id, { panel: 'diagnostics' })} />}
      </div>
    </div>
    <div className="thread-composer-dock"><div className="thread-composer-column">
      {showEnd && <button type="button" className="thread-scroll-end" onClick={scrollEnd}><ArrowDown size={12} />Latest messages{newMessages > 0 ? ` · ${newMessages}` : ''}</button>}
      {snapshot && <div className={`thread-connection-notice${needsLogin ? '' : ' is-connected'}`}>{needsLogin ? <><AlertCircle size={14} /><span>{authFailure ? `Sign in to ${snapshot.thread.provider === 'claude' ? 'Claude Code' : 'Codex'}` : accountMessage(account)}</span><button type="button" onClick={onAccounts}>{authFailure ? 'Reconnect' : 'Connect'}</button>{authFailure && lastPrompt?.type === 'message' && <button type="button" title="Resend after connecting" disabled={pending || account?.state !== 'connected' || account.method !== 'subscription'} onClick={() => void action(() => api!.send(snapshot.thread.id, lastPrompt.text, lastPrompt.attachments?.map(attachment => attachment.id) ?? []))}>Retry</button>}</> : <><Check size={14} /><span>{account ? `${snapshot.thread.provider === 'claude' ? 'Claude Code' : 'Codex'} connected` : 'Checking agent connection…'}</span></>}</div>}
      {degradedConnection && !needsLogin && <div className="thread-connection-notice is-warning" role="status"><AlertCircle size={14} /><span>{degradedConnection.detail || 'Provider connection is unavailable.'}{degradedConnection.nextRetryAt ? ` You can retry after ${new Date(degradedConnection.nextRetryAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}.` : ''}</span></div>}
      {snapshot && blocksThreadInput(snapshot.thread) && <div className="thread-connection-notice"><TerminalSquare size={14} /><span>Recover the saved conversation to continue here.</span><button type="button" disabled={pending} onClick={() => void action(returnFromCli)}>Recover conversation</button></div>}
      {snapshot?.thread.cliNotice === PARTIAL_NATIVE_HISTORY_NOTICE && <div className="thread-connection-notice is-connected" role="status"><TerminalSquare size={14} /><span>{snapshot.thread.cliNotice} You can continue this conversation here.</span></div>}
      {(error || !api) && <div role="alert" className="thread-action-error"><span>{error || 'Thread service unavailable. Restart the updated application.'}</span><button type="button" aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}
      {snapshot?.thread.queue && <ThreadPromptQueue items={snapshot.thread.queue} disabled={pending} onUpdate={(itemId, text) => action(() => api!.updateQueued!(snapshot.thread.id, itemId, text))} onDelete={itemId => action(() => api!.deleteQueued!(snapshot.thread.id, itemId))} onRestore={item => action(async () => {
        await api!.deleteQueued!(snapshot.thread.id, item.id, true)
        useThreadStore.getState().setDraft(snapshot.thread.id, item.text)
        useThreadStore.getState().clearAttachments(snapshot.thread.id)
        for (const attachment of item.attachments ?? []) useThreadStore.getState().addAttachment(snapshot.thread.id, attachment)
        if (item.configuration && api?.configure) useThreadStore.getState().updateSnapshot(await api.configure(snapshot.thread.id, item.configuration, snapshot.thread.configurationRevision ?? 0))
        requestAnimationFrame(() => textarea.current?.focus())
      })} onReorder={itemIds => action(() => api!.reorderQueued!(snapshot.thread.id, itemIds))} />}
      <form className="thread-composer" data-state={composerState} aria-busy={pending} onSubmit={e => { e.preventDefault(); send() }} onDragOver={event => { if ([...event.dataTransfer.items].some(item => item.kind === 'file')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }} onDrop={event => { const files = [...event.dataTransfer.files].filter(file => file.type.startsWith('image/')); if (files.length) { event.preventDefault(); void uploadFiles(files) } }}>
        <VoiceHud status={voice.status} error={voice.error} level={voice.level} modelProgress={voice.modelProgress} onDismiss={voice.dismiss} containerSelector=".thread-view" focusSelector="textarea[data-thread-composer='true']" />
        {commands.popup}
        {attachments.length > 0 && <div className="thread-attachments" aria-label="Attachments">{attachments.map(attachment => <div key={attachment.id}><span>{attachment.name}</span><small>{Math.ceil(attachment.bytes / 1024)} KB</small><button type="button" aria-label={`Remove ${attachment.name}`} disabled={pending} onClick={() => void removeAttachment(attachment.id)}><X size={12} /></button></div>)}</div>}
        <input ref={fileInput} type="file" hidden multiple accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => { void uploadFiles(Array.from(event.target.files ?? [])); event.target.value = '' }} />
        <textarea ref={textarea} data-thread-composer="true" aria-label={active ? 'Message' : `Message in ${snapshot?.thread.title ?? 'conversation'}`} {...commands.inputProps} placeholder={snapshot ? 'Ask about your project, or / for commands…' : 'Create a thread to get started…'} value={draft} disabled={!snapshot || pending || Boolean(snapshot.thread.cliActive)}
          onChange={e => commands.onChange(e.target.value, e.target.selectionStart)} onSelect={e => commands.onSelect(e.currentTarget.selectionStart)} onFocus={commands.onFocus} onBlur={commands.onBlur}
          onPaste={event => { const files = [...event.clipboardData.files].filter(file => file.type.startsWith('image/')); if (files.length) { event.preventDefault(); void uploadFiles(files) } }}
          onKeyDown={e => { if (commands.onKeyDown(e)) return; if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() } }} />
        <footer><button type="button" className="thread-command-trigger" aria-label="Show thread commands" title="Commands & skills · Ctrl+/" aria-haspopup="listbox" aria-expanded={commands.open} disabled={!snapshot || pending || Boolean(snapshot.thread.cliActive)} onMouseDown={e => e.preventDefault()} onClick={commands.show}><Slash size={14} /></button>
          <button type="button" className="thread-command-trigger" aria-label="Attach image" title="Attach image" disabled={!snapshot || pending || attachments.length >= 8 || !api?.attach} onClick={() => fileInput.current?.click()}><Paperclip size={14} /></button>
          <button type="button" className="thread-command-trigger" aria-label="Voice input" title="Voice input · Ctrl+Shift+V" disabled={!snapshot || pending || !voice.isSupported} onClick={voice.toggle}><Mic size={14} /></button>
          {snapshot && <ThreadConfigurationBar key={snapshot.thread.id} thread={snapshot.thread} openControl={openControl} onControlClosed={() => setOpenControl(null)} onError={setError} onConfigured={value => useThreadStore.getState().updateSnapshot(value)} />}
          {running && snapshot?.thread.capabilities?.features.steering?.enabled && <button type="button" className="thread-command-trigger" aria-label="Steer active turn" title="Send guidance to the active turn" disabled={pending || (!draft.trim() && !attachments.length)} onClick={() => send('steer')}><CornerDownLeft size={14} /></button>}
          {running && <button type="button" className="thread-stop" aria-label="Stop turn" title="Stop turn" disabled={pending} onClick={() => void action(() => api!.interrupt(snapshot!.thread.id))}><Square size={13} /></button>}
          <button type="submit" className="thread-send" aria-label={running ? 'Queue follow-up' : 'Send'} title={running ? 'Queue follow-up · Enter' : 'Send · Enter'} disabled={!snapshot || (!draft.trim() && !attachments.length) || pending || Boolean(snapshot.thread.cliActive)}><ArrowUp size={16} /></button></footer>
      </form>
    </div></div>
    {panel && <DesktopDialog className={`thread-command-dialog desktop-details-dialog${panel.surface === 'sessions' ? ' thread-resume-dialog' : ''}`} title={panel.surface === 'sessions' ? 'Resume work' : panel.title || 'Conversation'} description={panel.surface === 'sessions' ? 'Choose a saved conversation or provider session in this project.' : 'Manage this conversation without leaving Thread.'} onClose={() => { setPanel(null); requestAnimationFrame(() => textarea.current?.focus()) }}>
      {error && <p role="alert">{error}</p>}
      {panel.surface === 'rename' ? <form onSubmit={event => { event.preventDefault(); void action(async () => { await runCommand(`/rename ${rename}`); setPanel(null) }) }}><label>Conversation name<input aria-label="Conversation name" value={rename} maxLength={120} onChange={event => setRename(event.target.value)} /></label><button type="submit" disabled={pending || !rename.trim()}>Rename conversation</button></form>
      : panel.surface === 'sessions' ? <div className="thread-resume-sections">
        <label className="thread-resume-search">Find a session<input aria-label="Find a session" type="search" placeholder="Search prompt, model, branch, date or ID" value={resumeQuery} onChange={event => setResumeQuery(event.target.value)} /></label>
        <section><h3>Saved conversations</h3><p>The current conversation is already open. Send a message to continue its native session.</p>
          <div className="thread-panel-list">{useThreadStore.getState().threads.filter(thread => thread.id !== snapshot?.thread.id && thread.provider === snapshot?.thread.provider && thread.rootPath === snapshot?.thread.rootPath && resumeMatches([thread.title, thread.nativeSessionId, thread.id, thread.status])).map(thread => <button key={thread.id} type="button" disabled={pending} onClick={() => void action(() => runCommand(`/resume ${thread.id}`))}><strong>{thread.title}</strong><span>{thread.nativeSessionId ? `Session ${thread.nativeSessionId}` : 'Not started'} · {thread.archived ? 'Archived' : thread.status}</span></button>)}
            {!useThreadStore.getState().threads.some(thread => thread.id !== snapshot?.thread.id && thread.provider === snapshot?.thread.provider && thread.rootPath === snapshot?.thread.rootPath && resumeMatches([thread.title, thread.nativeSessionId, thread.id, thread.status])) && <p>{resumeQuery ? 'No saved conversations match this search.' : 'No other saved conversation for this provider and directory.'}</p>}
          </div>
        </section>
        <section><h3>Delegated sessions</h3>{resumeNotice && <p role="status">{resumeNotice}</p>}
          <div className="thread-panel-list">{resumeTasks.filter(task => resumeMatches([task.objective, task.branch, task.state, task.id, task.nativeSession?.nativeSessionId])).map(task => <button key={task.id} type="button" disabled={pending || !task.destinationThreadId} onClick={() => void action(() => openDelegatedSession(task))}><strong>{task.objective}</strong><span>{task.branch} · {task.state} · {task.nativeSession?.provider ?? task.agentProfileId}</span><span>{task.nativeSession?.nativeSessionId ? `Session ${task.nativeSession.nativeSessionId}` : 'No native session ID yet'}</span></button>)}
            {!resumeTasks.some(task => resumeMatches([task.objective, task.branch, task.state, task.id, task.nativeSession?.nativeSessionId])) && <p>{resumeQuery ? 'No delegated sessions match this search.' : 'No delegated session in this workspace.'}</p>}
          </div>
          {onDelegations && <button type="button" className="thread-resume-all" onClick={() => { setPanel(null); onDelegations() }}>Open all delegated work</button>}
        </section>
        <section><h3>{snapshot?.thread.provider === 'codex' ? 'Codex' : 'Claude'} sessions in this directory</h3><p>Terminal PTY, pane and workspace IDs are not provider conversation IDs. Choose a native session by its start time and model.</p>
          {nativeResumeNotice && <p role="status">{nativeResumeNotice}</p>}
          <div className="thread-panel-list thread-native-session-list">{nativeSessions.filter(session => resumeMatches([session.firstMessagePreview, session.modelId, session.sessionId, new Date(session.sessionStartedAtMs).toLocaleString(), new Date(session.lastUpdatedMs).toLocaleString()])).map(session => <button key={session.sessionId} type="button" disabled={pending} onClick={() => void action(() => runCommand(`/resume ${session.sessionId}`))}><strong>{session.firstMessagePreview || `${session.provider === 'codex' ? 'Codex' : 'Claude'} session`}</strong><span className="thread-session-meta"><span>Updated {sessionDate(session.lastUpdatedMs)}</span><span>{session.modelId || 'Model unknown'}</span>{session.requestCount > 0 && <span>{session.requestCount} requests</span>}</span><span className="thread-session-foot"><span>Started {sessionDate(session.sessionStartedAtMs)}</span><code>{session.sessionId}</code></span></button>)}
            {!nativeSessions.some(session => resumeMatches([session.firstMessagePreview, session.modelId, session.sessionId, new Date(session.sessionStartedAtMs).toLocaleString(), new Date(session.lastUpdatedMs).toLocaleString()])) && !nativeResumeNotice && <p>{resumeQuery ? 'No native sessions match this search.' : 'No native sessions found for this provider and directory.'}</p>}
          </div>
        </section>
        <section><h3>Open an exact native session</h3><p>Use a Claude or Codex session ID from this directory. OXESpace verifies its provider and path before linking it.</p>
          <form onSubmit={event => { event.preventDefault(); void action(() => runCommand(`/resume ${nativeResumeId.trim()}`)) }}><label className="thread-resume-native-label">Native session ID<input aria-label="Native session ID" value={nativeResumeId} onChange={event => setNativeResumeId(event.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" /></label><button type="submit" disabled={pending || !nativeResumeId.trim()}>Open session</button></form>
        </section>
      </div>
      : panel.surface === 'delegations' ? <div className="thread-panel-list">{panel.rows?.length ? panel.rows.map((row, index) => <button key={index} type="button" disabled={pending || !row.id} onClick={() => { if (row.id) { setPanel(null); void useThreadStore.getState().select(row.id) } }}><strong>{row.label}</strong>{row.detail && <span>{row.detail}</span>}</button>) : <p>No delegated work in this project.</p>}</div>
      : <>{panel.text !== undefined && <><pre>{panel.text || 'No content available.'}</pre>{panel.externalUrl && <button type="button" onClick={() => window.open(panel.externalUrl, '_blank', 'noopener,noreferrer')}>Open in browser</button>}{panel.text && !panel.externalUrl && <button type="button" onClick={() => void navigator.clipboard.writeText(panel.text!).catch(() => setError('Could not copy text.'))}>Copy text</button>}</>}
        {panel.usage ? <ThreadUsageDetails usage={panel.usage} /> : panel.title === 'Conversation status' && panel.rows ? <div className="thread-status-summary">
          <p className="terminal-session-identity-note">The native session ID resumes the Codex or Claude conversation. Thread, project and workspace IDs belong to OXESpace.</p>
          <DetailList rows={['Provider', 'Native session ID (resume)', 'Status', 'Model', 'Effort', 'Access', 'Network', 'Approvals', 'Mode', 'Connection', 'Directory'].flatMap(label => panel.rows!.filter(row => row.label === label))} />
          <details className="terminal-technical-details"><summary>Internal OXESpace IDs and runtime</summary><DetailList rows={['Thread ID', 'Project ID', 'Workspace ID', 'Generation', 'Operation', 'Hooks'].flatMap(label => panel.rows!.filter(row => row.label === label))} /></details>
        </div> : panel.rows && (panel.rows.length && panel.rows.every(row => !row.id) ? <DetailList rows={panel.rows} /> : <div className="thread-panel-list">{panel.rows.length ? panel.rows.map((row, index) => row.id ? <button type="button" key={index} disabled={pending} onClick={() => void action(async () => { setPanel(null); await runCommand(row.id!) })}><strong>{row.label}</strong>{row.detail && <span>{row.detail}</span>}</button> : <div key={index}><strong>{row.label}</strong><span>{row.detail}</span></div>) : <p>No items returned by the provider.</p>}</div>)}</>}
    </DesktopDialog>}
    {delegationOpen && snapshot && <DelegationCreateDialog thread={snapshot.thread} onClose={() => setDelegationOpen(false)} />}
    {editingTurn && <DesktopDialog className="thread-create-dialog thread-edit-retry-dialog" title="Edit and retry" description="Rewind the native conversation to this message and place its text back in the composer." onClose={() => setEditingTurn(null)}>
      <p>Conversation history after this point will be removed. Project files are not reverted, so existing edits remain on disk.</p>
      <footer><button type="button" onClick={() => setEditingTurn(null)}>Cancel</button><button type="button" className="thread-primary" disabled={pending} onClick={() => void action(async () => {
        const value = editingTurn
        await runCommand(`/rewind ${value.rewind}`)
        if (snapshot) {
          useThreadStore.getState().setDraft(snapshot.thread.id, value.text)
          useThreadStore.getState().clearAttachments(snapshot.thread.id)
        }
        setEditingTurn(null)
        requestAnimationFrame(() => textarea.current?.focus())
      })}>Rewind and edit</button></footer>
    </DesktopDialog>}
  </section>
    {snapshot && review?.panel && drawer ? <Dialog.Root open onOpenChange={open => { if (!open) closeReview() }}><Dialog.Portal container={workbench.current}>
      <Dialog.Overlay className="thread-review-scrim" />
      <Dialog.Content className="thread-review-host" aria-describedby={undefined} style={{ width: Math.min(reviewWidth, Math.max(280, availableWidth - 16)) }} onCloseAutoFocus={event => { event.preventDefault(); textarea.current?.focus() }}>
        <Dialog.Title className="thread-review-accessible-title">Conversation review</Dialog.Title>
        <ThreadChangesPanel key={snapshot.thread.id} snapshot={snapshot} workspace={workspace} panel={review.panel} selection={review.selection} onClose={closeReview} onComment={addReviewComment} onSendToConversation={appendToConversation} />
      </Dialog.Content>
    </Dialog.Portal></Dialog.Root> : snapshot && review?.panel && <>
      {!drawer && <div className="thread-review-resize" role="separator" aria-label="Resize review panel" aria-orientation="vertical" tabIndex={0} aria-valuemin={320} aria-valuemax={Math.min(720, availableWidth - 480)} aria-valuenow={Math.min(reviewWidth, Math.max(320, availableWidth - 480))}
        onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); useThreadWorkbenchStore.getState().setWidth(Math.min(availableWidth - 480, reviewWidth + (event.key === 'ArrowLeft' ? 24 : -24))) } }}
        onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId) }}
        onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId) && workbench.current) useThreadWorkbenchStore.getState().setWidth(Math.min(availableWidth - 480, workbench.current.getBoundingClientRect().right - event.clientX)) }}
        onPointerUp={event => event.currentTarget.releasePointerCapture(event.pointerId)} />}
      <div className="thread-review-host" style={{ width: drawer ? Math.min(reviewWidth, Math.max(280, availableWidth - 16)) : Math.min(reviewWidth, Math.max(320, Math.min(availableWidth * .48, availableWidth - 640))) }}>
        <ThreadChangesPanel key={snapshot.thread.id} snapshot={snapshot} workspace={workspace} panel={review.panel} selection={review.selection} onClose={closeReview} onComment={addReviewComment} onSendToConversation={appendToConversation} />
      </div>
    </>}
  </div>
}

function ThreadTurnTiming({ turn, events }: { turn?: import('../../../shared/types/thread').ThreadTurn; events: ThreadEvent[] }) {
  const seconds = turn?.startedAt && turn.completedAt ? Math.max(0, Math.round((turn.completedAt - turn.startedAt) / 1000)) : undefined
  const summary = threadTurnPresentation(events)
  const status = [...events].reverse().find((event): event is Extract<ThreadEvent, { type: 'completed' }> => event.type === 'completed')?.status ?? turn?.status ?? 'interrupted'
  return <div className={`thread-turn-timing is-${status}`}><span className="thread-turn-outcome">{status === 'completed' ? <Check size={12} /> : <AlertCircle size={12} />}{status === 'completed' ? 'Completed' : status === 'failed' ? 'Failed' : 'Interrupted'}</span>{summary.actionCount > 0 && <span>{summary.actionCount} {summary.actionCount === 1 ? 'action' : 'actions'}{summary.failedActions > 0 ? ` · ${summary.failedActions} failed` : ''}{summary.unconfirmedActions > 0 ? ` · ${summary.unconfirmedActions} unconfirmed` : ''}</span>}{seconds !== undefined && <span>{seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`}</span>}{turn?.configuration.model && <span>{turn.configuration.model}{turn.configuration.reasoningEffort ? ` · ${turn.configuration.reasoningEffort}` : ''}</span>}</div>
}
