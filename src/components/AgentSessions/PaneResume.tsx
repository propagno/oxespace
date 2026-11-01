import { History, RotateCcw, TriangleAlert } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'
import type { AgentLifecycleState } from '../../../shared/types/agent-state'
import type { PaneAgentResume, PaneAgentSession } from '../../../shared/types/ipc/terminal'
import { i18n } from '../../i18n'
import { formatMainMessage } from '../../i18n/mainMessage'
import { useAgentResumeStore, type ResumeAgent } from '../../store/agent-resume.store'
import { Badge, Button, ConfirmDialog, Notice, toast } from '../../ui'
import { copyText } from '../../ui/clipboard'
import paneMenu from '../Grid/PaneMenu.module.css'
import { answerHooksAndSay, AGENT_HOOK_NAME } from './agentHooksAnswer'

const tc = i18n.getFixedT(null, 'code')
const AGENT = { claude: 'Claude', codex: 'Codex' } as const
/** The person chose "Start fresh": not resumed on purpose, so neither a warning nor a notice. */
const STARTED_FRESH = 'agents.resume.startedFresh'
const startedFresh = (outcome: PaneAgentResume | undefined): boolean => outcome?.outcome === 'notResumed' && outcome.message.code === STARTED_FRESH

/** Panes found not resumed close together (the app reopening with several) are said in one notice. */
const NOTICE_BATCH_MS = 2000
let pending: Array<{ pane: string; reason: string }> = []
let timer: ReturnType<typeof setTimeout> | undefined
function sayNotResumed(pane: string, reason: string): void {
  pending.push({ pane, reason })
  clearTimeout(timer)
  timer = setTimeout(() => {
    const batch = pending
    pending = []
    if (batch.length === 1) toast({ title: tc('agentResume.notResumedNotice', { pane: batch[0].pane }), description: batch[0].reason, intent: 'warning' })
    else toast({ title: tc('agentResume.notResumedMany', { count: batch.length }), description: batch.map(item => item.pane).join(', '), intent: 'warning' })
  }, NOTICE_BATCH_MS)
}

/**
 * Once the pane runs, reads what main did with its earlier session (B17) and, for a Claude or Codex pane, offers the
 * status hooks in the pane when they are missing. A session that was not resumed is said, batched with the others
 * found at the same time; the "Session resumed" sign goes away once the agent has taken a turn.
 */
export function usePaneResume(paneId: string, paneName: string, running: boolean, agent: ResumeAgent | null, agentState: AgentLifecycleState | null = null): PaneAgentResume | undefined {
  const outcome = useAgentResumeStore(state => state.byPane[paneId])
  useEffect(() => {
    if (!running) return
    const store = useAgentResumeStore.getState()
    const known = store.byPane[paneId]
    void store.load(paneId).then(found => {
      if (!known && found?.outcome === 'notResumed' && !startedFresh(found)) sayNotResumed(paneName, formatMainMessage(found.message))
      if (agent) void useAgentResumeStore.getState().offerHooks(agent, { paneId })
    })
  }, [running, paneId, paneName, agent])
  useEffect(() => {
    if (agentState === 'working' && outcome?.outcome === 'resumed') useAgentResumeStore.getState().collapse(paneId)
  }, [agentState, outcome, paneId])
  return outcome
}

/** The pane header's sign of what became of its earlier session; nothing when none was recorded or it was started fresh. */
export function PaneResumeMarker({ paneId, outcome }: { paneId: string; outcome: PaneAgentResume }): ReactElement | null {
  const collapsed = useAgentResumeStore(state => !!state.collapsed[paneId])
  if (outcome.outcome === 'nothingRecorded' || startedFresh(outcome)) return null
  const agent = AGENT[outcome.agent]
  if (outcome.outcome === 'resumed') {
    if (collapsed) return null
    const name = tc('agentResume.resumedTitle', { agent })
    // The session id is for the tooltip only: read aloud, it is noise.
    return <Badge icon={<History size={12} />} title={`${name} (${outcome.sessionId})`} ariaLabel={name} data-testid="pane-resume-marker" data-outcome="resumed">
      {tc('agentResume.resumedChip')}
    </Badge>
  }
  const name = tc('agentResume.notResumedTitle', { agent, reason: formatMainMessage(outcome.message) })
  return <Badge intent="warning" icon={<TriangleAlert size={12} />} title={name} ariaLabel={name} data-testid="pane-resume-marker" data-outcome="notResumed">
    {tc('agentResume.notResumedChip')}
  </Badge>
}

/**
 * The status-hooks question inside the pane that started the agent: a notice that never takes the terminal's focus.
 * The same answers as the dialog the pane's menu opens.
 */
export function PaneHooksNotice({ paneId }: { paneId: string }): ReactElement | null {
  const asking = useAgentResumeStore(state => state.askingIn?.kind === 'pane' && state.askingIn.paneId === paneId ? state.asking : null)
  const [busy, setBusy] = useState(false)
  if (!asking) return null
  const name = AGENT_HOOK_NAME[asking]
  const answer = (choice: 'install' | 'notNow' | 'never'): void => {
    setBusy(true)
    void answerHooksAndSay(choice).finally(() => setBusy(false))
  }
  return <Notice intent="info" title={tc('agentResume.hooks.title', { agent: name })} className="pane-hooks-notice"
    actions={<>
      <Button size="sm" variant="primary" loading={busy} onClick={() => answer('install')}>{tc('agentResume.hooks.install')}</Button>
      <Button size="sm" variant="ghost" onClick={() => answer('notNow')}>{tc('agentResume.hooks.notNow')}</Button>
      <Button size="sm" variant="ghost" onClick={() => answer('never')}>{tc('agentResume.hooks.never')}</Button>
    </>}>
    <span data-testid="pane-hooks-notice">{tc('agentResume.hooks.body', { agent: name, folder: asking === 'codex' ? '~/.codex' : '~/.claude' })}</span>
  </Notice>
}

/** "Start fresh" in a resumed pane's menu; the question opens outside the menu (StartFreshConfirm). */
export function StartFreshMenuItem({ paneId, agent, onDone }: { paneId: string; agent: ResumeAgent; onDone: (action: () => void) => void }): ReactElement {
  return <Button variant="ghost" role="menuitem" className={paneMenu.item} data-testid="pane-start-fresh"
    onClick={event => { event.stopPropagation(); onDone(() => useAgentResumeStore.getState().askFresh({ paneId, agent })) }}>
    <RotateCcw size={14} aria-hidden="true" />{tc('agentResume.startFresh')}
  </Button>
}

/**
 * "Start this pane fresh?": restarts the agent without its earlier session, and main forgets that session for the
 * pane. It ends what the agent is doing, so it asks first, with Cancel focused.
 */
export function StartFreshConfirm({ paneId, agent }: { paneId: string; agent: ResumeAgent }): ReactElement {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const name = AGENT[agent]
  const close = (): void => useAgentResumeStore.getState().askFresh(null)
  const start = async (): Promise<void> => {
    setBusy(true)
    setFailed(false)
    try {
      await window.oxe.terminal.restart({ paneId, resume: false })
      close()
      await useAgentResumeStore.getState().reload(paneId)
    } catch (cause) {
      // The reason in our words; the raw error is for the console.
      console.warn('[OXESpace] start fresh failed', cause)
      setFailed(true)
      setBusy(false)
    }
  }
  return <ConfirmDialog title={tc('agentResume.startFreshTitle', { agent: name })} description={tc('agentResume.startFreshBody', { agent: name })}
    confirmLabel={tc('agentResume.startFresh')} danger busy={busy} error={failed ? tc('agentResume.startFreshFailed') : undefined} onConfirm={() => void start()} onCancel={close} />
}

/** "Enable resume after a crash…" in the pane's menu, while this agent's status hooks are missing: opens the dialog. */
export function EnableResumeMenuItem({ agent, onDone }: { agent: ResumeAgent; onDone: (action: () => void) => void }): ReactElement | null {
  const missing = useAgentResumeStore(state => state.hooksMissing(agent))
  if (!missing) return null
  return <Button variant="ghost" role="menuitem" className={paneMenu.item} data-testid="pane-enable-resume"
    onClick={event => { event.stopPropagation(); onDone(() => { void useAgentResumeStore.getState().offerHooks(agent, 'dialog') }) }}>
    <History size={14} aria-hidden="true" />{tc('agentResume.enableMenu')}
  </Button>
}

/**
 * "Agent session" in the pane's Details (F32 on B17): the native Claude Code or Codex session the pane is in, where
 * OXESpace learned it, what became of the earlier one at start, and "Copy resume command" with main's own command.
 * Without a session (`notFound`) it says why.
 */
export function AgentSessionDetails({ session, resume }: { session: PaneAgentSession; resume?: PaneAgentResume }): ReactElement {
  if (session.source === 'notFound') {
    return <dl className="detail-list pane-agent-session" data-testid="pane-agent-session">
      <div><dt>{tc('agentResume.details.label')}</dt><dd>{formatMainMessage(session.message)}</dd></div>
    </dl>
  }
  const state = !resume || resume.outcome === 'nothingRecorded' ? null
    : resume.outcome === 'resumed' ? tc('agentResume.details.resumed')
      : startedFresh(resume) ? tc('agentResume.details.startedFresh') : tc('agentResume.details.notResumed', { reason: formatMainMessage(resume.message) })
  return <div className="pane-agent-session" data-testid="pane-agent-session">
    <dl className="detail-list">
      <div><dt>{tc('agentResume.details.label')}</dt><dd><code data-testid="pane-agent-session-id">{session.sessionId}</code> ({AGENT[session.agent]})</dd></div>
      <div><dt>{tc('agentResume.details.source')}</dt><dd>{tc(`agentResume.details.sources.${session.source}`)}</dd></div>
      {state && <div><dt>{tc('agentResume.details.state')}</dt><dd>{state}</dd></div>}
    </dl>
    <Button size="sm" onClick={() => void copyText(session.resumeCommand, tc('agentResume.details.command'))}>{tc('agentResume.details.copy')}</Button>
  </div>
}
