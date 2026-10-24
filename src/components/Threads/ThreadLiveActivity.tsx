import { AlertCircle, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ThreadEvent, ThreadSnapshot } from '../../../shared/types/thread'
import { useThreadStateCheck } from './useThreadStateCheck'
import { threadToolSummary } from '../../../shared/threadToolSummary'
import { useThreadViewModeStore } from '../../store/thread-view-mode.store'

type Tool = Extract<ThreadEvent, { type: 'tool' }>
type ActivityEvent = Extract<ThreadEvent, { type: 'activity' }>

function duration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}

function runningToolLabel(tool: Tool, verbose = true): string {
  if (tool.name === 'commandExecution' || tool.name === 'Bash') return verbose ? `Running command${tool.detail ? `: ${threadToolSummary(tool)}` : ''}` : 'Running a command'
  if (tool.name === 'Read') return 'Reading file'
  if (tool.name === 'Grep' || tool.name === 'Glob') return 'Searching the project'
  if (tool.name === 'fileChange' || tool.name === 'Edit' || tool.name === 'Write') return 'Editing files'
  return `Using ${tool.name}`
}

/** A running tool is slow past three times its usual run in this conversation, and never before this. */
export const SLOW_TOOL_MIN_MS = 30_000

/** The median run of earlier calls of the same tool in this conversation; null when there are none. */
export function usualToolRun(events: ThreadEvent[], name: string): number | null {
  const runs = events.filter((event): event is Tool => event.type === 'tool' && event.name === name && event.state === 'completed' && event.startedAt !== undefined && event.completedAt !== undefined)
    .map(event => event.completedAt! - event.startedAt!).filter(run => run >= 0).sort((a, b) => a - b)
  return runs.length ? runs[Math.floor(runs.length / 2)] : null
}

export { BACKGROUND_TRUST_MS } from '../../../shared/threadBackground'
import { BACKGROUND_TRUST_MS } from '../../../shared/threadBackground'

export interface LiveActivity {
  label: string
  elapsed: string
  signalAge: string
  stale: boolean
  awaitingInput: boolean
  /** A request the person can answer is on screen: its card already says what is awaited. */
  actionableRequest: boolean
  reconnecting: boolean
  /** False once the turn is over and only background work is being waited for. */
  turnRunning: boolean
  /** Provider ids of the background tasks still listed as running. */
  taskIds: string[]
  /** How long the running tool has been running, when it reported its start. */
  toolElapsed?: string
  /** The running tool is taking much longer than it usually does here. */
  slowTool: boolean
}

/** A status is evidence of a provider event or transport data, never an inferred thought. */
export function deriveThreadLiveActivity(snapshot: ThreadSnapshot, now: number, verbose = true): LiveActivity | null {
  const thread = snapshot.thread
  // A background task whose end the provider never reported would otherwise keep this panel (and
  // its clock) alive for good; after this long it is no longer shown as active.
  const background = snapshot.events.filter(event => event.type === 'subagent' && event.state === 'running' && (event.startedAt === undefined || now - event.startedAt < BACKGROUND_TRUST_MS))
  const turnRunning = thread.status === 'running' || thread.status === 'approval'
  if (!turnRunning && !background.length) return null
  const turn = snapshot.turns?.at(-1)
  const backgroundStart = Math.min(...background.map(event => event.type === 'subagent' ? event.startedAt ?? now : now))
  // With the turn finished, the clock measures the background work, not a turn that is over.
  const startedAt = turnRunning ? turn?.startedAt ?? thread.updatedAt : Number.isFinite(backgroundStart) ? backgroundStart : thread.updatedAt
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
  const actionableRequest = (snapshot.pendingRequests?.length ?? events.filter(event => event.type === 'request' && event.request.state === 'pending').length) > 0 || events.some(event => event.type === 'approval' && !events.some(other => other.type === 'approval-resolved' && other.id === event.id))
  const connection = thread.connection
  const lastSignal = connection?.lastNativeSignalAt && connection.lastNativeSignalAt >= startedAt ? connection.lastNativeSignalAt : undefined
  const signalAgeMs = now - (lastSignal ?? startedAt)
  let label = 'Waiting for the next agent update'
  if (awaitingInput) label = thread.status === 'approval' && !actionableRequest && signalAgeMs >= 60_000 ? 'Input request unavailable' : 'Waiting for your input'
  else if (connection?.state === 'degraded' || connection?.state === 'reconnecting') label = 'Reconnecting to the agent'
  else if (background.length && !turnRunning) label = `Waiting for ${background.length} background ${background.length === 1 ? 'task' : 'tasks'}`
  else if (runningTool) label = runningToolLabel(runningTool, verbose)
  else if (activity?.phase === 'preparing') label = 'Preparing project context'
  else if (connection?.state === 'starting' || activity?.phase === 'connecting' && connection?.state !== 'connected') label = 'Connecting to the agent'
  else if (activity?.phase === 'responding' && now - activity.at < 15_000) label = 'Receiving response'
  else if (activity?.phase === 'reasoning') label = 'Analyzing request'
  const toolRunMs = !awaitingInput && runningTool?.startedAt !== undefined ? now - runningTool.startedAt : undefined
  const usual = runningTool ? usualToolRun(snapshot.events, runningTool.name) : null
  const slowTool = toolRunMs !== undefined && toolRunMs >= Math.max(SLOW_TOOL_MIN_MS, (usual ?? 0) * 3)
  return {
    label, elapsed: duration(now - startedAt),
    ...(toolRunMs !== undefined ? { toolElapsed: duration(toolRunMs) } : {}),
    slowTool,
    signalAge: !turnRunning ? 'Background work reported by the provider' : lastSignal ? `Last provider signal ${duration(signalAgeMs)} ago` : `No provider signal yet · ${duration(signalAgeMs)}`,
    // Quiet background work is normal; only a running turn that goes silent is a doubt worth showing.
    stale: turnRunning && signalAgeMs >= 60_000 && (!awaitingInput || !actionableRequest),
    awaitingInput,
    actionableRequest,
    turnRunning,
    taskIds: turnRunning ? [] : background.flatMap(event => event.type === 'subagent' ? event.receiverThreadIds : []),
    reconnecting: connection?.state === 'degraded' || connection?.state === 'reconnecting'
  }
}

export function ThreadLiveActivity({ snapshot }: { snapshot: ThreadSnapshot }) {
  const [now, setNow] = useState(Date.now())
  const [stopping, setStopping] = useState(false)
  useEffect(() => {
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [snapshot.thread.id])
  const viewMode = useThreadViewModeStore(state => state.mode)
  const activity = deriveThreadLiveActivity(snapshot, now, viewMode === 'verbose')
  const check = useThreadStateCheck(snapshot, activity?.awaitingInput ?? false)
  const terminalObserved = check.observation && ['completed', 'failed', 'interrupted'].includes(check.observation.state)
  // Waiting on a request whose card is on screen: that card is the status, a banner above it would repeat it.
  if (!activity || activity.awaitingInput && activity.actionableRequest && !activity.stale) return null
  return <section className={`thread-live-activity${activity.stale ? ' is-stale' : ''}${activity.awaitingInput ? ' is-awaiting-input' : ''}${activity.reconnecting ? ' is-reconnecting' : ''}`} aria-label="Current agent activity">
    <div className="thread-live-activity-main">
      {activity.stale || activity.awaitingInput ? <AlertCircle size={14} aria-hidden="true" /> : <Loader2 size={14} className="thread-spin" aria-hidden="true" />}
      <span role="status"><strong title={activity.label}>{activity.stale && !activity.awaitingInput ? terminalObserved ? 'Provider result available · synchronizing required' : check.observation?.state === 'running' ? 'Provider confirms execution is active' : check.observation?.state === 'awaiting-input' ? 'Provider is waiting for input' : 'Waiting for a confirmed provider update' : activity.label}</strong>
        {activity.toolElapsed && !activity.stale && <span className="thread-live-activity-tool"> · {activity.toolElapsed}</span>}
        {activity.slowTool && !activity.stale && <span className="thread-live-activity-slow" title="This step is taking much longer than the same step took earlier in this conversation"> · taking longer than usual</span>}</span><time title="Total time for this turn, including previous commands and waiting for input" aria-label={`Turn elapsed ${activity.elapsed}`}>Turn · {activity.elapsed}</time>
    </div>
    {!activity.turnRunning && activity.taskIds.length > 0 && <button type="button" className="thread-live-activity-stop" disabled={stopping} onClick={() => {
      setStopping(true)
      void Promise.allSettled(activity.taskIds.map(taskId => window.oxe.thread?.stopTask?.(snapshot.thread.id, taskId))).finally(() => setStopping(false))
    }}>{stopping ? 'Stopping…' : 'Stop waiting'}</button>}
    <div className="thread-live-activity-meta"><span>{activity.signalAge}</span>{activity.stale && <>{!terminalObserved && <span>Execution may still be active.</span>}</>}</div>
    {activity.stale && <div className="thread-live-activity-meta" role="status">
      {check.checking ? <span>Checking provider state…</span> : check.observation && <span>{check.observation.state === 'running' ? 'Provider confirms execution is active.' : check.observation.state === 'awaiting-input' ? 'Provider is waiting for input. Open Diagnostics to inspect the request.' : check.observation.state === 'completed' || check.observation.state === 'failed' || check.observation.state === 'interrupted' ? `Provider reports ${check.observation.state}. Local output still needs reconciliation.` : 'Execution outcome is not confirmed. Your message was not resent.'}</span>}
    </div>}
  </section>
}
