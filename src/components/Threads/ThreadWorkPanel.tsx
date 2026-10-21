import { useCallback, useEffect, useState } from 'react'
import type { WorkRun, WorkTask } from '../../../shared/types/work'
import { formatThreadCost } from './ThreadCostChip'
import { humanizeError } from '../../utils/humanizeError'
import { LoadingState } from '../../ui'

const STATUS: Record<WorkTask['status'] | WorkRun['status'], string> = {
  pending: 'Waiting', ready: 'Ready', running: 'Running', blocked: 'Needs input', succeeded: 'Done', failed: 'Failed', cancelled: 'Cancelled'
}
const REFRESH_MS = 3000

export function budgetLabel(run: Pick<WorkRun, 'budget' | 'spent'>): string {
  const parts = [`${run.spent.turns} ${run.spent.turns === 1 ? 'turn' : 'turns'}${run.budget.turns ? ` of ${run.budget.turns}` : ''}`]
  if (run.spent.usd > 0 || run.budget.usd) parts.unshift(`≈ ${formatThreadCost(run.spent.usd)}${run.budget.usd ? ` of ${formatThreadCost(run.budget.usd)}` : ''}`)
  return parts.join(' · ')
}

function Task({ task, onOpenThread }: { task: WorkTask; onOpenThread(threadId: string): void }) {
  return <li className={`thread-work-task is-${task.status}`}>
    <div className="thread-work-task-head">
      <span className="thread-work-status">{STATUS[task.status]}</span>
      <strong title={task.prompt}>{task.title}</strong>
      <small>{task.key} · {task.provider} · {task.access === 'read-only' ? 'read-only' : 'can edit'}{task.dependsOn.length ? ` · after ${task.dependsOn.join(', ')}` : ''}</small>
      {task.threadId && <button type="button" onClick={() => onOpenThread(task.threadId!)}>Open</button>}
    </div>
    {task.reason && <p className="thread-work-reason">{task.reason}</p>}
    {task.result?.summary && <details><summary>Result{task.result.filesChanged.length ? ` · ${task.result.filesChanged.length} ${task.result.filesChanged.length === 1 ? 'file' : 'files'} changed` : ''}</summary><p className="thread-work-summary">{task.result.summary}</p></details>}
  </li>
}

/** Agent Work runs this conversation supervises or works for, with their tasks and spending. */
export default function ThreadWorkPanel({ threadId, onOpenThread }: { threadId: string; onOpenThread(threadId: string): void }) {
  const api = window.oxe?.thread
  const [runs, setRuns] = useState<WorkRun[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    if (!api?.workRuns) return
    setRuns(await api.workRuns(threadId))
  }, [api, threadId])
  useEffect(() => { void load().catch(cause => setError(humanizeError(cause, 'Could not load Agent Work'))) }, [load])
  const active = runs?.some(run => run.status === 'running') ?? false
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => { void load().catch(() => {}) }, REFRESH_MS)
    return () => clearInterval(timer)
  }, [active, load])
  if (!api?.workRuns) return <p>Agent Work is not available in this build.</p>
  const cancel = async (run: WorkRun) => {
    setBusy(true); setError('')
    try { await api.cancelWork!(threadId, run.id); await load() } catch (cause) { setError(humanizeError(cause, 'The run was not cancelled')) } finally { setBusy(false) }
  }
  return <div className="thread-work">
    {error && <p role="alert">{error}</p>}
    {runs === null ? <LoadingState label="Loading Agent Work…" /> : runs.length === 0 ? <p>No Agent Work yet. Ask the agent to split a job into parallel tasks; it plans them with <code>oxespace_work_plan</code> and each task runs in its own conversation.</p>
      : runs.map(run => <section key={run.id} className="thread-work-run" aria-label={`Run ${run.title}`}>
        <header>
          <div><h3>{run.title}</h3><small>{run.status === 'blocked' ? 'Stopped at budget' : STATUS[run.status]} · {budgetLabel(run)}{run.supervisorThreadId !== threadId ? ' · this conversation is a worker' : ''}</small></div>
          {run.supervisorThreadId !== threadId && <button type="button" onClick={() => onOpenThread(run.supervisorThreadId)}>Open supervisor</button>}
          {run.status === 'running' && <button type="button" disabled={busy} onClick={() => void cancel(run)}>Cancel run</button>}
        </header>
        <ul className="thread-work-tasks">{run.tasks.map(task => <Task key={task.id} task={task} onOpenThread={onOpenThread} />)}</ul>
      </section>)}
  </div>
}
