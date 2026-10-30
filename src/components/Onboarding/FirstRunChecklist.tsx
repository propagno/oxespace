import { Check, FolderPlus, MessageSquarePlus, RefreshCw, Settings2, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, type ReactElement, type ReactNode } from 'react'
import type { AgentAccountContext } from '../../../shared/types/agentAuth'
import { selectAccount, useAccountStore } from '../../store/account.store'
import { useAgentStore } from '../../store/agent.store'
import { useNavigationPrefs, type FirstRunStep } from '../../store/navigation-prefs.store'
import { useThreadStore } from '../../store/thread.store'
import { useUIStore } from '../../store/ui.store'
import { Button, IconButton, StatusDot } from '../../ui'
import { summarizeAgentSetup, type AgentSetupState } from '../../utils/agentSetup'
import { accountContext, accountMessage } from '../Threads/ProviderAccountsPanel'
import { AgentInstallLinks } from './AgentCliOnboarding'
import { watchFirstAnswer } from './firstAnswer'
import styles from './FirstRunChecklist.module.css'

const DOT: Record<AgentSetupState, 'idle' | 'running' | 'success' | 'attention' | 'danger'> = {
  unchecked: 'idle',
  checking: 'running',
  ready: 'success',
  'needs-attention': 'attention',
  none: 'danger'
}
const REQUIRED: FirstRunStep[] = ['agents', 'account', 'folder']

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

/** A finished step folds to its title and, when given, a one-line summary, so the open steps stay in view. */
function Step({ number, title, done, optional, summary, children }: { number?: number; title: string; done: boolean; optional?: boolean; summary?: ReactNode; children: ReactNode }): ReactElement {
  const id = useId()
  return (
    <li className={styles.step} aria-labelledby={id} data-done={done || undefined}>
      <span className={styles.marker} aria-hidden="true">{done ? <Check size={12} /> : number ?? '·'}</span>
      <div className={styles.body}>
        <h3 className={styles.stepTitle} id={id}>{title}{optional ? <span className={styles.optional}> (optional)</span> : null}{done ? <span className={styles.srOnly}> (done)</span> : null}</h3>
        {done ? summary ?? null : children}
      </div>
    </li>
  )
}

function AccountRow({ provider, projectId }: { provider: 'claude' | 'codex'; projectId: string }): ReactElement {
  const context: AgentAccountContext = useMemo(() => accountContext(provider, `thread:${projectId}`), [provider, projectId])
  const status = useAccountStore(selectAccount(context))
  const connected = status?.state === 'connected' && status.method === 'subscription'
  useEffect(() => { void useAccountStore.getState().read(context) }, [context])
  useEffect(() => { if (connected) useNavigationPrefs.getState().completeFirstRunStep('account') }, [connected])
  return (
    <div className={styles.row}>
      <span className={styles.text}>
        <span className={styles.headline}>{context.provider === 'claude' ? 'Claude Code' : 'Codex'}</span>
        <span className={styles.detail}>{accountMessage(status)}</span>
      </span>
      {!connected && window.oxe?.agentAccount ? <Button size="sm" variant="ghost" onClick={() => void useAccountStore.getState().login(context).catch(() => undefined)}>Connect</Button> : null}
    </div>
  )
}

/**
 * The first-run guide on the empty screen, three steps in the order a new user meets them: an agent CLI on this
 * machine, an account the agent can use, then a first folder and a first answer. GitHub is an optional fourth step.
 * Progress and dismissal persist; the time from the guide appearing to the first answer is measured on this computer
 * only (see firstAnswer.ts).
 */
export function FirstRunChecklist({ onNewWorkspace, onAddProject }: { onNewWorkspace?: () => void; onAddProject?: () => void }): ReactElement | null {
  const titleId = useId()
  const readiness = useAgentStore(state => state.readiness)
  const isDiscovering = useAgentStore(state => state.isDiscovering)
  const loadReadiness = useAgentStore(state => state.loadReadiness)
  const discover = useAgentStore(state => state.discover)
  const openAgentSettings = useUIStore(state => state.openAgentSettings)
  const firstRun = useNavigationPrefs(state => state.firstRun)
  const complete = useNavigationPrefs(state => state.completeFirstRunStep)
  const project = useThreadStore(state => state.projects[0])
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    // Read what is already known, and run one check only if this machine was never checked.
    void loadReadiness().then(() => {
      if (useAgentStore.getState().lastHealthCheckAt === null) void discover(false)
    })
    // Sign-in is checked inside a project, so learn whether one exists.
    if (window.oxe?.thread?.projects) void useThreadStore.getState().loadProjects()
    if (!useNavigationPrefs.getState().firstRun.dismissed) {
      useNavigationPrefs.getState().startFirstRunClock(Date.now())
      watchFirstAnswer()
    }
  }, [loadReadiness, discover])

  const summary = summarizeAgentSetup(readiness, isDiscovering)
  useEffect(() => { if (summary.state === 'ready') complete('agents') }, [summary.state, complete])

  if (firstRun.dismissed) return null
  const done = (step: FirstRunStep): boolean => firstRun.done.includes(step)
  const checkLabel = summary.state === 'unchecked' ? 'Check now' : 'Check again'
  const threadProviders = readiness.filter(entry => entry.status === 'ready' && (entry.provider === 'claude' || entry.provider === 'codex')).map(entry => entry.provider as 'claude' | 'codex')
  const finished = REQUIRED.filter(done).length
  // The CLI status stays visible once ready: it says which agents Code and Thread can use.
  const agents = <>
    <div className={styles.row}>
      <span className={styles.dot}><StatusDot status={DOT[summary.state]} label={summary.headline} /></span>
      <span className={styles.text} aria-live="polite">
        <span className={styles.headline}>{summary.headline}</span>
        <span className={styles.detail}>{summary.detail}</span>
      </span>
    </div>
    <div className={styles.actions}>
      {summary.state === 'none' ? <AgentInstallLinks providers={['claude', 'codex']} size="sm" /> : null}
      {summary.state !== 'ready' ? (
        <Button variant="ghost" size="sm" disabled={isDiscovering} icon={<RefreshCw size={12} aria-hidden="true" />} onClick={() => void discover(true)}>{isDiscovering ? 'Checking…' : checkLabel}</Button>
      ) : null}
      <Button variant="ghost" size="sm" icon={<Settings2 size={12} aria-hidden="true" />} onClick={openAgentSettings}>Agent settings</Button>
    </div>
  </>

  return (
    <section className={styles.card} aria-labelledby={titleId} data-testid="first-run-checklist">
      <div className={styles.header}>
        <h2 className={styles.title} id={titleId}>Before you start</h2>
        <span className={styles.progress}>{finished} of {REQUIRED.length} done</span>
        <IconButton size="sm" label="Hide this guide" icon={<X size={14} />} onClick={() => useNavigationPrefs.getState().dismissFirstRun()} />
      </div>
      <ol className={styles.steps}>
        <Step number={1} title="Agent CLIs" done={done('agents')} summary={agents}>{agents}</Step>
        <Step number={2} title="Sign in" done={done('account')}>
          {project && threadProviders.length ? (
            threadProviders.map(provider => <AccountRow key={provider} provider={provider} projectId={project.projectId} />)
          ) : (
            <p className={styles.detail}>Claude Code and Codex use your own subscription. OXESpace checks the sign-in once a folder is open; you can also sign in from a terminal with the agent itself.</p>
          )}
          <div className={styles.actions}><Button variant="ghost" size="sm" onClick={() => complete('account')}>Skip for now</Button></div>
        </Step>
        <Step number={3} title="First folder and first answer" done={done('folder')} summary={firstRun.firstAnswerMs !== null
          ? <p className={styles.detail} role="status">First answer {formatDuration(firstRun.firstAnswerMs)} after you started. This stays on this computer.</p> : null}>
          <p className={styles.detail}>Open a folder and ask an agent something: in an OxeChat conversation, or in an OxeCode workspace terminal.</p>
          <div className={styles.actions}>
            {onAddProject ? <Button variant="ghost" size="sm" icon={<MessageSquarePlus size={12} aria-hidden="true" />} onClick={onAddProject}>Add an OxeChat project</Button> : null}
            {onNewWorkspace ? <Button variant="ghost" size="sm" icon={<FolderPlus size={12} aria-hidden="true" />} onClick={onNewWorkspace}>New OxeCode workspace</Button> : null}
          </div>
        </Step>
        <Step title="GitHub" optional done={done('github')}>
          <p className={styles.detail}>
            Pull requests and issues need the GitHub CLI signed in (<code>gh auth login</code>). OXESpace checks it once a project is open.
          </p>
          <div className={styles.actions}>
            <Button variant="ghost" size="sm" onClick={() => void navigator.clipboard?.writeText('gh auth login').catch(() => undefined)}>Copy command</Button>
            <Button variant="ghost" size="sm" onClick={() => complete('github')}>Mark as done</Button>
          </div>
        </Step>
      </ol>
    </section>
  )
}
