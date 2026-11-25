import { ArrowUp, Check, FolderGit2, GitBranch, Plus, Shield } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { THREAD_PROVIDERS, threadAgentName } from '../../../shared/threadProviders'
import { parseThreadWorktreeError, threadWorktreeFailureAdvice, type ThreadWorktreeErrorCode } from '../../../shared/threadWorktree'
import type { ThreadApi, ThreadProvider } from '../../../shared/types/thread'
import { workspaceColorAttrs } from '../../../shared/workspace-color'
import { MARK_PATH, MARK_VIEWBOX } from '../../design/brand'
import { useThreadStore } from '../../store/thread.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { Button, ErrorState, IconButton, Menu, Notice, Popover, TextField } from '../../ui'
import { errorText, humanizeError } from '../../utils/humanizeError'
import { AgentProviderIcon } from '../Sidebar/AgentProviderIcon'
import { consumePendingNewDraft, newProjectDraftKey, normalizePathForMatch } from '../Terminal/terminalToChat'
import { threadStarters } from './ThreadEmptyState'
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

/**
 * The message, with what a terminal selection left waiting for this project or folder (AG-08). Only sending clears the
 * waiting text from the store, so leaving the screen does not lose it; only what is new is added to the message.
 */
function useMessage(projectId: string, rootPath: string) {
  const [draft, setDraft] = useState('')
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
function ProjectPicker({ choices, selected, disabled, onPick, onAdd }: { choices: ProjectChoice[]; selected?: ProjectChoice; disabled: boolean; onPick: (choice: ProjectChoice) => void; onAdd?: () => void }): ReactElement {
  const { t } = useTranslation('thread')
  const workspaces = useWorkspaceStore(state => state.workspaces)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const change = (next: boolean): void => { setOpen(next); if (!next) setQuery('') }
  const found = choices.filter(choice => `${choice.projectName} ${choice.rootPath}`.toLowerCase().includes(query.trim().toLowerCase()))
  return <Popover label={t('dialogs.chooseProject')} open={open} onOpenChange={change}
    trigger={<Button data-ui="context-picker" className={styles.picker} title={selected?.rootPath} disabled={disabled} icon={<FolderGit2 size={14} aria-hidden="true" />}>{selected?.projectName ?? t('dialogs.noProject')}</Button>}>
    <div className={styles.projects}>
      <TextField aria-label={t('dialogs.filterProjects')} placeholder={t('dialogs.filterProjects')} value={query} onChange={event => setQuery(event.target.value)} />
      <div className={styles.options}>
        {found.map(choice => {
          const color = workspaces.find(workspace => workspace.rootPath === choice.rootPath)?.color ?? null
          const current = choice.rootPath === selected?.rootPath
          return <Button key={choice.rootPath} variant="ghost" className={styles.option} aria-pressed={current} onClick={() => { onPick(choice); change(false) }}>
            <span data-ui="project-dot" className={styles.dot} aria-hidden="true" {...workspaceColorAttrs({ id: choice.projectId, color: typeof color === 'string' ? null : color })} />
            <span className={styles.optionText}><strong>{choice.projectName}</strong><code>{choice.rootPath}</code></span>
            {current && <Check size={14} aria-hidden="true" />}
          </Button>
        })}
      </div>
      {onAdd && <Button variant="ghost" icon={<Plus size={14} aria-hidden="true" />} onClick={() => { change(false); onAdd() }}>{t('dialogs.add')}</Button>}
    </div>
  </Popover>
}

/**
 * A new conversation, in place (OXC-3, OXE-168): where the agent works (project, agent, an isolated worktree, access),
 * the composer and the starters. Nothing exists until the first message: sending it creates the conversation with these
 * choices and sends the text to it. It replaces the NewThreadDialog and keeps its data and its worktree answers.
 * `parentThreadId` is accepted for the parallel chat of OXC-5 (OXE-170), whose behaviour lands with that card.
 */
export function NewConversationScreen({ projectId, rootPath, onCreated, onAddProject }: { projectId: string; rootPath?: string; parentThreadId?: string; onCreated?: (threadId: string) => void; onAddProject?: () => void }): ReactElement {
  const { t } = useTranslation('thread')
  const titleId = useId()
  const projects = useThreadStore(state => state.projects)
  const choices = useMemo(() => {
    const all: ProjectChoice[] = projects.filter(project => !project.hidden).flatMap(project => project.contexts.map(context => ({ rootPath: context.rootPath, projectId: project.projectId, projectName: project.displayName })))
    return all.filter((choice, index) => all.findIndex(other => other.rootPath === choice.rootPath) === index)
  }, [projects])
  const [picked, setPicked] = useState<string | null>(null)
  // A folder that is no project is offered to be added; another project is never used in its place.
  const context = choices.find(choice => choice.rootPath === picked)
    ?? choices.find(choice => rootPath ? normalizePathForMatch(choice.rootPath) === normalizePathForMatch(rootPath) : choice.projectId === projectId)
    ?? (rootPath ? undefined : choices[0])
  const installed = useInstalledAgents()
  const [chosenAgent, setChosenAgent] = useState<ThreadProvider | null>(null)
  const provider: ThreadProvider | undefined = chosenAgent && installed.includes(chosenAgent) ? chosenAgent : installed[0]
  const access = useNewConversationAccess()
  // Off until the person turns it on, then remembered for the project, as the dialog did.
  const [chosenWorktree, setChosenWorktree] = useState<boolean | null>(null)
  const inWorktree = chosenWorktree ?? readThreadWorktreePref(context?.projectId)
  const [branch, setBranch] = useState(''), [baseRef, setBaseRef] = useState('')
  const { draft, setDraft, carried } = useMessage(context?.projectId ?? projectId, context?.rootPath ?? rootPath ?? '')
  const [pending, setPending] = useState(false), [error, setError] = useState('')
  // A refusal the person can act on; working in the project folder instead is offered, never done on its own.
  const [failure, setFailure] = useState<{ code: ThreadWorktreeErrorCode; detail: string } | null>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const agent = threadAgentName(provider ?? THREAD_PROVIDERS[0])
  // A worktree of its own is named by its branch: its folder carries a random suffix nobody chose.
  const folder = inWorktree && branch.trim() ? branch.trim() : folderName(context?.rootPath ?? rootPath ?? '')
  const api = window.oxe?.thread

  const start = async (useWorktree: boolean, allowDirtyBase = false): Promise<void> => {
    const text = draft.trim()
    if (!context || !api || !provider || pending || !text) return
    const dropCarried = carried()
    setPending(true); setError(''); setFailure(null)
    const worktree = useWorktree ? { ...(branch.trim() ? { branch: branch.trim() } : {}), ...(baseRef.trim() ? { baseRef: baseRef.trim() } : {}), ...(allowDirtyBase ? { allowDirtyBase } : {}) } : undefined
    let threadId: string
    try {
      const snapshot = await api.create({ projectId: context.projectId, rootPath: context.rootPath, provider, ...(worktree ? { worktree } : {}) })
      // Falling back to the project folder is a one-time answer; it does not change what is remembered.
      if (useWorktree === inWorktree) writeThreadWorktreePref(context.projectId, inWorktree)
      threadId = snapshot.thread.id
      useThreadStore.getState().adopt(snapshot)
      dropCarried()
      // A selection that arrived while the conversation was being created waits in its composer.
      consumePendingNewDraft({ threadId, projectId: context.projectId, rootPath: context.rootPath })
    } catch (cause) {
      // A worktree refusal names its cause (branch exists, not a repository…); show it instead of a generic line.
      const parsed = worktree ? parseThreadWorktreeError(cause instanceof Error ? cause.message : String(cause)) : null
      if (parsed) setFailure({ code: parsed.code, detail: parsed.message })
      else setError(worktree ? (errorText(cause) ? humanizeError(cause) : t('dialogs.worktreeFailed')) : t('dialogs.createFailed'))
      setPending(false)
      return
    }
    // The conversation exists now; a failed send leaves the text in its composer instead of losing it.
    try { await api.send(threadId, text) } catch {
      const waiting = useThreadStore.getState().drafts[threadId]
      useThreadStore.getState().setDraft(threadId, waiting ? `${text}\n\n${waiting}` : text)
    }
    setPending(false)
    onCreated?.(threadId)
  }
  const advice = failure ? threadWorktreeFailureAdvice(failure.code) : null
  const pickProject = (choice: ProjectChoice): void => { setPicked(choice.rootPath); setChosenWorktree(null); setFailure(null) }

  return <section className={styles.screen} aria-labelledby={titleId} data-testid="new-conversation">
    <div className={styles.column}>
      <div className={styles.hero}>
        <svg className={styles.mark} viewBox={MARK_VIEWBOX} width={28} height={28} aria-hidden="true" focusable="false"><path d={MARK_PATH} fill="currentColor" /></svg>
        <h2 id={titleId} data-ui="new-conversation-title" className={styles.title}>{t('opening.title', { agent, folder })}</h2>
      </div>
      <div role="group" aria-label={t('opening.context')} className={styles.pickers}>
        <ProjectPicker choices={choices} selected={context} disabled={pending} onPick={pickProject} onAdd={onAddProject} />
        <Menu label={t('dialogs.agent')} items={installed.map(id => ({ label: threadAgentName(id), icon: id === provider ? <Check size={14} /> : undefined, onSelect: () => setChosenAgent(id) }))}
          trigger={<Button data-ui="context-picker" className={styles.picker} disabled={pending || !provider} icon={provider && <AgentProviderIcon provider={provider} size={14} />}>{provider ? agent : t('opening.noAgent')}</Button>} />
        <Button data-ui="context-picker" className={styles.picker} role="switch" aria-checked={inWorktree} aria-label={t('dialogs.inWorktree')} disabled={pending}
          icon={<GitBranch size={14} aria-hidden="true" />} onClick={() => { setChosenWorktree(!inWorktree); setFailure(null) }}>{t('dialogs.inWorktreeShort')}</Button>
        <span data-ui="context-picker" className={styles.picker} data-access={access ?? undefined} aria-busy={access === null}>
          <Shield size={14} aria-hidden="true" />{access === 'unreadable' ? t('opening.accessUnreadable') : access && t(`opening.access.${access}`)}
        </span>
      </div>
      {!context && onAddProject && <div className={styles.unregistered}>
        {rootPath && <code>{rootPath}</code>}
        <Button icon={<Plus size={14} aria-hidden="true" />} onClick={onAddProject}>{t('dialogs.add')}</Button>
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
      <form data-ui="composer" className={styles.composer} aria-busy={pending} onSubmit={event => { event.preventDefault(); void start(inWorktree) }}>
        <textarea ref={textarea} data-thread-composer="true" className={styles.message} rows={3} aria-label={t('composer.message')} placeholder={t('opening.label')} value={draft} disabled={pending} autoFocus
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void start(inWorktree) } }} />
        <div className={styles.actions}>
          <IconButton type="submit" variant="primary" label={t('composer.send')} icon={<ArrowUp size={16} aria-hidden="true" />} disabled={pending || !draft.trim() || !context || !api || !provider} />
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
