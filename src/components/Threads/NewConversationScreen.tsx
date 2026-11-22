import { ArrowUp, Check, FolderGit2, GitBranch, Shield } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { THREAD_PROVIDERS, threadAgentName } from '../../../shared/threadProviders'
import { parseThreadWorktreeError, threadWorktreeFailureAdvice, type ThreadWorktreeErrorCode } from '../../../shared/threadWorktree'
import type { ThreadApi, ThreadProvider } from '../../../shared/types/thread'
import { MARK_PATH, MARK_VIEWBOX } from '../../design/brand'
import { useThreadStore } from '../../store/thread.store'
import { Button, ErrorState, IconButton, Menu, Notice, TextField } from '../../ui'
import { errorText, humanizeError } from '../../utils/humanizeError'
import { AgentProviderIcon } from '../Sidebar/AgentProviderIcon'
import { consumePendingNewDraft } from '../Terminal/terminalToChat'
import { threadStarters } from './ThreadEmptyState'
import { readThreadWorktreePref, writeThreadWorktreePref } from './threadWorktreePref'
import styles from './NewConversationScreen.module.css'

type Access = Awaited<ReturnType<NonNullable<ThreadApi['newConversationAccess']>>>

const folderName = (path: string): string => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path

/**
 * A new conversation, in place (OXC-3, OXE-168): where the agent works (project, agent, an isolated worktree, access),
 * the composer and the starters. Nothing exists until the first message: sending it creates the conversation with these
 * choices and sends the text to it. It replaces the NewThreadDialog and keeps its data and its worktree answers.
 * `parentThreadId` is accepted for the parallel chat of OXC-5 (OXE-170), whose behaviour lands with that card.
 */
export function NewConversationScreen({ projectId, rootPath, onCreated }: { projectId: string; rootPath?: string; parentThreadId?: string; onCreated?: (threadId: string) => void }): ReactElement {
  const { t } = useTranslation('thread')
  const titleId = useId()
  const projects = useThreadStore(state => state.projects)
  const choices = useMemo(() => {
    const all = projects.filter(project => !project.hidden).flatMap(project => project.contexts.map(context => ({ rootPath: context.rootPath, projectId: project.projectId, projectName: project.displayName })))
    return all.filter((choice, index) => all.findIndex(other => other.rootPath === choice.rootPath) === index)
  }, [projects])
  const [picked, setPicked] = useState<string | null>(null)
  const context = choices.find(choice => choice.rootPath === picked) ?? choices.find(choice => rootPath ? choice.rootPath === rootPath : choice.projectId === projectId) ?? (rootPath ? undefined : choices[0])
  const [provider, setProvider] = useState<ThreadProvider>('claude')
  // What new conversations start with (Settings › Access); Full access is its factory value.
  const [access, setAccess] = useState<Access | null>(null)
  useEffect(() => {
    let live = true
    void Promise.resolve(window.oxe?.thread?.newConversationAccess?.()).then(value => { if (live && value) setAccess(value) }).catch(() => undefined)
    return () => { live = false }
  }, [])
  // Off until the person turns it on, then remembered for the project, as the dialog did.
  const [chosenWorktree, setChosenWorktree] = useState<boolean | null>(null)
  const inWorktree = chosenWorktree ?? readThreadWorktreePref(context?.projectId)
  const [branch, setBranch] = useState(''), [baseRef, setBaseRef] = useState('')
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false), [error, setError] = useState('')
  // A refusal the person can act on; working in the project folder instead is offered, never done on its own.
  const [failure, setFailure] = useState<{ code: ThreadWorktreeErrorCode; detail: string } | null>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const agent = threadAgentName(provider)
  // A worktree of its own is named by its branch: its folder carries a random suffix nobody chose.
  const folder = inWorktree && branch.trim() ? branch.trim() : folderName(context?.rootPath ?? rootPath ?? '')
  const api = window.oxe?.thread

  const start = async (useWorktree: boolean, allowDirtyBase = false): Promise<void> => {
    const text = draft.trim()
    if (!context || !api || pending || !text) return
    setPending(true); setError(''); setFailure(null)
    const worktree = useWorktree ? { ...(branch.trim() ? { branch: branch.trim() } : {}), ...(baseRef.trim() ? { baseRef: baseRef.trim() } : {}), ...(allowDirtyBase ? { allowDirtyBase } : {}) } : undefined
    let threadId: string
    try {
      const snapshot = await api.create({ projectId: context.projectId, rootPath: context.rootPath, provider, ...(worktree ? { worktree } : {}) })
      // Falling back to the project folder is a one-time answer; it does not change what is remembered.
      if (useWorktree === inWorktree) writeThreadWorktreePref(context.projectId, inWorktree)
      threadId = snapshot.thread.id
      useThreadStore.getState().adopt(snapshot)
      // What a terminal selection left waiting for a new conversation goes to its composer, as with the dialog.
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
  const accessShown: Access = access ?? 'full-access'

  return <section className={styles.screen} aria-labelledby={titleId} data-testid="new-conversation">
    <div className={styles.column}>
      <div className={styles.hero}>
        <svg className={styles.mark} viewBox={MARK_VIEWBOX} width={28} height={28} aria-hidden="true" focusable="false"><path d={MARK_PATH} fill="currentColor" /></svg>
        <h2 id={titleId} data-ui="new-conversation-title" className={styles.title}>{t('opening.title', { agent, folder })}</h2>
      </div>
      <div role="group" aria-label={t('opening.context')} className={styles.pickers}>
        <Menu label={t('dialogs.chooseProject')} items={choices.map(choice => ({ label: `${choice.projectName} · ${folderName(choice.rootPath)}`, icon: choice.rootPath === context?.rootPath ? <Check size={14} /> : undefined, onSelect: () => { setPicked(choice.rootPath); setChosenWorktree(null); setFailure(null) } }))}
          trigger={<Button data-ui="context-picker" className={styles.picker} title={context?.rootPath} disabled={pending || choices.length < 2} icon={<FolderGit2 size={14} aria-hidden="true" />}>{context?.projectName ?? t('dialogs.noProject')}</Button>} />
        <Menu label={t('dialogs.agent')} items={THREAD_PROVIDERS.map(id => ({ label: threadAgentName(id), icon: id === provider ? <Check size={14} /> : undefined, onSelect: () => setProvider(id) }))}
          trigger={<Button data-ui="context-picker" className={styles.picker} disabled={pending} icon={<AgentProviderIcon provider={provider} size={14} />}>{agent}</Button>} />
        <Button data-ui="context-picker" className={styles.picker} role="switch" aria-checked={inWorktree} aria-label={t('dialogs.inWorktree')} disabled={pending}
          icon={<GitBranch size={14} aria-hidden="true" />} onClick={() => { setChosenWorktree(!inWorktree); setFailure(null) }}>{t('dialogs.inWorktreeShort')}</Button>
        <span data-ui="context-picker" className={styles.picker} data-access={accessShown}><Shield size={14} aria-hidden="true" />{t(`opening.access.${accessShown}`)}</span>
      </div>
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
        <textarea ref={textarea} className={styles.message} rows={3} aria-label={t('composer.message')} placeholder={t('opening.label')} value={draft} disabled={pending} autoFocus
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void start(inWorktree) } }} />
        <div className={styles.actions}>
          <IconButton type="submit" variant="primary" label={t('composer.send')} icon={<ArrowUp size={16} aria-hidden="true" />} disabled={pending || !draft.trim() || !context || !api} />
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
