import { ArrowUp, Check, ChevronDown, FolderGit2, FolderPlus, GitBranch, Shield } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { THREAD_PROVIDERS, threadAgentName } from '../../../shared/threadProviders'
import { parseThreadWorktreeError, threadWorktreeFailureAdvice, type ThreadWorktreeErrorCode } from '../../../shared/threadWorktree'
import type { ConversationThread, ThreadApi, ThreadProvider } from '../../../shared/types/thread'
import type { ThreadActiveWriter } from '../../../shared/types/thread-places'
import { workspaceColorAttrs } from '../../../shared/workspace-color'
import { MARK_PATH, MARK_VIEWBOX } from '../../design/brand'
import { useThreadStore } from '../../store/thread.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { Button, ErrorState, IconButton, Kbd, Menu, Notice, Popover, TextField, cx, toast } from '../../ui'
import { errorText, humanizeError } from '../../utils/humanizeError'
import { AgentProviderIcon } from '../Sidebar/AgentProviderIcon'
import { consumePendingNewDraft, newProjectDraftKey, normalizePathForMatch } from '../Terminal/terminalToChat'
import { consumeIsolatedNewConversationHandoff, type IsolatedNewConversationHandoff } from '../Terminal/threadDraftBridge'
import { threadError } from './threadError'
import { threadStarters } from './ThreadEmptyState'
import { displayThreadTitle } from './threadTitle'
import { readThreadWorktreePref, writeThreadWorktreePref } from './threadWorktreePref'
import styles from './NewConversationScreen.module.css'

type Access = Awaited<ReturnType<NonNullable<ThreadApi['newConversationAccess']>>>
interface ProjectChoice { rootPath: string; projectId: string; projectName: string }

const folderName = (path: string): string => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path

/** What new conversations start with (Settings › Access): null until read, and never guessed when the read fails. */
function useNewConversationAccess(): Access | 'unreadable' | null {
  const [access, setAccess] = useState<Access | 'unreadable' | null>(null)
  useEffect(() => {
    let live = true
    void Promise.resolve(window.oxe?.thread?.newConversationAccess?.())
      .then(value => { if (live) setAccess(value ?? 'unreadable') })
      .catch(() => { if (live) setAccess('unreadable') })
    return () => { live = false }
  }, [])
  return access
}

/** The agents that can be picked. Only 'missing' is not installed; until a read answers, or when it fails, all are. */
function useInstalledAgents(): readonly ThreadProvider[] {
  const [missing, setMissing] = useState<readonly string[]>([])
  useEffect(() => {
    let live = true
    void Promise.resolve(window.oxe?.agent?.getReadiness?.())
      .then(list => { if (live && list) setMissing(list.filter(item => item.status === 'missing').map(item => item.provider)) })
      .catch(() => undefined)
    return () => { live = false }
  }, [])
  return useMemo(() => THREAD_PROVIDERS.filter(id => !missing.includes(id)), [missing])
}

/** Active writers (running conversations with write access or working Code panes) editing `folder` (AG-07, OXE-189). */
function fallbackActiveWriters(folder: string, threads: readonly ConversationThread[]): ThreadActiveWriter[] {
  const target = normalizePathForMatch(folder)
  if (!target) return []
  return threads
    .filter(thread => {
      if (thread.archived) return false
      const working = thread.status === 'running' || (thread.background?.running ?? 0) > 0
      if (!working) return false
      if (thread.access === 'read-only' || (thread.access as string | undefined) === 'readonly') return false
      const activeFolder = thread.observedLocation?.sameRepository && thread.observedLocation.checkoutRoot
        ? thread.observedLocation.checkoutRoot
        : (thread.ownedWorktree?.path || thread.rootPath)
      return normalizePathForMatch(activeFolder) === target
    })
    .map(thread => ({ id: thread.id, title: thread.title, kind: 'thread' as const }))
}

function useActiveWriters(folder: string, threads: readonly ConversationThread[]): readonly ThreadActiveWriter[] {
  const [remote, setRemote] = useState<{ folder: string; writers: readonly ThreadActiveWriter[] } | null>(null)
  const hasRemoteLookup = typeof window.oxe?.thread?.activeWriters === 'function'
  const fallback = useMemo(() => (hasRemoteLookup ? [] : fallbackActiveWriters(folder, threads)), [hasRemoteLookup, folder, threads])

  useEffect(() => {
    const api = window.oxe?.thread
    if (!folder || typeof api?.activeWriters !== 'function') return
    let live = true
    const load = (): void => {
      void Promise.resolve(api.activeWriters!(folder))
        .then(list => { if (live) setRemote({ folder, writers: Array.isArray(list) ? list : [] }) })
        .catch(() => { if (live) setRemote({ folder, writers: [] }) })
    }
    load()
    const off = api.onChanged?.(() => load())
    return () => { live = false; off?.() }
  }, [folder, threads])

  return hasRemoteLookup ? (remote?.folder === folder ? remote.writers : []) : fallback
}

/**
 * The message, with what a terminal selection left waiting for this project or folder (AG-08). Only sending clears the
 * waiting text from the store, so leaving the screen does not lose it; only what is new is added to the message.
 */
function useMessage(projectId: string, rootPath: string, initialDraft = '') {
  const [draft, setDraft] = useState(initialDraft)
  const shown = useRef(new Map<string, string>())
  useEffect(() => {
    const folder = normalizePathForMatch(rootPath)
    const take = (): void => {
      for (const [key, value] of Object.entries(useThreadStore.getState().drafts)) {
        if (!key.startsWith('new:')) continue
        const forProject = projectId !== '' && key === newProjectDraftKey(projectId)
        if (!forProject && (!folder || normalizePathForMatch(key.slice(4)) !== folder)) continue
        const before = shown.current.get(key) ?? ''
        if (value === before) continue
        shown.current.set(key, value)
        const added = value.startsWith(before) ? value.slice(before.length) : value
        if (added.trim()) setDraft(current => current.trim() ? `${current.trimEnd()}\n\n${added.trimStart()}` : added)
      }
    }
    take()
    return useThreadStore.subscribe(take)
  }, [projectId, rootPath])
  /** Call when sending starts; the function it returns drops what that message carried, and only that. */
  const carried = (): (() => void) => {
    const sent = [...shown.current]
    return () => {
      for (const [key, value] of sent) {
        const { drafts, setDraft: store } = useThreadStore.getState()
        const now = drafts[key] ?? ''
        if (value && now.startsWith(value)) store(key, now.slice(value.length))
      }
    }
  }
  return { draft, setDraft, carried }
}

/** Project picker: every project folder with its color and full path, a filter, and Add project. */
function ProjectPicker({ choices, selected, disabled, locked = false, onPick, onAdd }: { choices: ProjectChoice[]; selected?: ProjectChoice; disabled: boolean; locked?: boolean; onPick: (choice: ProjectChoice) => void; onAdd?: () => void }): ReactElement {
  const { t } = useTranslation('thread')
  const workspaces = useWorkspaceStore(state => state.workspaces)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const change = (next: boolean): void => { setOpen(next); if (!next) setQuery('') }
  const found = choices.filter(choice => `${choice.projectName} ${choice.rootPath}`.toLowerCase().includes(query.trim().toLowerCase()))
  return <Popover label={t('dialogs.chooseProject')} open={open} onOpenChange={change}
    trigger={<Button data-ui="context-picker" data-picker-kind="select" className={cx(styles.picker, styles.selectPicker)} title={selected?.rootPath} disabled={disabled} icon={<FolderGit2 size={14} aria-hidden="true" />}>
      <span>{selected?.projectName ?? t('dialogs.noProject')}</span>
      {!locked && <ChevronDown size={12} className={styles.chevron} aria-hidden="true" />}
    </Button>}>
    <div className={styles.projects}>
      <TextField aria-label={t('dialogs.filterProjects')} placeholder={t('dialogs.filterProjects')} value={query} onChange={event => setQuery(event.target.value)} />
      <div className={styles.options}>
        {found.length > 0 ? found.map(choice => {
          const color = workspaces.find(workspace => workspace.rootPath === choice.rootPath)?.color ?? null
          const current = choice.rootPath === selected?.rootPath
          return <Button key={choice.rootPath} variant="ghost" className={styles.option} aria-pressed={current} onClick={() => { onPick(choice); change(false) }}>
            <span data-ui="project-dot" className={styles.dot} aria-hidden="true" {...workspaceColorAttrs({ id: choice.projectId, color: typeof color === 'string' ? null : color })} />
            <span className={styles.optionText}><strong>{choice.projectName}</strong><code>{choice.rootPath}</code></span>
            {current && <Check size={14} aria-hidden="true" />}
          </Button>
        }) : <p className={styles.noMatch}>{t('dialogs.noProjectMatch')}</p>}
      </div>
      {onAdd && <div className={styles.addFooter}>
        <Button variant="ghost" className={styles.addOption} icon={<FolderPlus size={14} aria-hidden="true" />} onClick={() => { change(false); onAdd() }}>{t('dialogs.add')}</Button>
      </div>}
    </div>
  </Popover>
}

/**
 * A new conversation, in place (OXC-3, OXE-168): where the agent works (project, agent, an isolated worktree, access),
 * the composer and the starters. Nothing exists until the first message: sending it creates the conversation with these
 * choices and sends the text to it. It replaces the NewThreadDialog and keeps its data and its worktree answers.
 * With `parentThreadId` it starts a parallel chat of that conversation's session (OXC-5, OXE-170): headed by the parent,
 * the project locked on the parent's and the worktree on the session's, the agent still free; the first message creates
 * the chat with createChat on the parent, never thread.create, and sends the text to it.
 */
export function NewConversationScreen({ projectId, rootPath, parentThreadId, onCreated, onAddProject, onOpenIsolated }: { projectId: string; rootPath?: string; parentThreadId?: string; onCreated?: (threadId: string) => void; onAddProject?: () => void; onOpenIsolated?: (handoff: IsolatedNewConversationHandoff) => void }): ReactElement {
  const { t } = useTranslation('thread')
  const titleId = useId()
  const [initialHandoff] = useState<IsolatedNewConversationHandoff | null>(() => parentThreadId ? null : consumeIsolatedNewConversationHandoff(projectId, rootPath))
  const [detachedParallel, setDetachedParallel] = useState(false)
  const effectiveParentId = detachedParallel ? undefined : parentThreadId
  const projects = useThreadStore(state => state.projects)
  const threads = useThreadStore(state => state.threads)
  const parent = useMemo(() => (effectiveParentId ? threads.find(thread => thread.id === effectiveParentId) : undefined), [effectiveParentId, threads])
  const parallel = Boolean(effectiveParentId)
  const choices = useMemo(() => {
    const all: ProjectChoice[] = projects.filter(project => !project.hidden).flatMap(project => project.contexts.map(context => ({ rootPath: context.rootPath, projectId: project.projectId, projectName: project.displayName })))
    return all.filter((choice, index) => all.findIndex(other => other.rootPath === choice.rootPath) === index)
  }, [projects])
  const [picked, setPicked] = useState<string | null>(null)
  // A folder that is no project is offered to be added; another project is never used in its place.
  // A parallel chat stays in its parent's project: no pick, no folder of its own.
  const context = parallel
    ? choices.find(choice => choice.projectId === (parent?.projectId ?? projectId))
    : choices.find(choice => choice.rootPath === picked)
    ?? choices.find(choice => rootPath ? normalizePathForMatch(choice.rootPath) === normalizePathForMatch(rootPath) : choice.projectId === projectId)
    ?? (rootPath ? undefined : choices[0])
  const installed = useInstalledAgents()
  const [chosenAgent, setChosenAgent] = useState<ThreadProvider | null>(() => initialHandoff?.provider ?? null)
  const provider: ThreadProvider | undefined = chosenAgent && installed.includes(chosenAgent) ? chosenAgent : installed[0]
  const access = useNewConversationAccess()
  // Off until the person turns it on, then remembered for the project, as the dialog did.
  const [chosenWorktree, setChosenWorktree] = useState<boolean | null>(() => (initialHandoff ? true : null))
  // A parallel chat works in the session's folder or worktree and never owns one (OXE-170 RN-2).
  const inWorktree = !parallel && (chosenWorktree ?? readThreadWorktreePref(context?.projectId))
  const [branch, setBranch] = useState(''), [baseRef, setBaseRef] = useState('')
  const { draft, setDraft, carried } = useMessage(context?.projectId ?? projectId, context?.rootPath ?? rootPath ?? '', initialHandoff?.draft ?? '')
  const [pending, setPending] = useState(false), [error, setError] = useState('')
  // A refusal the person can act on; working in the project folder instead is offered, never done on its own.
  const [failure, setFailure] = useState<{ code: ThreadWorktreeErrorCode; detail: string } | null>(null)
  const [dismissedWarningKey, setDismissedWarningKey] = useState<string | null>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const agent = threadAgentName(provider ?? THREAD_PROVIDERS[0])
  // A worktree of its own is named by its branch: its folder carries a random suffix nobody chose.
  const folder = inWorktree && branch.trim() ? branch.trim() : folderName(context?.rootPath ?? rootPath ?? '')
  const targetFolder = parallel
    ? (parent?.ownedWorktree?.path || parent?.rootPath || context?.rootPath || rootPath || '')
    : (context?.rootPath ?? rootPath ?? '')
  const activeWriters = useActiveWriters(targetFolder, threads)
  const warningKey = parallel ? `parallel:${effectiveParentId ?? ''}:${targetFolder}` : `folder:${targetFolder}`
  const showFolderWarning = !parallel && !inWorktree && activeWriters.length > 0 && dismissedWarningKey !== warningKey
  const showParallelWarning = parallel && activeWriters.length > 0 && dismissedWarningKey !== warningKey
  const api = window.oxe?.thread

  const openIsolated = (): void => {
    const nextProjectId = context?.projectId ?? parent?.projectId ?? projectId
    const nextRootPath = parent?.ownedWorktree?.projectRoot ?? context?.rootPath ?? rootPath
    setDetachedParallel(true)
    if (nextRootPath) setPicked(nextRootPath)
    setChosenWorktree(true)
    if (provider) setChosenAgent(provider)
    setDismissedWarningKey(null)
    setFailure(null)
    if (onOpenIsolated) {
      onOpenIsolated({ projectId: nextProjectId, rootPath: nextRootPath, provider, draft })
      return
    }
    window.dispatchEvent(new CustomEvent('oxe:open-thread-draft', {
      detail: {
        threadId: null,
        projectId: nextProjectId,
        rootPath: nextRootPath,
        isolated: { provider, draft }
      }
    }))
  }

  const start = async (useWorktree: boolean, allowDirtyBase = false): Promise<void> => {
    const text = draft.trim()
    if (!context || !api || !provider || pending || !text || (parallel && !api.createChat)) return
    const dropCarried = carried()
    setPending(true); setError(''); setFailure(null)
    const worktree = useWorktree ? { ...(branch.trim() ? { branch: branch.trim() } : {}), ...(baseRef.trim() ? { baseRef: baseRef.trim() } : {}), ...(allowDirtyBase ? { allowDirtyBase } : {}) } : undefined
    let threadId: string
    try {
      const snapshot = effectiveParentId
        ? await api.createChat!(effectiveParentId, { provider })
        : await api.create({ projectId: context.projectId, rootPath: context.rootPath, provider, ...(worktree ? { worktree } : {}) })
      // Falling back to the project folder is a one-time answer; it does not change what is remembered.
      if (!parallel && useWorktree === inWorktree) writeThreadWorktreePref(context.projectId, inWorktree)
      threadId = snapshot.thread.id
      useThreadStore.getState().adopt(snapshot)
      dropCarried()
      // A selection that arrived while the conversation was being created waits in its composer.
      consumePendingNewDraft({ threadId, projectId: context.projectId, rootPath: context.rootPath })
    } catch (cause) {
      // A worktree refusal names its cause (branch exists, not a repository…); show it instead of a generic line.
      const parsed = worktree ? parseThreadWorktreeError(cause instanceof Error ? cause.message : String(cause)) : null
      if (parsed) setFailure({ code: parsed.code, detail: parsed.message })
      else setError(worktree ? (errorText(cause) ? humanizeError(cause) : t('dialogs.worktreeFailed')) : parallel && errorText(cause) ? humanizeError(cause) : t('dialogs.createFailed'))
      setPending(false)
      return
    }
    // The conversation exists now; a failed send leaves the text in its composer and explains why (OXE-407).
    try { await api.send(threadId, text) } catch (cause) {
      const waiting = useThreadStore.getState().drafts[threadId]
      useThreadStore.getState().setDraft(threadId, waiting ? `${text}\n\n${waiting}` : text)
      const reason = threadError(cause)
      setError(reason)
      toast({ title: reason, intent: 'warning' })
    }
    setPending(false)
    onCreated?.(threadId)
  }
  const advice = failure ? threadWorktreeFailureAdvice(failure.code) : null
  const pickProject = (choice: ProjectChoice): void => { setPicked(choice.rootPath); setChosenWorktree(null); setFailure(null); setDismissedWarningKey(null) }

  return <section className={styles.screen} aria-labelledby={titleId} data-testid="new-conversation">
    <div className={styles.column}>
      <div className={styles.hero}>
        <svg className={styles.mark} viewBox={MARK_VIEWBOX} width={28} height={28} aria-hidden="true" focusable="false"><path d={MARK_PATH} fill="currentColor" /></svg>
        <h2 id={titleId} data-ui="new-conversation-title" className={styles.title}>{parallel ? t('parallel.title', { title: displayThreadTitle(parent?.title) }) : t('opening.title', { agent, folder })}</h2>
      </div>
      <div role="group" aria-label={t('opening.context')} className={styles.pickers}>
        <ProjectPicker choices={choices} selected={context} disabled={pending || parallel} locked={parallel} onPick={pickProject} onAdd={onAddProject} />
        <Menu label={t('dialogs.agent')} items={installed.map(id => ({ label: threadAgentName(id), icon: id === provider ? <Check size={14} /> : undefined, onSelect: () => setChosenAgent(id) }))}
          trigger={<Button data-ui="context-picker" data-picker-kind="select" className={cx(styles.picker, styles.selectPicker)} disabled={pending || !provider} icon={provider && <AgentProviderIcon provider={provider} size={14} />}>
            <span>{provider ? agent : t('opening.noAgent')}</span>
            <ChevronDown size={12} className={styles.chevron} aria-hidden="true" />
          </Button>} />
        {parallel
          ? <span data-ui="context-picker" data-picker-kind="status" className={cx(styles.picker, styles.statusTag)} data-locked="true"><GitBranch size={14} aria-hidden="true" />{t('parallel.locked')}</span>
          : <Button data-ui="context-picker" data-picker-kind="toggle" variant="ghost" className={cx(styles.picker, styles.togglePicker)} role="switch" aria-checked={inWorktree} aria-label={t('dialogs.inWorktree')} disabled={pending}
            icon={<GitBranch size={14} aria-hidden="true" />} onClick={() => { setChosenWorktree(!inWorktree); setFailure(null) }}>
            <span>{t('dialogs.inWorktreeShort')}</span>
            <span className={styles.toggleTrack} aria-hidden="true"><span className={styles.toggleThumb} /></span>
          </Button>}
        <span data-ui="context-picker" data-picker-kind="status" className={cx(styles.picker, styles.statusTag)} data-access={access ?? undefined} aria-busy={access === null}>
          <Shield size={14} aria-hidden="true" />{access === 'unreadable' ? t('opening.accessUnreadable') : access && t(`opening.access.${access}`)}
        </span>
      </div>
      {parallel && <Notice intent="info">{t('parallel.notice')}</Notice>}
      {!parallel && !context && onAddProject && <div className={styles.unregistered}>
        {rootPath && <code>{rootPath}</code>}
        <Button icon={<FolderPlus size={14} aria-hidden="true" />} onClick={onAddProject}>{t('dialogs.add')}</Button>
      </div>}
      {inWorktree && <div className={styles.worktree}>
        <p className={styles.hint}>{t('dialogs.inWorktreeHint')}</p>
        <div className={styles.fields}>
          <TextField label={t('dialogs.branch')} mono value={branch} placeholder={t('dialogs.branchPlaceholder')} onChange={event => setBranch(event.target.value)} disabled={pending} />
          <TextField label={t('dialogs.startFrom')} mono value={baseRef} placeholder={t('dialogs.startFromPlaceholder')} onChange={event => setBaseRef(event.target.value)} disabled={pending} />
        </div>
      </div>}
      {error && <ErrorState compact title={error} />}
      {failure && advice && <Notice intent={advice.canContinue ? 'warning' : 'danger'}
        title={t(`dialogs.worktreeError.${failure.code}`, { branch: branch.trim(), base: baseRef.trim(), detail: failure.detail })}
        actions={<>
          {advice.canContinue && <Button size="sm" disabled={pending} onClick={() => void start(true, true)}>{t('dialogs.worktreeContinue')}</Button>}
          <Button size="sm" disabled={pending} onClick={() => void start(false)}>{t('dialogs.worktreeUseProject')}</Button>
        </>}>
        {t(`dialogs.worktreeAdvice.${failure.code}`)}
      </Notice>}
      {showFolderWarning && <Notice intent="warning" className={styles.collisionNotice} actions={<>
        <Button size="sm" variant="primary" disabled={pending} onClick={() => { setChosenWorktree(true); setFailure(null) }}>{t('collision.createWorktree')}</Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setDismissedWarningKey(warningKey)}>{t('collision.continueHere')}</Button>
      </>}>
        {t('collision.editingFolder', { conversation: displayThreadTitle(activeWriters[0]?.title), interpolation: { escapeValue: false } })}
      </Notice>}
      {showParallelWarning && <Notice intent="warning" className={styles.collisionNotice} actions={<>
        <Button size="sm" variant="primary" disabled={pending} onClick={openIsolated}>{t('collision.openIsolated')}</Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setDismissedWarningKey(warningKey)}>{t('collision.continueHere')}</Button>
      </>}>
        {t('collision.parallelEditing')}
      </Notice>}
      <form data-ui="composer" className={styles.composer} aria-busy={pending} onSubmit={event => { event.preventDefault(); void start(inWorktree) }}>
        <textarea ref={textarea} data-thread-composer="true" className={styles.message} rows={3} aria-label={t('composer.message')} placeholder={t('opening.label')} value={draft} disabled={pending} autoFocus
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void start(inWorktree) } }} />
        <div className={styles.actions}>
          <span className={styles.composerHint} data-ui="composer-hint">
            <span className={styles.hintItem}><Kbd>Enter</Kbd><span>{t('opening.hintSend')}</span></span>
            <span className={styles.hintSeparator} aria-hidden="true">·</span>
            <span className={styles.hintItem}><Kbd>Shift+Enter</Kbd><span>{t('opening.hintNewLine')}</span></span>
          </span>
          <IconButton type="submit" variant="primary" className={styles.sendButton} label={t('composer.send')} title={t('composer.sendTitle', { key: 'Enter' })} icon={<ArrowUp size={16} aria-hidden="true" />} disabled={pending || !draft.trim() || !context || !api || !provider || (parallel && !api.createChat)} />
        </div>
      </form>
      <div className={styles.starters} role="group" aria-label={t('opening.starters')}>
        {threadStarters().map(starter => <Button key={starter.id} data-ui="starter" className={styles.starter} title={starter.prompt} disabled={pending}
          onClick={() => { setDraft(starter.prompt); requestAnimationFrame(() => textarea.current?.focus()) }}>
          <strong>{starter.label}</strong><span>{starter.prompt}</span>
        </Button>)}
      </div>
    </div>
  </section>
}
