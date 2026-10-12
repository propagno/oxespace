import { AgentProviderIcon } from '../Sidebar/AgentProviderIcon'
import { ThreadHistoricalQuestions } from './ThreadHistoricalQuestions'
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Activity, AlertCircle, FileText, ArrowDown, ArrowUp, Check, ChevronDown, Copy, CornerDownLeft, GitBranch, Plug, Loader2, MessageSquarePlus, Mic, Minus, PanelRight, Paperclip, Pencil, Pin, Plus, Slash, Square, TerminalSquare, Type, Waypoints, X, GitCompareArrows, Globe, MoreHorizontal, AtSign, Image as ImageIcon } from 'lucide-react'
import { ThreadMarkdown } from './ThreadMarkdown'
import { formatNativeUserText } from '../../../shared/native-session-text'
import { blocksThreadInput } from '../../../shared/threadHistoryNotice'
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
import { useFileMentions } from './useFileMentions'
import { ThreadUsageRing } from './ThreadUsageRing'
import { PrStatusBar } from '../GitHub/PrStatusBar'
import { ThreadLiveActivity } from './ThreadLiveActivity'
import { threadQuickReplies } from './threadQuickReplies'
import { buildThreadTimeline, flattenThreadTimeline } from './threadTimelineModel'
import { THREAD_VIEW_MODES, THREAD_VIEW_MODE_HINT, THREAD_VIEW_MODE_LABEL, useThreadViewModeStore, type ThreadViewMode } from '../../store/thread-view-mode.store'
import { threadTurnPresentation } from './threadTurnPresentation'
import { ThreadTimelineWindow } from './ThreadTimeline'
import { deriveThreadComposerState } from './threadComposerState'
import { hasDesktopCommand } from '../../../shared/threadDesktopCommands'
import { useUIStore } from '../../store/ui.store'
import { useThreadWorkbenchStore, type ThreadPanel } from '../../store/thread-workbench.store'
import { ThreadFileActivity, ThreadTurnChanges } from './ThreadFileActivity'
import { ThreadChangesPanel } from './ThreadChangesPanel'
import { ThreadPlan } from './ThreadPlan'
import { ThreadConversationActions } from './ThreadConversationActions'
import { ThreadRequestCard } from './ThreadRequestCard'
import { ThreadApprovalDetails } from './ThreadApprovalDetails'
import { ThreadPromptQueue } from './ThreadPromptQueue'
import { ThreadDeliveryNote } from './ThreadDeliveryNote'
import { ThreadRewindControl } from './ThreadRewindControl'
import { ThreadCostChip } from './ThreadCostChip'

const ThreadPermissionsPanel = lazy(() => import('./ThreadPermissionsPanel'))
import { ThreadSubagentActivity } from './ThreadSubagentActivity'
import { VoiceHud } from '../Voice/VoiceHud'
import { DelegationCreateDialog } from '../Delegation/DelegationCreateDialog'
import { useOxeVoice } from '../../hooks/useOxeVoice'
import { threadFileLabel, threadFileScope, type ThreadChangeEntry } from './threadChanges'
import { useEditorStore } from '../../store/editor.store'
import './ThreadWorkbench.css'
import { Dialog, DropdownMenu, Popover } from 'radix-ui'
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
  const visibleThread = useRef(selectedId)
  visibleThread.current = selectedId
  const [historyFeedback, setHistoryFeedback] = useState<{ id: string; text: string; error?: boolean } | null>(null)
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
  const openFile = (entry: ThreadChangeEntry) => {
    if (!snapshot || threadFileScope(entry.file.path, snapshot.thread.rootPath) !== 'Project') return
    void useEditorStore.getState().openFile({ workspaceId: snapshot.thread.workspaceId, rootPath: snapshot.thread.rootPath, relativePath: threadFileLabel(entry.file.path, snapshot.thread.rootPath) })
    useThreadWorkbenchStore.getState().setView(snapshot.thread.id, { panel: 'files' })
  }
  /** Header toggles: a second click closes the panel; `keepOpen` is for the menu radios. */
  const togglePanel = (panelId: ThreadPanel, keepOpen = false): void => {
    if (!snapshot) return
    const current = useThreadWorkbenchStore.getState().views[snapshot.thread.id]?.panel ?? null
    useThreadWorkbenchStore.getState().setView(snapshot.thread.id, { panel: current === panelId && !keepOpen ? null : panelId })
  }
  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent): void => {
      const key = event.key.toLowerCase()
      const inTerminal = event.target instanceof Element && Boolean(event.target.closest('.xterm'))
      if (event.ctrlKey && !event.altKey && !event.shiftKey && key === 'o' && !inTerminal) { event.preventDefault(); useThreadViewModeStore.getState().cycle() }
      else if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key === '`') { event.preventDefault(); togglePanel('terminal') }
      else if (event.ctrlKey && event.shiftKey && !event.altKey && key === 'd') { event.preventDefault(); togglePanel('changes') }
      else if (event.ctrlKey && event.shiftKey && !event.altKey && key === 'b') { event.preventDefault(); togglePanel('preview') }
      else if (event.ctrlKey && event.shiftKey && !event.altKey && key === 'm') { event.preventDefault(); setOpenControl('permissions') }
      else if (event.ctrlKey && event.shiftKey && !event.altKey && key === 'i') { event.preventDefault(); setOpenControl('model') }
      else if (event.ctrlKey && event.shiftKey && !event.altKey && key === 'e') { event.preventDefault(); setOpenControl('effort') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  const closeReview = () => { if (snapshot) useThreadWorkbenchStore.getState().setView(snapshot.thread.id, { panel: null }); requestAnimationFrame(() => textarea.current?.focus()) }
  /**
   * Restores the files of one turn from its checkpoint. The orchestrator refuses
   * when files changed afterwards, so this never overwrites later work — older
   * turns therefore fail with a conflict once newer turns touched the same files.
   */
  const undoTurnChanges = async (threadId: string, turnId: string): Promise<void> => {
    const commands = window.oxe.thread
    if (!commands?.command) throw Error('Restart the updated application to undo changes.')
    const listing = await commands.command(threadId, '/checkpoint')
    const target = listing.rows?.find(row => row.turnId === turnId && row.id?.startsWith('/checkpoint restore '))
    if (!target?.id) throw Error('No restorable checkpoint exists for this turn.')
    await commands.command(threadId, target.id)
    await useThreadStore.getState().refresh(threadId)
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
  const pendingRequests = running ? (snapshot?.pendingRequests ?? snapshot?.events.flatMap(event => event.type === 'request' && event.request.state === 'pending' ? [event.request] : []) ?? []) : []
  const viewMode = useThreadViewModeStore(state => state.mode)
  const turns = useMemo(() => buildThreadTimeline(snapshot?.events ?? [], viewMode), [snapshot?.events, viewMode])
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
    const loadingId = snapshot.thread.id
    setLoadingEarlier(true)
    setHistoryFeedback(null)
    try {
      const count = await useThreadStore.getState().loadEarlier(loadingId)
      if (visibleThread.current !== loadingId) return
      if (count) requestAnimationFrame(() => { if (visibleThread.current === loadingId && timeline.current === el) el.scrollTop += el.scrollHeight - previousHeight })
      else setHistoryFeedback({ id: loadingId, text: 'No public messages in this section. Continue loading earlier messages if available.' })
    } catch (cause) { if (visibleThread.current === loadingId) setHistoryFeedback({ id: loadingId, text: threadError(cause), error: true }) }
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
  }, [snapshot])
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
  }, [])
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
  const [caret, setCaret] = useState(0)
  const mentions = useFileMentions({
    workspaceId: snapshot?.thread.workspaceId, rootPath: snapshot?.thread.rootPath, draft, caret, enabled: Boolean(snapshot) && !pending,
    onApply: (text, position) => {
      if (!snapshot) return
      useThreadStore.getState().setDraft(snapshot.thread.id, text)
      requestAnimationFrame(() => { textarea.current?.focus(); textarea.current?.setSelectionRange(position, position); setCaret(position) })
    }
  })
  const insertMention = (): void => {
    if (!snapshot) return
    const field = textarea.current
    const position = field?.selectionStart ?? draft.length
    const needsSpace = position > 0 && !/\s/.test(draft[position - 1] ?? '')
    const text = draft.slice(0, position) + (needsSpace ? ' @' : '@') + draft.slice(position)
    const next = position + (needsSpace ? 2 : 1)
    useThreadStore.getState().setDraft(snapshot.thread.id, text)
    requestAnimationFrame(() => { field?.focus(); field?.setSelectionRange(next, next); setCaret(next) })
  }
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
    else if (result.surface === 'commands') { commands.show(); return }
    else if (result.surface === 'changes') { togglePanel('changes', true); return }
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

      <Popover.Root><Popover.Trigger asChild><button type="button" className="thread-icon-action" aria-label="Thread text size" title="Thread text size"><Type size={15} /></button></Popover.Trigger>
        <Popover.Portal><Popover.Content className="thread-font-popover" side="bottom" align="end" sideOffset={8}>
          <strong>Conversation text</strong><span>Adjust reading size</span>
          <div className="thread-font-controls"><button type="button" aria-label="Decrease thread text size" disabled={threadFontSize <= THREAD_FONT_MIN} onClick={() => setThreadFontSize(threadFontSize - 1)}><Minus size={14} /></button><output aria-label="Thread text size">{threadFontSize}px</output><button type="button" aria-label="Increase thread text size" disabled={threadFontSize >= THREAD_FONT_MAX} onClick={() => setThreadFontSize(threadFontSize + 1)}><Plus size={14} /></button></div>
          <button type="button" className="thread-font-reset" disabled={threadFontSize === THREAD_FONT_DEFAULT} onClick={() => setThreadFontSize(THREAD_FONT_DEFAULT)}>Reset to default</button>
          <Popover.Arrow className="thread-font-arrow" /></Popover.Content></Popover.Portal></Popover.Root>
      {snapshot && <>
        {([['terminal', 'Terminal', TerminalSquare, 'Ctrl+`'], ['changes', 'Changes', GitCompareArrows, 'Ctrl+Shift+D'], ['preview', 'Browser', Globe, 'Ctrl+Shift+B']] as const).map(([id, label, Icon, shortcut]) =>
          <button key={id} type="button" className="thread-review-trigger thread-panel-toggle" aria-label={label} title={`${label} · ${shortcut}`} aria-pressed={review?.panel === id} onClick={() => togglePanel(id)}><Icon size={14} /><span>{label}</span></button>)}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild><button type="button" className="thread-icon-action" aria-label="More workbench panels" title="Files, search, scripts, background activity and transcript view"><MoreHorizontal size={16} /></button></DropdownMenu.Trigger>
          <DropdownMenu.Portal><DropdownMenu.Content className="thread-more-menu" align="end" sideOffset={6}>
            <DropdownMenu.Label className="thread-more-label">Panels</DropdownMenu.Label>
            <DropdownMenu.RadioGroup value={review?.panel ?? ''} onValueChange={value => togglePanel(value as ThreadPanel, true)}>
              {([['files', 'Files'], ['search', 'Find in files'], ['scripts', 'Scripts'], ['background', 'Background activity']] as const).map(([id, label]) =>
                <DropdownMenu.RadioItem key={id} value={id} className="thread-more-item" aria-label={label}>{label}<DropdownMenu.ItemIndicator><Check size={13} /></DropdownMenu.ItemIndicator></DropdownMenu.RadioItem>)}
            </DropdownMenu.RadioGroup>
            <DropdownMenu.Separator className="thread-more-separator" />
            <DropdownMenu.Label className="thread-more-label">Transcript view <kbd>Ctrl+O</kbd></DropdownMenu.Label>
            <DropdownMenu.RadioGroup value={viewMode} onValueChange={value => useThreadViewModeStore.getState().setMode(value as ThreadViewMode)}>
              {THREAD_VIEW_MODES.map(mode => <DropdownMenu.RadioItem key={mode} value={mode} className="thread-more-item" aria-label={`${THREAD_VIEW_MODE_LABEL[mode]} view`}>
                <span>{THREAD_VIEW_MODE_LABEL[mode]}<small>{THREAD_VIEW_MODE_HINT[mode]}</small></span><DropdownMenu.ItemIndicator><Check size={13} /></DropdownMenu.ItemIndicator></DropdownMenu.RadioItem>)}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content></DropdownMenu.Portal>
        </DropdownMenu.Root>
      </>}
      {snapshot && <button type="button" className="thread-review-trigger" aria-label="Delegate work" title="Delegate to a persistent worktree Thread" disabled={pending || running} onClick={() => setDelegationOpen(true)}><Waypoints size={14} /><span>Delegate</span></button>}
      <button type="button" className="thread-review-trigger" aria-label="MCP connections" title="Connect MCP servers for this project" onClick={() => useUIStore.getState().openMcpPanel()}><Plug size={14} /><span>Connections</span></button>
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
        {historyFeedback?.id === selectedId && <p className="thread-history-feedback" role={historyFeedback.error ? 'alert' : 'status'}>{historyFeedback.text}</p>}
        {!snapshot && <div className="thread-welcome"><span className="thread-welcome-mark"><MessageSquarePlus size={26} strokeWidth={1.5} /></span><h2>{selectedId ? 'Opening conversation…' : 'What would you like to work on?'}</h2><p>{selectedId ? 'Loading the selected conversation.' : 'Select + beside a project to start a conversation, or add a project in the sidebar.'}</p></div>}
        <ThreadTimelineWindow key={snapshot?.thread.id ?? 'empty'} rows={timelineRows} scrollRef={timeline} followingRef={following} onViewportUpdateRef={updateTimelineViewport}>{({ event, key, turnId, turnEvents, firstInTurn, lastInTurn }) => <section className={`thread-turn thread-virtual-turn${firstInTurn ? ' is-turn-start' : ''}${lastInTurn ? ' is-turn-end' : ''}`} data-turn-id={turnId}>{(() => {
          if (event.type === 'activity-group') return <ThreadActivityGroup key={key} events={event.events} mode={viewMode} />
          if (event.type === 'plan') return <ThreadPlan key={key} event={event} />
          if (event.type === 'subagent') return <ThreadSubagentActivity key={key} event={event} compact stopping={pending} onStop={snapshot?.thread.capabilities?.features.subagentLifecycle?.enabled && api?.stopTask && event.receiverThreadIds[0] ? () => void action(() => api.stopTask!(snapshot.thread.id, event.receiverThreadIds[0])) : undefined} />
          if (event.type === 'tool' && event.files?.length) return <ThreadFileActivity key={key} event={event} root={snapshot?.thread.rootPath ?? ''} threadId={snapshot!.thread.id} onOpen={openFile} />
          if (event.type === 'message') {
            if (event.role === 'assistant' && authText(event.text)) return null
            const displayText = event.role === 'user' && event.id.startsWith('native:') ? formatNativeUserText(event.text) : event.text
            if (!displayText && !event.historicalQuestions?.length) return null
            const copyText = event.historicalQuestions?.length ? [displayText, 'Recovered questions — answer not confirmed', ...event.historicalQuestions.flatMap(question => [question.title, ...(question.options ?? []).map(option => `- ${option}`)])].filter(Boolean).join('\n\n') : displayText
            const final = event.role === 'assistant' && threadTurnPresentation(turnEvents).finalMessageId === event.id
            return <article key={key} className={`thread-message thread-message-${event.role}${final ? ' is-final-response' : ''}`}>
              {event.role === 'assistant' && (final || turnEvents.find(value => value.type === 'message' && value.role === 'assistant') === event) && <div className="thread-agent-label"><AgentProviderIcon provider={snapshot?.thread.provider ?? 'claude'} size={16} />{snapshot?.thread.provider === 'claude' ? 'Claude' : 'Codex'}{final && <span className="thread-final-label">Final response</span>}</div>}
              {event.role === 'user' && event.attachments?.length ? <ul className="thread-sent-attachments" aria-label="Message attachments">{event.attachments.map(attachment => <li key={attachment.id} title={attachment.name}><ImageIcon size={13} aria-hidden="true" /><span>{attachment.name}</span><small>{Math.ceil(attachment.bytes / 1024)} KB</small></li>)}</ul> : null}
              <ThreadMessageBody text={displayText} role={event.role} />
              {event.role === 'user' && event.context?.length ? <ul className="thread-sent-context" aria-label="Attached file context">{event.context.map(file => <li key={file.path} title={`${file.bytes} bytes attached${file.truncated ? ' (truncated)' : ''}`}><FileText size={12} aria-hidden="true" /><span>{file.path}</span>{file.truncated && <small>truncated</small>}</li>)}</ul> : null}
              {event.role === 'user' && snapshot?.deliveries?.[event.id] && snapshot.deliveries[event.id].state !== 'delivered' ? <ThreadDeliveryNote delivery={snapshot.deliveries[event.id]} disabled={pending} onResend={() => void action(() => api!.send(snapshot.thread.id, event.text, event.attachments?.map(attachment => attachment.id) ?? []))} /> : null}
              {event.role === 'user' && snapshot && !running && api?.rewind && snapshot.thread.capabilities?.features.rewind?.enabled && (() => {
                const turns = snapshot.turns ?? [], index = turns.findIndex(turn => turn.id === event.id)
                return index >= 0 && (turns[index].nativeId || snapshot.thread.provider === 'claude' && index > 0) ? <ThreadRewindControl laterTurns={turns.length - index} disabled={pending} onRewind={options => action(async () => {
                  const result = await api.rewind!(snapshot.thread.id, event.id, options)
                  useThreadStore.getState().updateSnapshot(result.snapshot)
                  if (result.fileError) throw Error(`Conversation rewound. Files were not fully restored: ${result.fileError}`)
                })} /> : null
              })()}
              {event.historicalQuestions?.length ? <ThreadHistoricalQuestions questions={event.historicalQuestions} /> : null}
              {event.role === 'assistant' && event.id === lastConversationMessage?.id && quickReplies.length > 0 && <div className="thread-quick-replies" aria-label="Suggested replies"><small>Choose a reply to review before sending</small><div>{quickReplies.map(option => <button type="button" key={option.value} onClick={() => { useThreadStore.getState().setDraft(snapshot!.thread.id, option.value); requestAnimationFrame(() => textarea.current?.focus()) }}>{option.label}</button>)}</div></div>}
              {event.role !== 'user' && event.attachments?.length ? <div className="thread-message-attachments" aria-label="Message attachments">{event.attachments.map(attachment => <span key={attachment.id}><Paperclip size={11} />{attachment.name}<small>{Math.ceil(attachment.bytes / 1024)} KB</small></span>)}</div> : null}
              {event.role === 'assistant' && <div className="thread-message-actions">
                <button type="button" aria-label={copiedMessageId === event.id ? 'Message copied' : final ? 'Copy final response' : event.role === 'assistant' ? 'Copy response' : 'Copy message'} title={copiedMessageId === event.id ? 'Copied' : final ? 'Copy final response' : event.role === 'assistant' ? 'Copy response' : 'Copy message'} onClick={() => void copyMessage(event.id, copyText)}>{copiedMessageId === event.id ? <Check size={13} /> : <Copy size={13} />}{final && <span>{copiedMessageId === event.id ? 'Copied' : 'Copy'}</span>}</button>
              </div>}
            </article>
          }
          if (event.type === 'tool') return <details key={key} className="thread-tool"><summary><ChevronDown size={12} />{event.state === 'running' ? <Loader2 size={12} className="thread-spin" /> : event.state === 'failed' ? <AlertCircle size={12} /> : <Check size={12} />}{event.name}<small>{event.state}</small></summary>{event.detail && <pre>{event.detail}</pre>}</details>
          if (event.type === 'request') return pendingRequests.some(request => request.id === event.request.id) ? null : <ThreadRequestCard key={key} conversationId={snapshot!.thread.id} request={event.request} turnResult={turnEvents.find((value): value is Extract<ThreadEvent, { type: 'completed' }> => value.type === 'completed')?.status} disabled={pending} onRespond={response => action(() => api!.respond!(snapshot!.thread.id, event.id, response))} />
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
        })()}{lastInTurn && turnEvents.some(value => value.type === 'completed') && <ThreadTurnChanges events={turnEvents} root={snapshot?.thread.rootPath ?? ''} onOpen={openFile} onViewChanges={() => { if (snapshot) useThreadWorkbenchStore.getState().setView(snapshot.thread.id, { panel: 'changes' }) }} onUndo={snapshot && !running && turnId ? () => undoTurnChanges(snapshot.thread.id, turnId) : undefined} loadFileStates={snapshot && turnId && api?.turnFiles ? () => api.turnFiles!(snapshot.thread.id, turnId) : undefined} onUndoFile={snapshot && !running && turnId && api?.undoTurnFile ? async path => { await api.undoTurnFile!(snapshot.thread.id, turnId, path); await useThreadStore.getState().refresh(snapshot.thread.id) } : undefined} />}{lastInTurn && turnEvents.some(value => value.type === 'completed') && <ThreadTurnTiming turn={snapshot?.turns?.find(value => value.id === turnId)} events={turnEvents} />}</section>}</ThreadTimelineWindow>
        {pendingMessage && <article className="thread-message thread-message-user thread-message-outgoing" aria-label="Sending message">{pendingMessage.attachments.length > 0 && <ul className="thread-sent-attachments" aria-label="Message attachments">{pendingMessage.attachments.map(attachment => <li key={attachment.id} title={attachment.name}><ImageIcon size={13} aria-hidden="true" /><span>{attachment.name}</span><small>{Math.ceil(attachment.bytes / 1024)} KB</small></li>)}</ul>}<ThreadMessageBody text={pendingMessage.text} role="user" /><small className="thread-message-outgoing-status">Sending…</small></article>}
        {snapshot && <ThreadLiveActivity snapshot={snapshot} />}
      </div>
    </div>
    <div className="thread-composer-dock"><div className="thread-composer-column">
      {snapshot && pendingRequests.length > 0 && <section className="thread-pending-requests" aria-label="Pending agent requests">
        {pendingRequests.map(request => <ThreadRequestCard key={`${snapshot.thread.id}:${request.id}:${request.generation}`} conversationId={snapshot.thread.id} request={request} disabled={pending} onRespond={response => action(() => api!.respond!(snapshot.thread.id, request.id, response))} onRemember={api?.addPermissionRule ? async suggestions => { for (const item of suggestions) await api.addPermissionRule!(snapshot.thread.id, { kind: item.kind, pattern: item.pattern, decision: 'allow', scope: 'project' }) } : undefined} />)}
      </section>}
      {snapshot?.thread.status === 'approval' && pendingRequests.length === 0 && !snapshot.events.some(event => event.type === 'approval' && !snapshot.events.some(other => other.type === 'approval-resolved' && other.id === event.id)) && <div className="thread-action-error" role="alert"><span>The provider is waiting for input, but its request is unavailable. Refresh the request or stop the turn using the stop button.</span><button type="button" disabled={pending} onClick={() => void action(() => useThreadStore.getState().refresh(snapshot.thread.id))}>Refresh request</button></div>}
      {showEnd && <button type="button" className="thread-scroll-end" onClick={scrollEnd}><ArrowDown size={12} />Latest messages{newMessages > 0 ? ` · ${newMessages}` : ''}</button>}
      {snapshot && needsLogin && <div className="thread-connection-notice">{needsLogin ? <><AlertCircle size={14} /><span>{authFailure ? `Sign in to ${snapshot.thread.provider === 'claude' ? 'Claude Code' : 'Codex'}` : accountMessage(account)}</span><button type="button" onClick={onAccounts}>{authFailure ? 'Reconnect' : 'Connect'}</button>{authFailure && lastPrompt?.type === 'message' && <button type="button" title="Resend after connecting" disabled={pending || account?.state !== 'connected' || account.method !== 'subscription'} onClick={() => void action(() => api!.send(snapshot.thread.id, lastPrompt.text, lastPrompt.attachments?.map(attachment => attachment.id) ?? []))}>Retry</button>}</> : <><Check size={14} /><span>{account ? `${snapshot.thread.provider === 'claude' ? 'Claude Code' : 'Codex'} connected` : 'Checking agent connection…'}</span></>}</div>}
      {degradedConnection && !needsLogin && <div className="thread-connection-notice is-warning" role="status"><AlertCircle size={14} /><span>{degradedConnection.detail || 'Provider connection is unavailable.'}{degradedConnection.nextRetryAt ? ` You can retry after ${new Date(degradedConnection.nextRetryAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}.` : ''}</span></div>}
      {snapshot && blocksThreadInput(snapshot.thread) && <div className="thread-connection-notice"><TerminalSquare size={14} /><span>Recover the saved conversation to continue here.</span><button type="button" disabled={pending} onClick={() => void action(returnFromCli)}>Recover conversation</button></div>}
      {(error || !api) && <div role="alert" className="thread-action-error"><span>{error || 'Thread service unavailable. Restart the updated application.'}</span><button type="button" aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}
      {snapshot?.thread.queue && <ThreadPromptQueue items={snapshot.thread.queue} disabled={pending} pause={snapshot.thread.queuePause}
        onResume={api?.resumeQueue ? () => action(() => api.resumeQueue!(snapshot.thread.id)) : undefined}
        onSendNow={api?.sendQueuedNow ? itemId => action(() => api.sendQueuedNow!(snapshot.thread.id, itemId)) : undefined}
        onClear={() => action(async () => { for (const item of snapshot.thread.queue ?? []) if (item.state !== 'sending') await api!.deleteQueued!(snapshot.thread.id, item.id) })}
        onUpdate={(itemId, text) => action(() => api!.updateQueued!(snapshot.thread.id, itemId, text))} onDelete={itemId => action(() => api!.deleteQueued!(snapshot.thread.id, itemId))} onRestore={item => action(async () => {
        await api!.deleteQueued!(snapshot.thread.id, item.id, true)
        useThreadStore.getState().setDraft(snapshot.thread.id, item.text)
        useThreadStore.getState().clearAttachments(snapshot.thread.id)
        for (const attachment of item.attachments ?? []) useThreadStore.getState().addAttachment(snapshot.thread.id, attachment)
        if (item.configuration && api?.configure) useThreadStore.getState().updateSnapshot(await api.configure(snapshot.thread.id, item.configuration, snapshot.thread.configurationRevision ?? 0))
        requestAnimationFrame(() => textarea.current?.focus())
      })} onReorder={itemIds => action(() => api!.reorderQueued!(snapshot.thread.id, itemIds))} />}
      {snapshot && <PrStatusBar key={snapshot.thread.id} workspaceId={snapshot.thread.workspaceId} rootPath={snapshot.thread.rootPath} onFix={appendToConversation} />}
      <form className="thread-composer" data-state={composerState} aria-busy={pending} onSubmit={e => { e.preventDefault(); send() }} onDragOver={event => { if ([...event.dataTransfer.items].some(item => item.kind === 'file')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }} onDrop={event => { const files = [...event.dataTransfer.files].filter(file => file.type.startsWith('image/')); if (files.length) { event.preventDefault(); void uploadFiles(files) } }}>
        <VoiceHud status={voice.status} error={voice.error} level={voice.level} modelProgress={voice.modelProgress} onDismiss={voice.dismiss} containerSelector=".thread-view" focusSelector="textarea[data-thread-composer='true']" />
        {commands.popup}
        {mentions.popup}
        {attachments.length > 0 && <div className="thread-attachments" aria-label="Attachments">{attachments.map(attachment => <div key={attachment.id}><span>{attachment.name}</span><small>{Math.ceil(attachment.bytes / 1024)} KB</small><button type="button" aria-label={`Remove ${attachment.name}`} disabled={pending} onClick={() => void removeAttachment(attachment.id)}><X size={12} /></button></div>)}</div>}
        <input ref={fileInput} type="file" hidden multiple accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => { void uploadFiles(Array.from(event.target.files ?? [])); event.target.value = '' }} />
        <textarea ref={textarea} data-thread-composer="true" aria-label={active ? 'Message' : `Message in ${snapshot?.thread.title ?? 'conversation'}`} {...commands.inputProps} placeholder={snapshot ? 'Ask about your project, or / for commands…' : 'Create a thread to get started…'} value={draft} disabled={!snapshot || pending || Boolean(snapshot.thread.cliActive)}
          onChange={e => { setCaret(e.target.selectionStart); commands.onChange(e.target.value, e.target.selectionStart) }} onSelect={e => { setCaret(e.currentTarget.selectionStart); commands.onSelect(e.currentTarget.selectionStart) }} onFocus={commands.onFocus} onBlur={commands.onBlur}
          onPaste={event => { const files = [...event.clipboardData.files].filter(file => file.type.startsWith('image/')); if (files.length) { event.preventDefault(); void uploadFiles(files) } }}
          onKeyDown={e => { if (mentions.onKeyDown(e)) return; if (commands.onKeyDown(e)) return; if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() } }} />
        <footer><button type="button" className="thread-command-trigger" aria-label="Show thread commands" title="Commands & skills · Ctrl+/" aria-haspopup="listbox" aria-expanded={commands.open} disabled={!snapshot || pending || Boolean(snapshot.thread.cliActive)} onMouseDown={e => e.preventDefault()} onClick={commands.show}><Slash size={14} /></button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild><button type="button" className="thread-command-trigger" aria-label="Add to prompt" title="Attach, mention a file or connect tools" disabled={!snapshot || pending}><Plus size={15} /></button></DropdownMenu.Trigger>
            <DropdownMenu.Portal><DropdownMenu.Content className="thread-more-menu" side="top" align="start" sideOffset={8}>
              <DropdownMenu.Item className="thread-more-item" disabled={attachments.length >= 8 || !api?.attach} onSelect={() => fileInput.current?.click()}><span><Paperclip size={13} /> Attach image</span></DropdownMenu.Item>
              <DropdownMenu.Item className="thread-more-item" onSelect={() => insertMention()}><span><AtSign size={13} /> Mention a file</span></DropdownMenu.Item>
              <DropdownMenu.Item className="thread-more-item" onSelect={() => useUIStore.getState().openMcpPanel()}><span><Plug size={13} /> MCP connections</span></DropdownMenu.Item>
            </DropdownMenu.Content></DropdownMenu.Portal>
          </DropdownMenu.Root>
          <button type="button" className="thread-command-trigger" aria-label="Voice input" title="Voice input · Ctrl+Shift+V" disabled={!snapshot || pending || !voice.isSupported} onClick={voice.toggle}><Mic size={14} /></button>
          {snapshot && <ThreadConfigurationBar key={snapshot.thread.id} thread={snapshot.thread} openControl={openControl} onControlClosed={() => setOpenControl(null)} onError={setError} onConfigured={value => useThreadStore.getState().updateSnapshot(value)} />}
          {running && snapshot?.thread.capabilities?.features.steering?.enabled && <button type="button" className="thread-command-trigger" aria-label="Steer active turn" title="Send guidance to the active turn" disabled={pending || (!draft.trim() && !attachments.length)} onClick={() => send('steer')}><CornerDownLeft size={14} /></button>}
          {snapshot && <ThreadCostChip cost={snapshot.thread.costReport} />}
          {snapshot && <ThreadUsageRing provider={snapshot.thread.provider} idle={!running} threadId={snapshot.thread.id} context={snapshot.thread.contextReport} />}
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
      : panel.surface === 'rules' && snapshot ? <Suspense fallback={<p>Loading…</p>}><ThreadPermissionsPanel threadId={snapshot.thread.id} /></Suspense>
      : panel.surface === 'delegations' ? <div className="thread-panel-list">{panel.rows?.length ? panel.rows.map((row, index) => <button key={index} type="button" disabled={pending || !row.id} onClick={() => { if (row.id) { setPanel(null); void useThreadStore.getState().select(row.id) } }}><strong>{row.label}</strong>{row.detail && <span>{row.detail}</span>}</button>) : <p>No delegated work in this project.</p>}</div>
      : <>{panel.text !== undefined && <><pre>{panel.text || 'No content available.'}</pre>{panel.externalUrl && <button type="button" onClick={() => window.open(panel.externalUrl, '_blank', 'noopener,noreferrer')}>Open in browser</button>}{panel.text && !panel.externalUrl && <button type="button" onClick={() => void navigator.clipboard.writeText(panel.text!).catch(() => setError('Could not copy text.'))}>Copy text</button>}</>}
        {panel.usage ? <ThreadUsageDetails usage={panel.usage} /> : panel.title === 'Conversation status' && panel.rows ? <div className="thread-status-summary">
          <p className="terminal-session-identity-note">The native session ID resumes the Codex or Claude conversation. Thread, project and workspace IDs belong to OXESpace.</p>
          <DetailList rows={['Provider', 'Native session ID (resume)', 'Status', 'Model', 'Effort', 'Access', 'Network', 'Approvals', 'Mode', 'Connection', 'Directory'].flatMap(label => panel.rows!.filter(row => row.label === label))} />
          <details className="terminal-technical-details"><summary>Internal OXESpace IDs and runtime</summary><DetailList rows={['Thread ID', 'Project ID', 'Workspace ID', 'Generation', 'Operation', 'Hooks'].flatMap(label => panel.rows!.filter(row => row.label === label))} /></details>
        </div> : panel.rows && (panel.rows.length && panel.rows.every(row => !row.id) ? <DetailList rows={panel.rows} /> : <div className="thread-panel-list">{panel.rows.length ? panel.rows.map((row, index) => row.id ? <button type="button" key={index} disabled={pending} onClick={() => void action(async () => { setPanel(null); await runCommand(row.id!) })}><strong>{row.label}</strong>{row.detail && <span>{row.detail}</span>}</button> : <div key={index}><strong>{row.label}</strong><span>{row.detail}</span></div>) : <p>No items returned by the provider.</p>}</div>)}</>}
    </DesktopDialog>}
    {delegationOpen && snapshot && <DelegationCreateDialog thread={snapshot.thread} onClose={() => setDelegationOpen(false)} />}
  </section>
    {snapshot && review?.panel && drawer ? <Dialog.Root open onOpenChange={open => { if (!open) closeReview() }}><Dialog.Portal container={workbench.current}>
      <Dialog.Overlay className="thread-review-scrim" />
      <Dialog.Content className="thread-review-host" aria-describedby={undefined} style={{ width: Math.min(reviewWidth, Math.max(280, availableWidth - 16)) }} onCloseAutoFocus={event => { event.preventDefault(); textarea.current?.focus() }}>
        <Dialog.Title className="thread-review-accessible-title">Conversation review</Dialog.Title>
        <ThreadChangesPanel key={snapshot.thread.id} snapshot={snapshot} workspace={workspace} panel={review.panel} onClose={closeReview} onSendToConversation={appendToConversation} />
      </Dialog.Content>
    </Dialog.Portal></Dialog.Root> : snapshot && review?.panel && <>
      {!drawer && <div className="thread-review-resize" role="separator" aria-label="Resize review panel" aria-orientation="vertical" tabIndex={0} aria-valuemin={320} aria-valuemax={Math.min(720, availableWidth - 480)} aria-valuenow={Math.min(reviewWidth, Math.max(320, availableWidth - 480))}
        onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); useThreadWorkbenchStore.getState().setWidth(Math.min(availableWidth - 480, reviewWidth + (event.key === 'ArrowLeft' ? 24 : -24))) } }}
        onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId) }}
        onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId) && workbench.current) useThreadWorkbenchStore.getState().setWidth(Math.min(availableWidth - 480, workbench.current.getBoundingClientRect().right - event.clientX)) }}
        onPointerUp={event => event.currentTarget.releasePointerCapture(event.pointerId)} />}
      <div className="thread-review-host" style={{ width: drawer ? Math.min(reviewWidth, Math.max(280, availableWidth - 16)) : Math.min(reviewWidth, Math.max(320, Math.min(availableWidth * .48, availableWidth - 640))) }}>
        <ThreadChangesPanel key={snapshot.thread.id} snapshot={snapshot} workspace={workspace} panel={review.panel} onClose={closeReview} onSendToConversation={appendToConversation} />
      </div>
    </>}
  </div>
}

function ThreadTurnTiming({ turn, events }: { turn?: import('../../../shared/types/thread').ThreadTurn; events: ThreadEvent[] }) {
  const seconds = turn?.startedAt && turn.completedAt ? Math.max(0, Math.round((turn.completedAt - turn.startedAt) / 1000)) : undefined
  const summary = threadTurnPresentation(events)
  const status = [...events].reverse().find((event): event is Extract<ThreadEvent, { type: 'completed' }> => event.type === 'completed')?.status ?? turn?.status ?? 'interrupted'
  const warning = status === 'completed' && (summary.failedActions > 0 || summary.unconfirmedActions > 0)
  const background = events.filter(event => event.type === 'subagent' && event.state === 'running').length
  return <div className={`thread-turn-timing is-${warning ? 'warning' : status}`}><span className="thread-turn-outcome">{status === 'completed' ? <Check size={12} /> : <AlertCircle size={12} />}{status === 'completed' ? background ? `Turn completed · ${background} background pending` : warning ? 'Completed with warnings' : 'Completed' : status === 'failed' ? 'Failed' : 'Interrupted'}</span>{summary.actionCount > 0 && <span>{summary.actionCount} {summary.actionCount === 1 ? 'action' : 'actions'}{summary.failedActions > 0 ? ` · ${summary.failedActions} failed` : ''}{summary.unconfirmedActions > 0 ? ` · ${summary.unconfirmedActions} unconfirmed` : ''}</span>}{seconds !== undefined && <span>{seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`}</span>}{turn?.configuration.model && <span>{turn.configuration.model}{turn.configuration.reasoningEffort ? ` · ${turn.configuration.reasoningEffort}` : ''}</span>}</div>
}
