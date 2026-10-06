import { Activity, AlertCircle, ChevronDown, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ThreadEvent, ThreadSnapshot } from '../../../shared/types/thread'
import { useThreadStateCheck } from './useThreadStateCheck'
import { threadToolSummary } from '../../../shared/threadToolSummary'

type Tool = Extract<ThreadEvent, { type: 'tool' }>
type ActivityEvent = Extract<ThreadEvent, { type: 'activity' }>

function duration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}

function runningToolLabel(tool: Tool): string {
  if (tool.name === 'commandExecution' || tool.name === 'Bash') return `Running command${tool.detail ? `: ${threadToolSummary(tool)}` : ''}`
  if (tool.name === 'Read') return 'Reading file'
  if (tool.name === 'Grep' || tool.name === 'Glob') return 'Searching the project'
  if (tool.name === 'fileChange' || tool.name === 'Edit' || tool.name === 'Write') return 'Editing files'
  return `Using ${tool.name}`
}

export interface LiveActivity {
  label: string
  elapsed: string
  signalAge: string
  stale: boolean
  awaitingInput: boolean
  reconnecting: boolean
  summary?: string
  tools: Tool[]
}

/** A status is evidence of a provider event or transport data, never an inferred thought. */
export function deriveThreadLiveActivity(snapshot: ThreadSnapshot, now: number): LiveActivity | null {
  const thread = snapshot.thread
  const background = snapshot.events.filter(event => event.type === 'subagent' && event.state === 'running')
  if (thread.status !== 'running' && thread.status !== 'approval' && !background.length) return null
  const turn = snapshot.turns?.at(-1)
  const startedAt = turn?.startedAt ?? thread.updatedAt
  let startIndex = -1
  for (let index = snapshot.events.length - 1; index >= 0; index--) {
    const event = snapshot.events[index]
    if (event.type === 'message' && event.role === 'user') { startIndex = index; break }
  }
  const events = snapshot.events.slice(Math.max(0, startIndex))
  const tools = events.filter((event): event is Tool => event.type === 'tool')
  const activity = events.filter((event): event is ActivityEvent => event.type === 'activity').at(-1)
  const runningTool = [...tools].reverse().find(event => event.state === 'running')
  const awaitingInput = thread.status === 'approval' || events.some(event => event.type === 'request' && event.request.state === 'pending')
  const connection = thread.connection
  let label = 'Waiting for the next agent update'
  if (awaitingInput) label = 'Waiting for your input'
  else if (connection?.state === 'degraded' || connection?.state === 'reconnecting') label = 'Reconnecting to the agent'
  else if (runningTool) label = runningToolLabel(runningTool)
  else if (activity?.phase === 'preparing') label = 'Preparing project context'
  else if (connection?.state === 'starting' || activity?.phase === 'connecting' && connection?.state !== 'connected') label = 'Connecting to the agent'
  else if (background.length && thread.status !== 'running') label = `Waiting for ${background.length} background ${background.length === 1 ? 'task' : 'tasks'}`
  else if (activity?.phase === 'responding' && now - activity.at < 15_000) label = 'Receiving response'
  else if (activity?.phase === 'reasoning') label = 'Analyzing request'
  const lastSignal = connection?.lastNativeSignalAt && connection.lastNativeSignalAt >= startedAt ? connection.lastNativeSignalAt : undefined
  const signalAgeMs = now - (lastSignal ?? startedAt)
  return {
    label, elapsed: duration(now - startedAt),
    signalAge: lastSignal ? `Last provider signal ${duration(signalAgeMs)} ago` : `No provider signal yet · ${duration(signalAgeMs)}`,
    stale: !awaitingInput && signalAgeMs >= 60_000,
    awaitingInput,
    reconnecting: connection?.state === 'degraded' || connection?.state === 'reconnecting',
    summary: activity?.summary,
    tools: tools.slice(-4)
  }
}

export function ThreadLiveActivity({ snapshot, onDiagnostics }: { snapshot: ThreadSnapshot; onDiagnostics(): void }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [snapshot.thread.id])
  const activity = deriveThreadLiveActivity(snapshot, now)
  const check = useThreadStateCheck(snapshot, activity?.awaitingInput ?? false)
  const terminalObserved = check.observation && ['completed', 'failed', 'interrupted'].includes(check.observation.state)
  if (!activity) return null
  return <section className={`thread-live-activity${activity.stale ? ' is-stale' : ''}${activity.awaitingInput ? ' is-awaiting-input' : ''}${activity.reconnecting ? ' is-reconnecting' : ''}`} aria-label="Current agent activity">
    <div className="thread-live-activity-main">
      {activity.stale || activity.awaitingInput ? <AlertCircle size={14} aria-hidden="true" /> : <Loader2 size={14} className="thread-spin" aria-hidden="true" />}
      <span role="status"><strong>{activity.stale ? terminalObserved ? 'Provider result available · synchronizing required' : check.observation?.state === 'running' ? 'Provider confirms execution is active' : check.observation?.state === 'awaiting-input' ? 'Provider is waiting for input' : 'Waiting for a confirmed provider update' : activity.label}</strong></span><time aria-label={`Elapsed ${activity.elapsed}`}>{activity.elapsed}</time>
    </div>
    <div className="thread-live-activity-meta"><span>{activity.signalAge}</span>{activity.stale && <>{!terminalObserved && <span>Execution may still be active.</span>}<button type="button" onClick={onDiagnostics}>Diagnostics</button></>}</div>
    {activity.stale && <div className="thread-live-activity-meta" role="status">
      {check.checking ? <span>Checking provider state…</span> : check.observation && <span>{check.observation.state === 'running' ? 'Provider confirms execution is active.' : check.observation.state === 'awaiting-input' ? 'Provider is waiting for input. Open Diagnostics to inspect the request.' : check.observation.state === 'completed' || check.observation.state === 'failed' || check.observation.state === 'interrupted' ? `Provider reports ${check.observation.state}. Local output still needs reconciliation.` : 'Execution outcome is not confirmed. Your message was not resent.'}</span>}
    </div>}
    {(activity.summary || activity.tools.length > 0) && <details className="thread-live-activity-details">
      <summary><Activity size={12} />Recent activity<ChevronDown size={12} /></summary>
      {activity.summary && <p><strong>Provider summary</strong>{activity.summary}</p>}
      {activity.tools.length > 0 && <ul>{activity.tools.map(tool => <li key={tool.id}><span>{tool.name}{tool.detail && <small> · {threadToolSummary(tool)}</small>}</span><small>{tool.state}</small></li>)}</ul>}
    </details>}
  </section>
}
