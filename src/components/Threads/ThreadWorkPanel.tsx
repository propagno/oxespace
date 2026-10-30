import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { WorkRun, WorkTask } from '../../../shared/types/work'
import { formatThreadCost } from './threadCost'
import { humanizeError } from '../../utils/humanizeError'
import { i18n } from '../../i18n'
import { EmptyState, ErrorState, LoadingState } from '../../ui'
import { ThreadRichText } from './ThreadRichText'

const REFRESH_MS = 3000

export function budgetLabel(run: Pick<WorkRun, 'budget' | 'spent'>): string {
  const t = i18n.t.bind(i18n)
  const parts = [run.budget.turns ? t('thread:work.turnsOf', { count: run.spent.turns, budget: run.budget.turns }) : t('thread:work.turns', { count: run.spent.turns })]
  if (run.spent.usd > 0 || run.budget.usd) parts.unshift(run.budget.usd ? t('thread:work.costOf', { cost: formatThreadCost(run.spent.usd), budget: formatThreadCost(run.budget.usd) }) : t('thread:work.cost', { cost: formatThreadCost(run.spent.usd) }))
  return parts.join(' · ')
}

function Task({ task, onOpenThread }: { task: WorkTask; onOpenThread(threadId: string): void }) {
  const { t } = useTranslation('thread')
  const files = task.result?.filesChanged.length ?? 0
  return <li className={`thread-work-task is-${task.status}`}>
    <div className="thread-work-task-head">
      <span className="thread-work-status">{t(`work.status.${task.status}`)}</span>
      <strong title={task.prompt}>{task.title}</strong>
      <small>{task.key} · {task.provider} · {task.access === 'read-only' ? t('work.readOnly') : t('work.canEdit')}{task.dependsOn.length ? ` · ${t('work.after', { tasks: task.dependsOn.join(', ') })}` : ''}</small>
      {task.threadId && <button type="button" onClick={() => onOpenThread(task.threadId!)}>{t('work.open')}</button>}
    </div>
    {task.reason && <p className="thread-work-reason">{task.reason}</p>}
    {task.result?.summary && <details><summary>{files ? t('work.resultFiles', { count: files }) : t('work.result')}</summary><p className="thread-work-summary">{task.result.summary}</p></details>}
  </li>
}

/** Agent Work runs this conversation supervises or works for, with their tasks and spending. */
export default function ThreadWorkPanel({ threadId, onOpenThread }: { threadId: string; onOpenThread(threadId: string): void }) {
  const { t } = useTranslation('thread')
  const api = window.oxe?.thread
  const [runs, setRuns] = useState<WorkRun[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    if (!api?.workRuns) return
    setRuns(await api.workRuns(threadId))
  }, [api, threadId])
  useEffect(() => { void load().catch(cause => setError(humanizeError(cause, t('work.loadFailed')))) }, [load])
  const active = runs?.some(run => run.status === 'running') ?? false
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => { void load().catch(() => {}) }, REFRESH_MS)
    return () => clearInterval(timer)
  }, [active, load])
  if (!api?.workRuns) return <EmptyState compact title={t('work.unavailable')} />
  const cancel = async (run: WorkRun) => {
    setBusy(true); setError('')
    try { await api.cancelWork!(threadId, run.id); await load() } catch (cause) { setError(humanizeError(cause, t('work.cancelFailed'))) } finally { setBusy(false) }
  }
  return <div className="thread-work">
    {error && <ErrorState compact title={error} />}
    {runs === null ? <LoadingState label={t('work.loading')} /> : runs.length === 0 ? <EmptyState compact title={t('work.empty')}><ThreadRichText text={t('work.emptyHint')} /></EmptyState>
      : runs.map(run => <section key={run.id} className="thread-work-run" aria-label={t('work.run', { title: run.title })}>
        <header>
          <div><h3>{run.title}</h3><small>{run.status === 'blocked' ? t('work.stoppedAtBudget') : t(`work.status.${run.status}`)} · {budgetLabel(run)}{run.supervisorThreadId !== threadId ? t('work.isWorker') : ''}</small></div>
          {run.supervisorThreadId !== threadId && <button type="button" onClick={() => onOpenThread(run.supervisorThreadId)}>{t('work.openSupervisor')}</button>}
          {run.status === 'running' && <button type="button" disabled={busy} onClick={() => void cancel(run)}>{t('work.cancel')}</button>}
        </header>
        <ul className="thread-work-tasks">{run.tasks.map(task => <Task key={task.id} task={task} onOpenThread={onOpenThread} />)}</ul>
      </section>)}
  </div>
}
