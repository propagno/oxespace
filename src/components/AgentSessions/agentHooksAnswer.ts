import type { AgentHookAgent } from '../../../shared/types/agent-hooks'
import { i18n } from '../../i18n'
import { useAgentResumeStore } from '../../store/agent-resume.store'
import { toast } from '../../ui'

const tc = i18n.getFixedT(null, 'code')
export const AGENT_HOOK_NAME: Record<AgentHookAgent, string> = { 'claude-code': 'Claude Code', codex: 'Codex' }

/** The person's answer to the status-hooks question, from the pane's notice or the dialog; an install is said either way. */
export async function answerHooksAndSay(answer: 'install' | 'notNow' | 'never'): Promise<void> {
  const agent = useAgentResumeStore.getState().asking
  if (!agent) return
  const name = AGENT_HOOK_NAME[agent]
  try {
    const status = await useAgentResumeStore.getState().answerHooks(answer)
    if (answer !== 'install') return
    if (status?.state === 'installed') toast({ title: tc('agentResume.hooks.installed', { agent: name }), intent: 'success' })
    else toast({ title: tc('agentResume.hooks.failed', { agent: name }), intent: 'danger' })
  } catch (cause) {
    console.warn('[OXESpace] agent hooks install failed', cause)
    toast({ title: tc('agentResume.hooks.failed', { agent: name }), intent: 'danger' })
  }
}
