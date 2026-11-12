import { Button, cx, ErrorState, Skeleton, Spinner } from '../../ui'
import { threadAgentName, threadProductName } from '../../../shared/threadProviders'
import skeletonStyles from '../Navigation/ModeViews.module.css'
import { useTranslation } from 'react-i18next'
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, ArrowDown, ArrowUp, MessageSquarePlus, TerminalSquare, Image as ImageIcon } from 'lucide-react'
import { blocksThreadInput } from '../../../shared/threadHistoryNotice'
import type { Workspace } from '../../../shared/types/workspace'
import type { ThreadAttachment } from '../../../shared/types/thread'
import { useGitBranch } from '../../hooks/useGitBranch'
import { ThreadEmptyState, threadStarters } from './ThreadEmptyState'
import { useWorkspaceStore } from '../../store/workspace.store'
import { useThreadStore } from '../../store/thread.store'
import { useThreadPrefs } from '../../store/thread-prefs.store'
import { useAccountStore, selectAccount } from '../../store/account.store'
import { accountContext, accountMessage } from './accountMessages'
import { useThreadCommands } from './useThreadCommands'
import { useFileMentions } from './useFileMentions'
import { PrStatusBar } from '../GitHub/PrStatusBar'
import { usePrArchiveOffer } from './usePrArchiveOffer'
import { ThreadLiveActivity } from './ThreadLiveActivity'
import { threadQuickReplies } from './threadQuickReplies'
import { createThreadTimelineBuilder, flattenThreadTimeline, foldFinishedTurns, summarizeThreadEvents } from './threadTimelineModel'
import { errorText, humanizeError } from '../../utils/humanizeError'

const EMPTY_FOLDS: ReadonlySet<string> = new Set()
// Stable empty values, so rows do not get a new prop on every render.
const NO_EVENTS: import('../../../shared/types/thread').ThreadEvent[] = []
const NO_REPLIES: ReturnType<typeof threadQuickReplies> = []
const NO_REQUESTS: import('../../../shared/types/thread').ThreadRequest[] = []
// A stable empty list: a fresh [] per store read makes zustand 5 re-render forever.
const NO_ATTACHMENTS: import('../../../shared/types/thread').ThreadAttachment[] = []
import { useThreadViewModeStore } from '../../store/thread-view-mode.store'
import { ThreadTimelineWindow } from './ThreadTimeline'
import { deriveThreadComposerState } from './threadComposerState'
import { hasDesktopCommand } from '../../../shared/threadDesktopCommands'
import { useUIStore } from '../../store/ui.store'
import { CONVERSATION_MIN_WIDTH, REVIEW_MIN_WIDTH, useThreadWorkbenchStore, type ThreadPanel } from '../../store/thread-workbench.store'
import { authText, ThreadMessageBody } from './ThreadMessageRow'
import { ThreadAddToolMenu, ThreadHeader } from './ThreadHeader'
import { ThreadToolTabs, type ThreadTabId } from './ThreadToolTabs'
import { deriveThreadActivity } from './deriveThreadActivity'
import type { NowLineAction } from './NowLine'
import { useOpenRequest } from '../Approvals/openRequest'
import { useThreadShortcuts } from './useThreadShortcuts'
import { ThreadFindBar } from './ThreadFindBar'
import { ThreadAnnouncer } from './ThreadAnnouncer'
import { ThreadTimelineEntry } from './ThreadTimelineEntry'
import { ThreadComposerForm } from './ThreadComposerForm'
import { ThreadDockQueue, ThreadDockRequests } from './ThreadDockRequests'
import { ThreadDockPlan } from './ThreadDockPlan'
import { ThreadDockChanges } from './ThreadDockChanges'
import { ThreadBackgroundShells } from './ThreadBackgroundShells'
import { ThreadPromptNavigator } from './ThreadPromptNavigator'
import { useThreadScrollAnchor } from './useThreadScrollAnchor'
import { isAccountUnavailable, threadError } from './threadError'
import { quoteMarkdown } from './threadComposerState'
import { ThreadContextMenu } from './ThreadContextMenu'
import { loadDelegationPanel, loadResumeData, type ThreadPanelState } from './threadCommandPanels'

const ThreadCommandDialog = lazy(() => import('./ThreadCommandDialog'))
const ThreadReviewHost = lazy(() => import('./ThreadReviewHost'))
import { DelegationCreateDialog } from '../Delegation/DelegationCreateDialog'
import { threadWorkingRoot } from './threadChanges'
import { useThreadWorktreeFinishStore } from '../../store/thread-worktree-finish.store'
import './ThreadWorkbench.css'
import './ThreadView.css'
import { formatClock, formatNumber } from '../../utils/formatTime'

export function ThreadView({ workspace, threadId, active = true, cell, onActivate, onCloseCell, onNewThread, onAccounts, onDelegations }: { workspace?: Workspace; threadId?: string | null; active?: boolean; cell?: 'primary' | 'secondary'; onActivate?: () => void; onCloseCell?: () => void; onNewThread?: () => void; onAccounts?: () => void; onDelegations?: () => void }) {
  const { t } = useTranslation('thread')
  const storeSelectedId = useThreadStore(state => state.selectedId)
  const snapshot = useThreadStore(state => threadId ? state.selectedId === threadId ? state.snapshot : state.snapshotCache[threadId] ?? null : state.snapshot)
  const selectedId = threadId ?? storeSelectedId
  // While the next conversation loads (F7.2) the previous one is still on screen: what belongs to a conversation
  // (scroll position, review state, history feedback) follows the one shown, not the one selected.
  const shownId = snapshot?.thread.id ?? selectedId
  const threadFontSize = useThreadPrefs(state => state.fontSize)
  const workbench = useRef<HTMLDivElement>(null)
  const [availableWidth, setAvailableWidth] = useState(0)
  const review = useThreadWorkbenchStore(state => shownId ? state.views[shownId] : undefined)
  // The panel sits beside the conversation, as OxeCode's do, whenever both keep their minimum width; only a workbench
  // too narrow for that gets the drawer over the conversation.
  const drawer = availableWidth > 0 && availableWidth < CONVERSATION_MIN_WIDTH + REVIEW_MIN_WIDTH
  const draft = useThreadStore(state => snapshot ? state.drafts[snapshot.thread.id] ?? '' : '')
  const attachments = useThreadStore(state => snapshot ? state.attachments[snapshot.thread.id] ?? NO_ATTACHMENTS : NO_ATTACHMENTS)
  const [error, setError] = useState(''), [pending, setPending] = useState(false)
  // What the person can't act on (a code from main), shown under Details; cleared with the error.
  const [errorDetail, setErrorDetail] = useState('')
  const [outgoing, setOutgoing] = useState<{ threadId: string; text: string; attachments: ThreadAttachment[]; knownEvents: Set<string> } | null>(null)
  const [panel, setPanel] = useState<ThreadPanelState | null>(null)
  const panelOpener = useRef<HTMLElement | null>(null)
  const [openControl, setOpenControl] = useState<'model' | 'effort' | 'permissions' | null>(null)
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const [delegationOpen, setDelegationOpen] = useState(false)
  const [prThreadId, setPrThreadId] = useState<string | null>(null)
  const textarea = useRef<HTMLTextAreaElement>(null), fileInput = useRef<HTMLInputElement>(null), actionInFlight = useRef(false)
  // T40: its own PR closed or merged, the conversation offers to archive itself (src/components/Threads/usePrArchiveOffer.ts).
  const onPrStatus = usePrArchiveOffer(snapshot?.thread)
  const hasPullRequest = Boolean(snapshot && prThreadId === snapshot.thread.id)
  const scroll = useThreadScrollAnchor(snapshot, shownId)
  const { timeline, scrollEnd } = scroll
  // The branch of the checkout the conversation works in, which is a worktree once the provider moves into one.
  const branch = useGitBranch(workspace?.id ?? '', snapshot ? threadWorkingRoot(snapshot.thread) : workspace?.rootPath ?? '')
  const api = window.oxe?.thread
  useEffect(() => {
    const node = workbench.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setAvailableWidth(node.clientWidth))
    observer.observe(node)
    setAvailableWidth(node.clientWidth)
    return () => observer.disconnect()
  }, [])
  /** Header toggles: a second click closes the panel; `keepOpen` is for the menu radios. */
  const togglePanel = (panelId: ThreadPanel, keepOpen = false): void => {
    if (!snapshot) return
    const current = useThreadWorkbenchStore.getState().views[snapshot.thread.id]?.panel ?? null
    // The control that opens the panel gets focus back when it closes (HML FINDING M on #227, DESIGN on F14).
    if (current === null && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) panelOpener.current = document.activeElement
    useThreadWorkbenchStore.getState().setView(snapshot.thread.id, { panel: current === panelId && !keepOpen ? null : panelId })
  }
  /** Back to what opened the panel (the header toggle), or the composer when that is gone (a menu item, say). */
  const returnFocusFromPanel = (): void => {
    const opener = panelOpener.current
    panelOpener.current = null
    requestAnimationFrame(() => { if (opener?.isConnected) opener.focus(); else textarea.current?.focus() })
  }
  const [finding, setFinding] = useState(false)
  const scrollToRow = useRef<((index: number) => void) | null>(null)
  const scrollTo = useCallback((index: number) => scrollToRow.current?.(index), [])
  useThreadShortcuts({ active, togglePanel, openControl: setOpenControl, onFind: () => setFinding(true), runCommand: text => action(() => runCommand(text)) })
  const closeReview = () => { if (snapshot) useThreadWorkbenchStore.getState().setView(snapshot.thread.id, { panel: null }); if (useThreadWorkbenchStore.getState().maximizedId === snapshot?.thread.id) useThreadWorkbenchStore.getState().setMaximized(null); requestAnimationFrame(() => textarea.current?.focus()) }
  const reviewMaximized = useThreadWorkbenchStore(state => Boolean(snapshot) && state.maximizedId === snapshot?.thread.id) && Boolean(review?.panel) && !drawer
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
  // One pass per events array instead of several scans per render: typing re-renders this view on every key.
  const events = snapshot?.events ?? NO_EVENTS
  const summary = useMemo(() => summarizeThreadEvents(events), [events])
  const pendingRequests = running ? (snapshot?.pendingRequests ?? summary.pendingRequests) : NO_REQUESTS
  const activity = useMemo(() => deriveThreadActivity(snapshot, pendingRequests), [snapshot, pendingRequests])
  const irreversible = Boolean(pendingRequests[0]?.impact && !pendingRequests[0].impact.reversible)
  const viewMode = useThreadViewModeStore(state => state.mode)
  // A stable key, so the timeline is not rebuilt on every render only because this array is new.
  const pendingRequestKey = pendingRequests.map(request => request.id).join('\n')
  // Finished turns fold their intermediate work ("Completed N steps in Xs"), except in the verbose view and
  // while Find is open, so a search never misses a hidden row. The open folds reset with the conversation.
  const [openFolds, setOpenFolds] = useState<{ threadId: string | undefined; turns: Set<string> }>({ threadId: undefined, turns: new Set() })
  const expandedFolds = openFolds.threadId === snapshot?.thread.id ? openFolds.turns : EMPTY_FOLDS
  const toggleFold = useCallback((turnId: string) => setOpenFolds(current => {
    const turns = new Set(current.threadId === snapshot?.thread.id ? current.turns : [])
    if (turns.has(turnId)) turns.delete(turnId); else turns.add(turnId)
    return { threadId: snapshot?.thread.id, turns }
  }), [snapshot?.thread.id])
  // Rebuilds only the turns a streamed delta changed (threadTimelineModel.ts).
  const [buildTimeline] = useState(createThreadTimelineBuilder)
  const turns = useMemo(() => {
    const built = buildTimeline(events, viewMode)
    if (viewMode === 'verbose' || finding) return built
    return foldFinishedTurns(built, expandedFolds, new Set(pendingRequestKey ? pendingRequestKey.split('\n') : []))
  }, [buildTimeline, events, viewMode, finding, expandedFolds, pendingRequestKey])
  const timelineRows = useMemo(() => flattenThreadTimeline(turns), [turns])
  const shownThreadId = snapshot?.thread.id
  const pendingMessage = useMemo(() => outgoing && shownThreadId === outgoing.threadId && !events.some(event => event.type === 'message' && event.role === 'user' && event.text === outgoing.text && !outgoing.knownEvents.has(event.id)) ? outgoing : null, [outgoing, shownThreadId, events])
  const { lastResult, lastMessage: lastConversationMessage, lastPrompt } = summary
  const idle = snapshot?.thread.status === 'idle'
  const quickReplies = useMemo(() => lastConversationMessage?.role === 'assistant' && idle && !summary.pendingRequests.length
    ? threadQuickReplies(lastConversationMessage.text) : NO_REPLIES, [lastConversationMessage, idle, summary])
  const authFailure = snapshot?.thread.status === 'failed' && (lastResult?.type === 'completed' && lastResult.errorCode === 'authentication' || turns.at(-1)?.events.some(e => e.type === 'message' && e.role === 'assistant' && authText(e.text)))
  // Only something to act on: a failed sign-in, no account, a missing CLI or another auth method. A check that
  // merely could not confirm the account ('error'), or is still running, is not shown by default.
  const needsLogin = Boolean(snapshot && (authFailure || account && !['connected', 'error', 'checking', 'connecting'].includes(account.state) || account?.state === 'connected' && account.method !== 'subscription'))
  const degradedConnection = snapshot?.thread.connection?.state === 'degraded' ? snapshot.thread.connection : undefined
  const copyMessage = async (id: string, text: string) => {
    let copied = false
    try { copied = await window.oxe?.clipboard?.writeText(text) ?? false } catch { /* Browser clipboard remains available. */ }
    if (!copied) { try { await navigator.clipboard.writeText(text); copied = true } catch { /* Report the failed copy below. */ } }
    if (copied) setCopiedMessageId(id)
    else setError(t('view.copyFailed'))
  }
  useLayoutEffect(() => { const el = timeline.current; if (el && scroll.following.current) el.scrollTop = el.scrollHeight }, [draft, timeline, scroll.following])
  const action = async (run: () => Promise<unknown>, onSettled?: (success: boolean) => void): Promise<void> => {
    if (actionInFlight.current) return
    actionInFlight.current = true
    setPending(true); setError(''); setErrorDetail('')
    let success = false
    try { await run(); if (snapshot) await useThreadStore.getState().refresh(snapshot.thread.id); success = true }
    catch (error) {
      if (String(error).includes('THREAD_AUTH_REQUIRED')) { await useAccountStore.getState().read(context); onAccounts?.(); setError(t('view.connectFirst')) }
      // T88: no agent found, or its account can't be read: say what to do, keep main's words under Details.
      else if (isAccountUnavailable(error)) { void useAccountStore.getState().read(context); setError(threadError(error)); setErrorDetail(errorText(error)) }
      else setError(threadError(error))
    } finally { onSettled?.(success); actionInFlight.current = false; setPending(false) }
  }
  // Stop is never held back by another action of this view. `action` runs one thing at a time and drops the rest:
  // while a message was still being accepted (a session resumed after the app closed takes its time) every Stop was
  // dropped without a word, or disabled, and the turn went on.
  const stopInFlight = useRef(false)
  const stopTurn = (): void => {
    const interrupt = api?.interrupt
    if (!snapshot || !interrupt || stopInFlight.current) return
    const id = snapshot.thread.id
    stopInFlight.current = true
    setError(''); setErrorDetail('')
    void interrupt(id).then(() => useThreadStore.getState().refresh(id)).catch(cause => setError(threadError(cause))).finally(() => { stopInFlight.current = false })
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
    if (!snapshot || !api?.command) throw Error(t('view.restartForCommands'))
    const id = snapshot.thread.id
    if (text.trim() === '/usage') {
      useUIStore.getState().openUsage()
      if (useThreadStore.getState().drafts[id] === text) useThreadStore.getState().setDraft(id, '')
      return
    }
    const ending = /^\/(archive|delete)$/i.exec(text.trim())
    if (ending && snapshot.thread.ownedWorktree) {
      useThreadWorktreeFinishStore.getState().ask(id, ending[1].toLowerCase() as 'archive' | 'delete')
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
    else if (result.surface === 'sessions') setPanel({ ...result, title: t('commandDialog.resume'), resume: await loadResumeData(snapshot.thread) })
    else if (result.surface === 'delegations') setPanel(await loadDelegationPanel(snapshot.thread, result))
    else if (result.kind === 'panel' || result.kind === 'confirm') setPanel(result)
    if (useThreadStore.getState().drafts[id] === text) useThreadStore.getState().setDraft(id, '')
    await useThreadStore.getState().refresh(id)
  }
  const uploadFiles = async (files: File[]) => {
    if (!snapshot || !api?.attach || !files.length) return
    const id = snapshot.thread.id
    await action(async () => {
      for (const file of files.slice(0, Math.max(0, 8 - attachments.length))) {
        if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) throw Error(t('view.unsupportedImage', { name: file.name }))
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
    if (snapshot.thread.cliActive) { setError(t('view.cliOwns')); return }
    const text = draft, id = snapshot.thread.id
    const attachmentIds = attachments.map(value => value.id)
    const message = text || t('view.inspectImage')
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
    scroll.reinitialize()
  }
  // Whether the first pending request's buttons are on screen in the timeline. Its footer is what is watched: a long
  // command can show the top of the card while Deny and Allow are still below the fold.
  const firstPendingId = pendingRequests[0]?.id
  const [requestInView, setRequestInView] = useState(false)
  useEffect(() => {
    const root = workbench.current?.querySelector<HTMLElement>('.thread-timeline')
    if (!firstPendingId || !root || typeof IntersectionObserver === 'undefined') { setRequestInView(false); return }
    let watched: Element | null = null
    const observer = new IntersectionObserver(entries => setRequestInView(entries.some(entry => entry.isIntersecting)), { root, threshold: 0.6 })
    const attach = (): void => {
      const card = root.querySelector<HTMLElement>(`[data-request-id="${CSS.escape(firstPendingId)}"]`)
      const target = card?.querySelector('footer') ?? card ?? null
      if (target === watched) return
      if (watched) observer.unobserve(watched)
      watched = target
      // The timeline is virtual: a card scrolled far away leaves the page, and is not on screen.
      if (target) observer.observe(target); else setRequestInView(false)
    }
    attach()
    const rows = new MutationObserver(attach)
    rows.observe(root, { childList: true, subtree: true })
    return () => { observer.disconnect(); rows.disconnect() }
  }, [firstPendingId])
  const handleNowAction = (act: NowLineAction): void => {
    if (!snapshot) return
    const firstPending = pendingRequests[0]
    const respond = api?.respond
    if (act === 'deny' && firstPending && respond) {
      void action(() => respond(snapshot.thread.id, firstPending.id, { decision: 'decline' }))
      return
    }
    if (act === 'allow' && firstPending && respond) {
      void action(() => respond(snapshot.thread.id, firstPending.id, { decision: 'accept' }))
      return
    }
    if (act === 'see-impact' && firstPending) {
      if (firstPending.impact && !firstPending.impact.reversible) useOpenRequest.getState().open(firstPending.id)
      else {
        const inlineCard = workbench.current?.querySelector<HTMLElement>(`.thread-timeline [data-request-id="${firstPending.id}"]`)
        inlineCard?.scrollIntoView({ block: 'nearest' })
        ;(inlineCard?.querySelector<HTMLElement>('button') ?? workbench.current?.querySelector<HTMLElement>('.thread-request-approval .thread-request-decline, .thread-request-approval button'))?.focus()
      }
      return
    }
    if (act === 'answer') {
      const inlineQuestion = firstPending ? workbench.current?.querySelector<HTMLElement>(`.thread-timeline [data-request-id="${firstPending.id}"]`) : null
      inlineQuestion?.scrollIntoView({ block: 'nearest' })
      ;(inlineQuestion?.querySelector<HTMLElement>('input, select, textarea, button') ?? workbench.current?.querySelector<HTMLElement>('.thread-pending-requests input, .thread-pending-requests select, .thread-pending-requests button'))?.focus()
      return
    }
    if (act === 'stop') {
      stopTurn()
      return
    }
    const sendApi = api?.send
    if (act === 'retry' && sendApi && lastPrompt?.type === 'message') {
      void action(() => sendApi(snapshot.thread.id, lastPrompt.text, lastPrompt.attachments?.map(attachment => attachment.id) ?? []))
      return
    }
    if (act === 'open-pr') {
      workbench.current?.querySelector<HTMLElement>('.thread-tabs [role="tab"]:last-of-type')?.click()
    }
  }
  const welcomeStarters = useMemo(() => threadStarters(), [t])
  const [activeToolTab, setActiveToolTab] = useState<ThreadTabId>('conversation')
  useEffect(() => { setActiveToolTab('conversation') }, [snapshot?.thread.id])
  const orphanPendingRequests = useMemo(
    () => (snapshot ? pendingRequests.filter(req => !snapshot.events.some(ev => ev.type === 'request' && ev.request.id === req.id)) : NO_REQUESTS),
    [snapshot, pendingRequests]
  )
  const showingToolTab = Boolean(snapshot && activeToolTab !== 'conversation')
  // Esc first gives a maximized panel its place back, then closes it.
  return <div ref={workbench} className={`thread-workbench${drawer ? ' is-drawer' : ''}${active ? ' is-active-cell' : ''}${reviewMaximized ? ' is-review-maximized' : ''}`} onPointerDown={onActivate} onKeyDown={event => { if (event.key === 'Escape' && review?.panel && !panel && !commands.open && !openControl && event.target instanceof Element && event.target.closest('.thread-review-host')) { event.preventDefault(); if (reviewMaximized) useThreadWorkbenchStore.getState().setMaximized(null); else { closeReview(); returnFocusFromPanel() } } }}>
    <section className="thread-view" aria-label={t('view.region')} style={{ '--thread-reader-font-size': `${threadFontSize}px` } as React.CSSProperties}>
    <ThreadContextMenu onQuote={text => appendToConversation(quoteMarkdown(text))} />
    <ThreadHeader thread={snapshot?.thread} workspace={workspace} branch={branch?.branch ?? undefined} pending={pending} running={running} activePanel={review?.panel} cell={cell}
      activity={activity} irreversible={irreversible} hasPullRequest={hasPullRequest} onNowAction={handleNowAction} requestInView={requestInView}
      onTogglePanel={togglePanel} onCloseCell={onCloseCell}
      onCommand={command => void action(async () => { setPanel(null); await runCommand(command) })}
      onExport={snapshot && api?.exportPortable ? () => void action(async () => { const path = await api.exportPortable!(snapshot.thread.id); if (path) setPanel({ kind: 'panel', title: t('view.exported'), text: path }) }) : undefined}
      onImport={snapshot && api?.importPortable ? () => { setPending(true); setError(''); void api.importPortable!(snapshot.thread.id).then(imported => { if (imported) useThreadStore.getState().adopt(imported) }).catch(cause => setError(humanizeError(cause, t('view.importFailed')))).finally(() => setPending(false)) } : undefined}
      onDelegate={() => setDelegationOpen(true)} onPin={() => { if (snapshot) void action(() => api!.pin(snapshot.thread.id, !snapshot.thread.pinned)) }} />
    {snapshot && <ThreadToolTabs key={snapshot.thread.id} threadId={snapshot.thread.id} workspaceId={snapshot.thread.workspaceId} rootPath={threadWorkingRoot(snapshot.thread)} branch={branch?.branch ?? undefined}
      activeTab={activeToolTab} onOpen={tab => setActiveToolTab(tab)} onSendToConversation={appendToConversation}
      trailing={<ThreadAddToolMenu activePanel={review?.panel} onTogglePanel={togglePanel} />} />}
    {finding && <ThreadFindBar rows={timelineRows} scrollRoot={timeline} scrollTo={scrollTo} onClose={() => { setFinding(false); requestAnimationFrame(() => textarea.current?.focus()) }} />}
    <div ref={timeline} className="thread-timeline" hidden={showingToolTab} role="region" tabIndex={0} aria-label={t('view.history')} {...scroll.timelineProps}>
      <div ref={scroll.content} className="thread-reading-column">
        {/* Zero-height sticky anchor: the strip overlays the top edge without shifting the rows below. */}
        {snapshot && <div className="thread-sticky-prompt-anchor"><ThreadPromptNavigator rows={timelineRows} scrollRef={timeline} scrollTo={scrollTo} /></div>}
        {snapshot?.page?.hasMore && <button type="button" className="thread-load-earlier" disabled={scroll.loadingEarlier} onClick={() => void scroll.loadEarlier()}>{scroll.loadingEarlier ? <Spinner size="sm" decorative /> : <ArrowUp size={14} />}{t('view.loadEarlier')}</button>}
        {scroll.historyFeedback?.id === shownId && <p className="thread-history-feedback" role={scroll.historyFeedback.error ? 'alert' : 'status'}>{scroll.historyFeedback.text}</p>}
        {!snapshot && selectedId && <div className={cx('thread-opening', skeletonStyles.viewSkeleton)} role="status" aria-label={t('view.opening')} data-view-skeleton=""><Skeleton decorative lines={2} /><Skeleton decorative variant="block" /><Skeleton decorative lines={3} /></div>}
        {!snapshot && !selectedId && <div className="thread-welcome">
          <span className="thread-welcome-mark"><MessageSquarePlus size={26} strokeWidth={1.5} /></span>
          <h2>{t('view.welcomeTitle')}</h2>
          <p>{t('view.welcomeBody')}</p>
          <div className="thread-welcome-actions">
            {onNewThread && <Button variant="primary" icon={<MessageSquarePlus size={14} />} onClick={onNewThread}>{t('view.newConversation')}</Button>}
          </div>
          {onNewThread && <div className="thread-opening-starters">
            {welcomeStarters.map(starter => <Button key={starter.id} variant="secondary" className="thread-opening-starter" onClick={onNewThread}><strong>{starter.label}</strong><span>{starter.prompt}</span></Button>)}
          </div>}
        </div>}
        <ThreadTimelineWindow key={snapshot?.thread.id ?? 'empty'} rows={timelineRows} scrollRef={timeline} followingRef={scroll.following} onViewportUpdateRef={scroll.updateTimelineViewport} scrollToRef={scrollToRow}>{row => <ThreadTimelineEntry row={row} snapshot={snapshot} viewMode={viewMode} running={running} pending={pending} pendingRequests={pendingRequests}
          lastResult={lastResult} lastMessageId={lastConversationMessage?.id} quickReplies={quickReplies} copiedMessageId={copiedMessageId} action={action} runCommand={runCommand}
          onCopy={(id, text) => void copyMessage(id, text)} onPermissions={() => setOpenControl('permissions')} onQuote={text => appendToConversation(quoteMarkdown(text))} onDraft={appendToConversation}
          onQuickReply={value => { useThreadStore.getState().setDraft(snapshot!.thread.id, value); requestAnimationFrame(() => textarea.current?.focus()) }} onToggleFold={toggleFold} />}</ThreadTimelineWindow>
        {pendingMessage && <article className="thread-message thread-message-user thread-message-outgoing" aria-label={t('view.sendingMessage')}>{pendingMessage.attachments.length > 0 && <ul className="thread-sent-attachments" aria-label={t('view.attachments')}>{pendingMessage.attachments.map(attachment => <li key={attachment.id} title={attachment.name}><ImageIcon size={14} aria-hidden="true" /><span>{attachment.name}</span><small>{t('view.kilobytes', { size: formatNumber(Math.ceil(attachment.bytes / 1024)) })}</small></li>)}</ul>}<ThreadMessageBody text={pendingMessage.text} role="user" /><small className="thread-message-outgoing-status">{t('view.sending')}</small></article>}
        {snapshot && !pendingMessage && !snapshot.page?.hasMore && !lastPrompt && snapshot.thread.status === 'idle'
          && <ThreadEmptyState thread={snapshot.thread} branch={branch?.branch} onStarter={prompt => { useThreadStore.getState().setDraft(snapshot.thread.id, prompt); requestAnimationFrame(() => textarea.current?.focus()) }} />}
        {snapshot && <ThreadLiveActivity snapshot={snapshot} />}
      </div>
    </div>
    {(Boolean(snapshot) || Boolean(error) || !api) && !showingToolTab && <div className="thread-composer-dock"><div className="thread-composer-column">
      {snapshot && <ThreadAnnouncer thread={snapshot.thread} pendingRequests={pendingRequests.length} />}
      {snapshot && <ThreadDockRequests snapshot={snapshot} pendingRequests={orphanPendingRequests} waiting={pendingRequests.length} pending={pending} action={action} />}
      {scroll.showEnd && <button type="button" className="thread-scroll-end" onClick={scrollEnd}><ArrowDown size={12} />{scroll.newMessages > 0 ? t('view.latestCount', { count: scroll.newMessages }) : t('view.latest')}</button>}
      {snapshot && needsLogin && <div className="thread-connection-notice"><AlertCircle size={14} /><span>{authFailure ? t('view.signIn', { provider: threadProductName(snapshot.thread.provider) }) : accountMessage(account)}</span><Button size="sm" variant={authFailure && account?.state === 'connected' ? 'secondary' : 'primary'} onClick={onAccounts}>{authFailure ? t('view.reconnect') : t('view.connect')}</Button>{authFailure && lastPrompt?.type === 'message' && <Button size="sm" variant={account?.state === 'connected' && account.method === 'subscription' ? 'primary' : 'secondary'} title={t('view.resendTitle')} disabled={pending || account?.state !== 'connected' || account.method !== 'subscription'} onClick={() => void action(() => api!.send(snapshot.thread.id, lastPrompt.text, lastPrompt.attachments?.map(attachment => attachment.id) ?? []))}>{t('view.retry')}</Button>}</div>}
      {degradedConnection && !needsLogin && <div className="thread-connection-notice is-warning" role="status"><AlertCircle size={14} /><span>{degradedConnection.detail || t('view.connectionUnavailable')}{degradedConnection.nextRetryAt ? ` ${t('view.retryAfter', { time: formatClock(degradedConnection.nextRetryAt, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) })}` : ''}</span></div>}
      {snapshot && blocksThreadInput(snapshot.thread) && <div className="thread-connection-notice"><TerminalSquare size={14} /><span>{t('view.recoverBody')}</span><button type="button" disabled={pending} onClick={() => void action(returnFromCli)}>{t('view.recover')}</button></div>}
      {(error || !api) && <div className="thread-action-error"><ErrorState compact title={error || t('view.serviceUnavailable')} detail={errorDetail || undefined} actions={error && <>
        {errorDetail && onAccounts ? <Button size="sm" onClick={() => { setError(''); setErrorDetail(''); onAccounts() }}>{t('view.connectAgent')}</Button> : null}
        <Button size="sm" variant="ghost" onClick={() => { setError(''); setErrorDetail('') }}>{t('view.dismissError')}</Button></>} /></div>}
      {snapshot && <ThreadBackgroundShells threadId={snapshot.thread.id} />}
      {snapshot && <ThreadDockPlan events={snapshot.events} />}
      {snapshot && <ThreadDockChanges snapshot={snapshot} running={running} onViewChanges={() => useThreadWorkbenchStore.getState().setView(snapshot.thread.id, { panel: 'changes' })} />}
      {snapshot && <ThreadDockQueue snapshot={snapshot} pending={pending} textarea={textarea} action={action} />}
      {snapshot && <PrStatusBar key={snapshot.thread.id} workspaceId={snapshot.thread.workspaceId} rootPath={snapshot.thread.rootPath} onFix={appendToConversation} onStatus={pr => { setPrThreadId(pr ? snapshot.thread.id : null); onPrStatus(pr) }} />}
      <ThreadComposerForm snapshot={snapshot} draft={draft} attachments={attachments} pending={pending} running={running} active={active} composerState={composerState} textarea={textarea} fileInput={fileInput}
        commands={commands} mentions={mentions} openControl={openControl} onControlClosed={() => setOpenControl(null)} onError={setError} onSend={send} onCaret={setCaret}
        onUpload={files => void uploadFiles(files)} onRemoveAttachment={attachmentId => void removeAttachment(attachmentId)} onInsertMention={insertMention} onInterrupt={stopTurn} />
    </div></div>}
    {panel && <Suspense fallback={null}><ThreadCommandDialog key={`${panel.surface ?? panel.kind}:${panel.title ?? ''}`} panel={panel} snapshot={snapshot} pending={pending} error={error} onError={setError} action={action} runCommand={runCommand} onDelegations={onDelegations}
      onClose={() => { setPanel(null); requestAnimationFrame(() => textarea.current?.focus()) }} /></Suspense>}
    {delegationOpen && snapshot && <DelegationCreateDialog thread={snapshot.thread} onClose={() => setDelegationOpen(false)} />}
  </section>
    {snapshot && review?.panel && <Suspense fallback={null}><ThreadReviewHost snapshot={snapshot} workspace={workspace} panel={review.panel} drawer={drawer} availableWidth={availableWidth} workbench={workbench}
      onClose={() => { closeReview(); if (!drawer) returnFocusFromPanel() }} onReturnFocus={returnFocusFromPanel} onSendToConversation={appendToConversation} onCompact={api?.command ? () => void action(() => runCommand('/compact')) : undefined} /></Suspense>}
  </div>
}
