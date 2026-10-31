import { lazy, Suspense, type ReactElement } from 'react'
import { useAgentResumeStore } from '../../store/agent-resume.store'

const AgentHooksPrompt = lazy(() => import('./AgentHooksPrompt').then(module => ({ default: module.AgentHooksPrompt })))

/** Shows the status-hooks question when a pane asked for it (useAgentResumeStore.offerHooks); loaded only then. */
export function AgentHooksPromptHost(): ReactElement | null {
  const asking = useAgentResumeStore(state => state.asking)
  if (!asking) return null
  return <Suspense fallback={null}><AgentHooksPrompt agent={asking} /></Suspense>
}
