import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentHookAgent } from '../../../shared/types/agent-hooks'
import { Button, Dialog } from '../../ui'
import { AGENT_HOOK_NAME, answerHooksAndSay } from './agentHooksAnswer'

/**
 * "Let Claude Code panes come back after a crash?" as a dialog, when the person asked for it from a pane's menu ("Enable
 * resume after a crash…"); offered on its own, the same question is a notice inside the pane (PaneHooksNotice), which
 * never takes the terminal's focus. Installing writes to the person's agent settings (~/.claude, ~/.codex), so it is
 * only done on "Install".
 */
export function AgentHooksPrompt({ agent }: { agent: AgentHookAgent }): ReactElement {
  const { t } = useTranslation('code')
  const [busy, setBusy] = useState(false)
  const name = AGENT_HOOK_NAME[agent]
  const answer = (choice: 'install' | 'notNow' | 'never'): void => {
    setBusy(true)
    void answerHooksAndSay(choice).finally(() => setBusy(false))
  }
  return <Dialog title={t('agentResume.hooks.title', { agent: name })} description={t('agentResume.hooks.body', { agent: name, folder: agent === 'codex' ? '~/.codex' : '~/.claude' })}
    onClose={() => answer('notNow')} testId="agent-hooks-prompt"
    footer={<>
      <Button variant="ghost" disabled={busy} onClick={() => answer('never')}>{t('agentResume.hooks.never')}</Button>
      <Button variant="secondary" disabled={busy} onClick={() => answer('notNow')}>{t('agentResume.hooks.notNow')}</Button>
      <Button variant="primary" loading={busy} onClick={() => answer('install')}>{t('agentResume.hooks.install')}</Button>
    </>} />
}
