import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentHookAgent } from '../../../shared/types/agent-hooks'
import { useAgentResumeStore } from '../../store/agent-resume.store'
import { Button, Dialog, toast } from '../../ui'

const AGENT: Record<AgentHookAgent, string> = { 'claude-code': 'Claude Code', codex: 'Codex' }

/**
 * "Install the status hooks?" the first time a Claude or Codex pane runs without them: they let a pane record its
 * session, so it can come back after a crash (Codex has no other way). Installing writes to the person's agent
 * settings (~/.claude, ~/.codex), so it is only done on "Install". "Not now" asks again after a restart;
 * "Don't ask again" never asks; the pane's menu can still offer it.
 */
export function AgentHooksPrompt({ agent }: { agent: AgentHookAgent }): ReactElement {
  const { t } = useTranslation('code')
  const [busy, setBusy] = useState(false)
  const name = AGENT[agent]
  const install = async (): Promise<void> => {
    setBusy(true)
    try {
      const status = await useAgentResumeStore.getState().answerHooks('install')
      if (status?.state === 'installed') toast({ title: t('agentResume.hooks.installed', { agent: name }), intent: 'success' })
      else toast({ title: t('agentResume.hooks.failed', { agent: name }), description: status?.detail ?? undefined, intent: 'danger' })
    } catch (cause) {
      toast({ title: t('agentResume.hooks.failed', { agent: name }), description: cause instanceof Error ? cause.message : undefined, intent: 'danger' })
    }
  }
  return <Dialog title={t('agentResume.hooks.title', { agent: name })} description={t('agentResume.hooks.body', { agent: name, folder: agent === 'codex' ? '~/.codex' : '~/.claude' })}
    onClose={() => void useAgentResumeStore.getState().answerHooks('notNow')} testId="agent-hooks-prompt"
    footer={<>
      <Button variant="ghost" disabled={busy} onClick={() => void useAgentResumeStore.getState().answerHooks('never')}>{t('agentResume.hooks.never')}</Button>
      <Button variant="secondary" disabled={busy} onClick={() => void useAgentResumeStore.getState().answerHooks('notNow')}>{t('agentResume.hooks.notNow')}</Button>
      <Button variant="primary" loading={busy} onClick={() => void install()}>{t('agentResume.hooks.install')}</Button>
    </>} />
}
