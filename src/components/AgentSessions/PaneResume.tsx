import { History, RotateCcw, TriangleAlert } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'
import type { PaneAgentResume } from '../../../shared/types/ipc/terminal'
import { i18n } from '../../i18n'
import { formatMainMessage } from '../../i18n/mainMessage'
import { useAgentResumeStore, type ResumeAgent } from '../../store/agent-resume.store'
import { Button, ConfirmDialog, cx, toast } from '../../ui'
import paneMenu from '../Grid/PaneMenu.module.css'
import styles from './PaneResume.module.css'

const tc = i18n.getFixedT(null, 'code')
const AGENT = { claude: 'Claude', codex: 'Codex' } as const
/** The person chose "Start fresh": not resumed on purpose, so neither a warning nor a notice. */
const STARTED_FRESH = 'agents.resume.startedFresh'
const startedFresh = (outcome: PaneAgentResume | undefined): boolean => outcome?.outcome === 'notResumed' && outcome.message.code === STARTED_FRESH

/**
 * Once the pane runs, reads what main did with its earlier session (B17) and, for a Claude or Codex pane, asks once
 * per run about the status hooks when they are missing. A session that was not resumed is said once, with the reason.
 */
export function usePaneResume(paneId: string, paneName: string, running: boolean, agent: ResumeAgent | null): PaneAgentResume | undefined {
  const outcome = useAgentResumeStore(state => state.byPane[paneId])
  useEffect(() => {
    if (!running) return
    const store = useAgentResumeStore.getState()
    const known = store.byPane[paneId]
    void store.load(paneId).then(found => {
      if (!known && found?.outcome === 'notResumed' && !startedFresh(found)) {
        toast({ title: tc('agentResume.notResumedNotice', { pane: paneName }), description: formatMainMessage(found.message), intent: 'warning' })
      }
      if (agent) void useAgentResumeStore.getState().offerHooks(agent)
    })
  }, [running, paneId, paneName, agent])
  return outcome
}

/** The pane header's sign of what became of its earlier session; nothing when none was recorded. */
export function PaneResumeMarker({ outcome }: { outcome: PaneAgentResume }): ReactElement | null {
  if (outcome.outcome === 'nothingRecorded' || startedFresh(outcome)) return null
  const agent = AGENT[outcome.agent]
  const session = outcome.sessionId.slice(0, 8)
  if (outcome.outcome === 'resumed') {
    const name = tc('agentResume.resumedTitle', { agent, session })
    return <span className={styles.chip} title={`${name} (${outcome.sessionId})`} aria-label={name} data-testid="pane-resume-marker" data-outcome="resumed">
      <History size={12} aria-hidden="true" />{tc('agentResume.resumedChip')}
    </span>
  }
  const reason = formatMainMessage(outcome.message)
  const name = tc('agentResume.notResumedTitle', { agent, reason })
  return <span className={cx(styles.chip, styles.warning)} title={name} aria-label={name} data-testid="pane-resume-marker" data-outcome="notResumed">
    <TriangleAlert size={12} aria-hidden="true" />{tc('agentResume.notResumedChip')}
  </span>
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
  const [error, setError] = useState('')
  const name = AGENT[agent]
  const close = (): void => useAgentResumeStore.getState().askFresh(null)
  const start = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await window.oxe.terminal.restart({ paneId, resume: false })
      close()
      await useAgentResumeStore.getState().reload(paneId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tc('agentResume.startFreshFailed'))
      setBusy(false)
    }
  }
  return <ConfirmDialog title={tc('agentResume.startFreshTitle', { agent: name })} description={tc('agentResume.startFreshBody', { agent: name })}
    confirmLabel={tc('agentResume.startFresh')} danger busy={busy} error={error || undefined} onConfirm={() => void start()} onCancel={close} />
}

/** "Enable resume after a crash…" in the pane's menu, while this agent's status hooks are missing. */
export function EnableResumeMenuItem({ agent, onDone }: { agent: ResumeAgent; onDone: (action: () => void) => void }): ReactElement | null {
  const missing = useAgentResumeStore(state => state.hooksMissing(agent))
  if (!missing) return null
  return <Button variant="ghost" role="menuitem" className={paneMenu.item} data-testid="pane-enable-resume"
    onClick={event => { event.stopPropagation(); onDone(() => { void useAgentResumeStore.getState().offerHooks(agent, true) }) }}>
    <History size={14} aria-hidden="true" />{tc('agentResume.enableMenu')}
  </Button>
}
