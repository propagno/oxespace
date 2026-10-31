import { lazy, Suspense, type ReactElement } from 'react'
import { useAgentResumeStore } from '../../store/agent-resume.store'
import { StartFreshConfirm } from './PaneResume'

const AgentHooksPrompt = lazy(() => import('./AgentHooksPrompt').then(module => ({ default: module.AgentHooksPrompt })))

/**
 * The pane resume questions, outside any pane's menu: the status-hooks question when a pane asked for it
 * (useAgentResumeStore.offerHooks; loaded only then), and "Start this pane fresh?".
 */
export function AgentHooksPromptHost(): ReactElement | null {
  const asking = useAgentResumeStore(state => state.asking)
  const fresh = useAgentResumeStore(state => state.freshAsk)
  return <>
    {asking && <Suspense fallback={null}><AgentHooksPrompt agent={asking} /></Suspense>}
    {fresh && <StartFreshConfirm key={fresh.paneId} paneId={fresh.paneId} agent={fresh.agent} />}
  </>
}
