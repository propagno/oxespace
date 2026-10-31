import { Check, FolderOpen } from 'lucide-react'
import { useState } from 'react'
import type { ThreadProvider } from '../../../shared/types/thread'
import { useThreadStore } from '../../store/thread.store'
import { AgentProviderIcon } from '../Sidebar/AgentProviderIcon'
import { useTranslation } from 'react-i18next'
import { Button, Checkbox, Dialog, EmptyState, ErrorState, TextField, Notice } from '../../ui'
import { errorText, humanizeError } from '../../utils/humanizeError'
import { parseThreadWorktreeError, threadWorktreeFailureAdvice, type ThreadWorktreeErrorCode } from '../../../shared/threadWorktree'
import { readThreadWorktreePref, writeThreadWorktreePref } from './threadWorktreePref'

/** An example path, the same in every language. */
const EXAMPLE_FOLDER = String.raw`C:\projects\my-project`

/** The main process's own message in readable form, or null when the error carries none. */
function ipcErrorText(cause: unknown): string | null {
  return errorText(cause) ? humanizeError(cause) : null
}
export function NewThreadDialog({ initialProjectId, initialRootPath, onClose }: { initialProjectId: string | null; initialRootPath?: string; onClose: () => void }) {
  const { t } = useTranslation('thread')
  const projects = useThreadStore(state => state.projects)
  const choices = projects.filter(project => !project.hidden).flatMap(project => project.contexts.map(context => ({ ...context, projectId: project.projectId, projectName: project.displayName })))
  const [unique] = useState(() => choices.filter((c, i) => choices.findIndex(other => other.rootPath === c.rootPath) === i))
  const [choice, setChoice] = useState(() => Math.max(0, unique.findIndex(c => initialRootPath ? c.rootPath === initialRootPath : c.projectId === initialProjectId)))
  const [choosingProject, setChoosingProject] = useState(false)
  const [projectQuery, setProjectQuery] = useState('')
  const [provider, setProvider] = useState<ThreadProvider>('claude')
  const [error, setError] = useState(''), [pending, setPending] = useState(false)
  // Text another view handed over (Ask for analysis): named here, put in the draft on create, dropped on cancel.
  const pendingDraft = useThreadStore(state => state.pendingDraft)
  const cancel = () => { useThreadStore.getState().setPendingDraft(null); onClose() }
  // A new branch in its own worktree, next to the repository; the conversation starts there. Off until the person
  // turns it on, and then remembered for this project.
  const [chosenWorktree, setChosenWorktree] = useState<boolean | null>(null)
  const inWorktree = chosenWorktree ?? readThreadWorktreePref(unique[choice]?.projectId)
  const [branch, setBranch] = useState(''), [baseRef, setBaseRef] = useState('')
  // A refusal the person can act on; working in the project folder instead is offered, never done on its own.
  const [failure, setFailure] = useState<{ code: ThreadWorktreeErrorCode; detail: string } | null>(null)
  const create = async (useWorktree: boolean, allowDirtyBase = false) => {
    const context = unique[choice]; if (!context || pending) return
    setPending(true); setError(''); setFailure(null)
    const worktree = useWorktree ? { ...(branch.trim() ? { branch: branch.trim() } : {}), ...(baseRef.trim() ? { baseRef: baseRef.trim() } : {}), ...(allowDirtyBase ? { allowDirtyBase } : {}) } : undefined
    try {
      const snapshot = await window.oxe.thread!.create({ projectId: context.projectId, rootPath: context.rootPath, provider, ...(worktree ? { worktree } : {}) })
      // Falling back to the project folder is a one-time answer; it does not change what is remembered.
      if (useWorktree === inWorktree) writeThreadWorktreePref(context.projectId, inWorktree)
      const store = useThreadStore.getState(); store.adopt(snapshot)
      if (store.pendingDraft) { store.setDraft(snapshot.thread.id, store.pendingDraft.text); store.setPendingDraft(null) }
      onClose()
    } catch (cause) {
      // A worktree refusal names its cause (branch exists, not a repository…); show it instead of a generic line.
      const parsed = worktree ? parseThreadWorktreeError(cause instanceof Error ? cause.message : String(cause)) : null
      if (parsed) setFailure({ code: parsed.code, detail: parsed.message })
      else setError(worktree ? ipcErrorText(cause) ?? t('dialogs.worktreeFailed') : t('dialogs.createFailed'))
    } finally { setPending(false) }
  }
  const advice = failure ? threadWorktreeFailureAdvice(failure.code) : null
  const filteredProjects = unique.map((context, index) => ({ context, index })).filter(({ context }) => `${context.projectName} ${context.rootPath}`.toLowerCase().includes(projectQuery.toLowerCase()))
  return <Dialog closeLabel={t('common.close')} className="thread-create-dialog" title={t('dialogs.newTitle')} description={t('dialogs.newDescription')} onClose={() => { if (!pending) cancel() }}
    footer={<>
      <Button disabled={pending} onClick={cancel}>{t('common.cancel')}</Button>
      <Button variant="primary" type="submit" form="new-thread-form" disabled={!unique[choice] || pending || !window.oxe?.thread}>{pending ? t('dialogs.creating') : t('dialogs.create')}</Button>
    </>}>
    <form id="new-thread-form" onSubmit={e => { e.preventDefault(); void create(inWorktree) }}>{pendingDraft && <p className="thread-create-section" role="note" data-testid="new-thread-pending-draft">{t(`dialogs.pendingDraft.${pendingDraft.source}`)}</p>}<div className="thread-create-section thread-project-selection"><strong>{t('dialogs.project')}</strong><span>{unique[choice]?.projectName ?? t('dialogs.noProject')}</span><code>{unique[choice]?.rootPath}</code>{unique.length > 1 && <Button variant="link" size="sm" className="thread-project-change" aria-expanded={choosingProject} onClick={() => setChoosingProject(value => !value)}>{t('dialogs.changeProject')}</Button>}{choosingProject && <fieldset className="thread-project-options"><legend>{t('dialogs.chooseProject')}</legend><TextField aria-label={t('dialogs.filterProjects')} value={projectQuery} onChange={event => setProjectQuery(event.target.value)} />{filteredProjects.map(({ context, index }) => <label key={context.rootPath}><input type="radio" name="thread-project" checked={choice === index} onChange={() => { setChoice(index); setChoosingProject(false) }} /><span>{context.projectName}<small>{context.rootPath}</small></span></label>)}{!filteredProjects.length && <EmptyState compact title={t('dialogs.noProjectMatch')} />}</fieldset>}<p>{t('dialogs.projectHint')}</p></div>
      <fieldset className="thread-agent-choice"><legend>{t('dialogs.agent')}</legend><div className="thread-agent-options">{(['claude', 'codex'] as const).map(id => <label key={id} className="thread-agent-option" data-selected={provider === id}><input type="radio" name="thread-provider" value={id} checked={provider === id} onChange={() => setProvider(id)} /><span className="thread-agent-option-icon"><AgentProviderIcon provider={id} size={20} /></span><span><strong>{id === 'claude' ? 'Claude Code' : 'Codex'}</strong><small>{id === 'claude' ? t('accounts.claudePlan') : t('accounts.codexPlan')}</small></span>{provider === id && <Check size={14} className="thread-agent-option-check" />}</label>)}</div></fieldset>
      <div className="thread-create-section thread-worktree-choice">
        <Checkbox label={t('dialogs.inWorktree')} checked={inWorktree} onChange={event => { setChosenWorktree(event.target.checked); setFailure(null) }} disabled={pending} />
        <p>{t('dialogs.inWorktreeHint')}</p>
        {inWorktree && <div className="thread-worktree-fields">
          <TextField label={t('dialogs.branch')} mono value={branch} placeholder={t('dialogs.branchPlaceholder')} onChange={event => setBranch(event.target.value)} disabled={pending} />
          <TextField label={t('dialogs.startFrom')} mono value={baseRef} placeholder={t('dialogs.startFromPlaceholder')} onChange={event => setBaseRef(event.target.value)} disabled={pending} />
        </div>}
      </div>
      {error && <ErrorState compact title={error} />}
      {failure && advice && <Notice className="thread-worktree-failure" intent={advice.canContinue ? 'warning' : 'danger'}
        title={t(`dialogs.worktreeError.${failure.code}`, { branch: branch.trim(), base: baseRef.trim(), detail: failure.detail })}
        actions={<>
          {advice.canContinue && <Button size="sm" disabled={pending} onClick={() => void create(true, true)}>{t('dialogs.worktreeContinue')}</Button>}
          <Button size="sm" disabled={pending} onClick={() => void create(false)}>{t('dialogs.worktreeUseProject')}</Button>
        </>}>
        {t(`dialogs.worktreeAdvice.${failure.code}`)}
      </Notice>}
    </form>
  </Dialog>
}

export function AddThreadProjectDialog({ onPickFolder, onAdd, onClose }: {
  onPickFolder: () => Promise<string | null>
  onAdd: (rootPath: string) => Promise<void>
  onClose: () => void
}) {
  const { t } = useTranslation('thread')
  const [rootPath, setRootPath] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [picking, setPicking] = useState(false)
  const submit = async () => {
    const normalized = rootPath.trim()
    if (!normalized) { setError(t('dialogs.chooseFolder')); return }
    setPending(true); setError('')
    try { await onAdd(normalized); onClose() }
    catch (cause) { setError(humanizeError(cause, t('dialogs.addFailed'))) }
    finally { setPending(false) }
  }
  return <Dialog closeLabel={t('common.close')} className="thread-create-dialog thread-project-dialog" title={t('dialogs.addTitle')} description={t('dialogs.addDescription')} onClose={() => { if (!pending && !picking) onClose() }}
    footer={<>
      <Button disabled={pending || picking} onClick={onClose}>{t('common.cancel')}</Button>
      <Button variant="primary" type="submit" form="add-thread-project-form" disabled={pending || picking || !rootPath.trim()}>{pending ? t('dialogs.adding') : t('dialogs.add')}</Button>
    </>}>
    <form id="add-thread-project-form" onSubmit={event => { event.preventDefault(); void submit() }}>
      <label>{t('dialogs.folder')}
        <span className="thread-project-folder-field">
          <TextField aria-label={t('dialogs.folderPath')} value={rootPath} placeholder={EXAMPLE_FOLDER} onChange={event => setRootPath(event.target.value)} autoFocus />
          <Button icon={<FolderOpen size={14} aria-hidden="true" />} disabled={pending || picking} onClick={() => {
            setPicking(true); setError('')
            void onPickFolder().then(path => { if (path) setRootPath(path) }).catch(cause => setError(humanizeError(cause, t('dialogs.pickerFailed')))).finally(() => setPicking(false))
          }}>{picking ? t('dialogs.choosing') : t('dialogs.browse')}</Button>
        </span>
      </label>
      <p>{t('dialogs.addHint')}</p>
      {error && <ErrorState compact title={error} />}
    </form>
  </Dialog>
}
