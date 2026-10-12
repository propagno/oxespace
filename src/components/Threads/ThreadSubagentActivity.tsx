import { Bot, ChevronDown, Square } from 'lucide-react'
import type { ThreadEvent } from '../../../shared/types/thread'

type SubagentEvent = Extract<ThreadEvent, { type: 'subagent' }>

const actionLabels: Record<string, string> = {
  spawnAgent: 'Started agent', sendInput: 'Sent input', sendMessage: 'Sent message', followupTask: 'Assigned follow-up',
  resumeAgent: 'Resumed agent', interruptAgent: 'Interrupted agent', closeAgent: 'Closed agent', wait: 'Waited for agents', listAgents: 'Listed agents'
}

export function ThreadSubagentActivity({ event, compact = false, onStop, stopping = false }: { event: SubagentEvent; compact?: boolean; onStop?: () => void; stopping?: boolean }) {
  const label = actionLabels[event.action] ?? event.action
  return <article className={`thread-subagent${compact ? ' is-compact' : ''}`}>
    <header><Bot size={14} aria-hidden="true" /><strong>{label}</strong><span className={`thread-subagent-state is-${event.state}`}>{event.state}</span>{onStop && event.state === 'running' && <button type="button" className="thread-subagent-stop" aria-label={`Stop ${label}`} title="Stop this background task" disabled={stopping} onClick={onStop}><Square size={11} aria-hidden="true" />Stop</button>}</header>
    {(event.model || event.reasoningEffort) && <p className="thread-subagent-config">{[event.model, event.reasoningEffort].filter(Boolean).join(' · ')}</p>}
    {event.agents.length > 0 && <ul>{event.agents.map(agent => <li key={agent.threadId}><span className={`thread-subagent-dot is-${agent.status}`} aria-hidden="true" /><code title={agent.threadId}>{agent.threadId}</code><span>{agent.status}</span>{agent.message && <details className="thread-subagent-result"><summary>View result</summary><p>{agent.message}</p></details>}</li>)}</ul>}
    {!event.agents.length && event.receiverThreadIds.length > 0 && <ul>{event.receiverThreadIds.map(threadId => <li key={threadId}><span className="thread-subagent-dot is-pending" aria-hidden="true" /><code title={threadId}>{threadId}</code><span>pending</span></li>)}</ul>}
    {event.prompt && <details><summary><ChevronDown size={12} aria-hidden="true" />Instructions</summary><p>{event.prompt}</p></details>}
  </article>
}
