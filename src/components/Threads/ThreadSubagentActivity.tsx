import { Bot, ChevronDown, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ThreadEvent } from '../../../shared/types/thread'
import { StatusSignal, type SignalState } from '../../ui'

type AgentStatus = Extract<ThreadEvent, { type: 'subagent' }>['agents'][number]['status']

function agentSignal(status: AgentStatus): SignalState {
  if (status === 'running') return 'working'
  if (status === 'completed') return 'done'
  if (status === 'failed') return 'failed'
  if (status === 'interrupted') return 'interrupted'
  return 'waiting'
}

type SubagentEvent = Extract<ThreadEvent, { type: 'subagent' }>

const ACTIONS = new Set(['spawnAgent', 'sendInput', 'sendMessage', 'followupTask', 'resumeAgent', 'interruptAgent', 'closeAgent', 'wait', 'listAgents'])

export function ThreadSubagentActivity({ event, compact = false, onStop, stopping = false }: { event: SubagentEvent; compact?: boolean; onStop?: () => void; stopping?: boolean }) {
  const { t } = useTranslation('thread')
  // An action the app does not know yet keeps the provider's own name.
  const label = ACTIONS.has(event.action) ? t(`subagent.actions.${event.action as 'wait'}`) : event.action
  return <article className={`thread-subagent${compact ? ' is-compact' : ''}`}>
    <header><Bot size={14} aria-hidden="true" /><strong>{label}</strong><span className={`thread-subagent-state is-${event.state}`}>{t(`subagent.state.${event.state}`)}</span>{onStop && event.state === 'running' && <button type="button" className="thread-subagent-stop" aria-label={t('subagent.stopLabel', { label })} title={t('subagent.stopTitle')} disabled={stopping} onClick={onStop}><Square size={12} aria-hidden="true" />{t('subagent.stop')}</button>}</header>
    {(event.model || event.reasoningEffort) && <p className="thread-subagent-config">{[event.model, event.reasoningEffort].filter(Boolean).join(' · ')}</p>}
    {(event.agents.length > 0 || event.receiverThreadIds.length > 0) && <svg data-ui="subagent-connector" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M12 2 C12 14 20 10 20 22" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>}
    {event.agents.length > 0 && <ul>{event.agents.map(agent => <li key={agent.threadId}><StatusSignal state={agentSignal(agent.status)} label={t(`subagent.state.${agent.status}`)} size={14} /><code title={agent.threadId}>{agent.threadId}</code><span>{t(`subagent.state.${agent.status}`)}</span>{agent.message && <details className="thread-subagent-result"><summary>{t('subagent.viewResult')}</summary><p>{agent.message}</p></details>}</li>)}</ul>}
    {!event.agents.length && event.receiverThreadIds.length > 0 && <ul>{event.receiverThreadIds.map(threadId => <li key={threadId}><StatusSignal state="waiting" label={t('subagent.state.pending')} size={14} /><code title={threadId}>{threadId}</code><span>{t('subagent.state.pending')}</span></li>)}</ul>}
    {event.prompt && <details><summary><ChevronDown size={12} aria-hidden="true" />{t('subagent.instructions')}</summary><p>{event.prompt}</p></details>}
  </article>
}
