import { lazy, Suspense, useEffect, type ComponentProps, type ReactElement } from 'react'
import type { AgentLifecycleState } from '../../../shared/types/agent-state'
import type { PaneAgentResume } from '../../../shared/types/ipc/terminal'
import { i18n } from '../../i18n'
import { useAgentResumeStore, type ResumeAgent } from '../../store/agent-resume.store'
import { toast } from '../../ui'
import type * as View from './PaneResumeView'

/**
 * F32 · the pane resume parts every terminal pane mounts. Only the hook and these light gates load with the window: what
 * they show (PaneResumeView, with main's message catalog) loads the first time a pane has something to show, so the
 * renderer's entry chunk does not carry it (#311, bundle budget).
 */
const view = (): Promise<typeof View> => import('./PaneResumeView')

const tc = i18n.getFixedT(null, 'code')
/** The person chose "Start fresh": not resumed on purpose, so neither a warning nor a notice. */
const startedFresh = (outcome: PaneAgentResume | undefined): boolean => outcome?.outcome === 'notResumed' && outcome.message.code === 'agents.resume.startedFresh'

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
      if (!known && found?.outcome === 'notResumed' && !startedFresh(found)) {
        // Main's reason in the interface language: its catalog loads with this first notice.
        const message = found.message
        void import('../../i18n/mainMessage').then(({ formatMainMessage }) => sayNotResumed(paneName, formatMainMessage(message)))
      }
      if (agent) void useAgentResumeStore.getState().offerHooks(agent, { paneId })
    })
  }, [running, paneId, paneName, agent])
  useEffect(() => {
    if (agentState === 'working' && outcome?.outcome === 'resumed') useAgentResumeStore.getState().collapse(paneId)
  }, [agentState, outcome, paneId])
  return outcome
}

const MarkerView = lazy(() => view().then(module => ({ default: module.PaneResumeMarker })))
const HooksNoticeView = lazy(() => view().then(module => ({ default: module.PaneHooksNotice })))
const StartFreshMenuItemView = lazy(() => view().then(module => ({ default: module.StartFreshMenuItem })))
const StartFreshConfirmView = lazy(() => view().then(module => ({ default: module.StartFreshConfirm })))
const EnableResumeMenuItemView = lazy(() => view().then(module => ({ default: module.EnableResumeMenuItem })))
const AgentSessionDetailsView = lazy(() => view().then(module => ({ default: module.AgentSessionDetails })))
const show = (node: ReactElement): ReactElement => <Suspense fallback={null}>{node}</Suspense>

/** The pane header's sign of what became of its earlier session; nothing when none was recorded or it was started fresh. */
export function PaneResumeMarker(props: ComponentProps<typeof View.PaneResumeMarker>): ReactElement | null {
  if (props.outcome.outcome === 'nothingRecorded' || startedFresh(props.outcome)) return null
  return show(<MarkerView {...props} />)
}

/** The status-hooks question inside the pane that started the agent, only while it is asked there. */
export function PaneHooksNotice(props: ComponentProps<typeof View.PaneHooksNotice>): ReactElement | null {
  const asked = useAgentResumeStore(state => state.askingIn?.kind === 'pane' && state.askingIn.paneId === props.paneId && !!state.asking)
  return asked ? show(<HooksNoticeView {...props} />) : null
}

/** "Start fresh" in a resumed pane's menu (the menu opens later than the pane). */
export function StartFreshMenuItem(props: ComponentProps<typeof View.StartFreshMenuItem>): ReactElement {
  return show(<StartFreshMenuItemView {...props} />)
}

/** "Start this pane fresh?", mounted only when asked. */
export function StartFreshConfirm(props: ComponentProps<typeof View.StartFreshConfirm>): ReactElement {
  return show(<StartFreshConfirmView {...props} />)
}

/** "Enable resume after a crash…" in the pane's menu, only while this agent's status hooks are missing. */
export function EnableResumeMenuItem(props: ComponentProps<typeof View.EnableResumeMenuItem>): ReactElement | null {
  const missing = useAgentResumeStore(state => state.hooksMissing(props.agent))
  return missing ? show(<EnableResumeMenuItemView {...props} />) : null
}

/** "Agent session" in the pane's Details (opened later than the pane). */
export function AgentSessionDetails(props: ComponentProps<typeof View.AgentSessionDetails>): ReactElement {
  return show(<AgentSessionDetailsView {...props} />)
}
