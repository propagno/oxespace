import { AlertCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { i18n } from '../../i18n'
import { Spinner } from '../../ui'
import type { ThreadEvent, ThreadSnapshot } from '../../../shared/types/thread'
import { useThreadStateCheck } from './useThreadStateCheck'
import { threadToolSummary } from '../../../shared/threadToolSummary'
import { useThreadViewModeStore } from '../../store/thread-view-mode.store'

type Tool = Extract<ThreadEvent, { type: 'tool' }>
type ActivityEvent = Extract<ThreadEvent, { type: 'activity' }>

function duration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000))
  return seconds < 60 ? i18n.t('thread:live.seconds', { seconds }) : i18n.t('thread:live.minutes', { minutes: Math.floor(seconds / 60), seconds: String(seconds % 60).padStart(2, '0') })
}

function runningToolLabel(tool: Tool, verbose = true): string {
  const t = i18n.t.bind(i18n)
  if (tool.name === 'commandExecution' || tool.name === 'Bash') return verbose ? tool.detail ? t('thread:live.runningCommandDetail', { detail: threadToolSummary(tool) }) : t('thread:live.runningCommand') : t('thread:live.runningACommand')
  if (tool.name === 'Read') return t('thread:live.reading')
  if (tool.name === 'Grep' || tool.name === 'Glob') return t('thread:live.searching')
  if (tool.name === 'fileChange' || tool.name === 'Edit' || tool.name === 'Write') return t('thread:live.editing')
  return t('thread:live.using', { tool: tool.name })
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
  const t = i18n.t.bind(i18n)
  let label = t('thread:live.waitingUpdate')
  if (awaitingInput) label = thread.status === 'approval' && !actionableRequest && signalAgeMs >= 60_000 ? t('thread:live.requestUnavailable') : t('thread:live.waitingInput')
  else if (connection?.state === 'degraded' || connection?.state === 'reconnecting') label = t('thread:live.reconnecting')
  else if (background.length && !turnRunning) label = t('thread:live.waitingBackground', { count: background.length })
  else if (runningTool) label = runningToolLabel(runningTool, verbose)
  else if (activity?.phase === 'preparing') label = t('thread:live.preparing')
  else if (connection?.state === 'starting' || activity?.phase === 'connecting' && connection?.state !== 'connected') label = t('thread:live.connecting')
  else if (activity?.phase === 'responding' && now - activity.at < 15_000) label = t('thread:live.receiving')
  else if (activity?.phase === 'reasoning') label = t('thread:live.analyzing')
  const toolRunMs = !awaitingInput && runningTool?.startedAt !== undefined ? now - runningTool.startedAt : undefined
  const usual = runningTool ? usualToolRun(snapshot.events, runningTool.name) : null
  const slowTool = toolRunMs !== undefined && toolRunMs >= Math.max(SLOW_TOOL_MIN_MS, (usual ?? 0) * 3)
  return {
    label, elapsed: duration(now - startedAt),
    ...(toolRunMs !== undefined ? { toolElapsed: duration(toolRunMs) } : {}),
    slowTool,
    signalAge: !turnRunning ? t('thread:live.backgroundReported') : lastSignal ? t('thread:live.lastSignal', { age: duration(signalAgeMs) }) : t('thread:live.noSignal', { age: duration(signalAgeMs) }),
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
  const { t } = useTranslation('thread')
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
  return <section className={`thread-live-activity${activity.stale ? ' is-stale' : ''}${activity.awaitingInput ? ' is-awaiting-input' : ''}${activity.reconnecting ? ' is-reconnecting' : ''}`} aria-label={t('live.label')}>
    <div className="thread-live-activity-main">
      {activity.stale || activity.awaitingInput ? <AlertCircle size={14} aria-hidden="true" /> : <Spinner size="sm" decorative />}
      <span role="status"><strong title={activity.label}>{activity.stale && !activity.awaitingInput ? terminalObserved ? t('live.resultAvailable') : check.observation?.state === 'running' ? t('live.confirmsActive') : check.observation?.state === 'awaiting-input' ? t('live.waitingProviderInput') : t('live.waitingConfirmed') : activity.label}</strong>
        {activity.toolElapsed && !activity.stale && <span className="thread-live-activity-tool"> · {activity.toolElapsed}</span>}
        {activity.slowTool && !activity.stale && <span className="thread-live-activity-slow" title={t('live.slowTitle')}>{t('live.slow')}</span>}</span><time title={t('live.turnTitle')} aria-label={t('live.turnElapsed', { time: activity.elapsed })}>{t('live.turn', { time: activity.elapsed })}</time>
    </div>
    {!activity.turnRunning && activity.taskIds.length > 0 && <button type="button" className="thread-live-activity-stop" disabled={stopping} onClick={() => {
      setStopping(true)
      void Promise.allSettled(activity.taskIds.map(taskId => window.oxe.thread?.stopTask?.(snapshot.thread.id, taskId))).finally(() => setStopping(false))
    }}>{stopping ? t('live.stopping') : t('live.stopWaiting')}</button>}
    <div className="thread-live-activity-meta"><span>{activity.signalAge}</span>{activity.stale && <>{!terminalObserved && <span>{t('live.mayBeActive')}</span>}</>}</div>
    {activity.stale && <div className="thread-live-activity-meta" role="status">
      {check.checking ? <span>{t('live.checking')}</span> : check.observation && <span>{check.observation.state === 'running' ? t('live.confirmsActiveFull') : check.observation.state === 'awaiting-input' ? t('live.waitingInputFull') : check.observation.state === 'completed' || check.observation.state === 'failed' || check.observation.state === 'interrupted' ? t('live.reportsState', { state: t(`live.state.${check.observation.state}`) }) : t('live.notConfirmed')}</span>}
    </div>}
  </section>
}
