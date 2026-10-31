import { Activity, Check, CircleDot, RotateCw, Square, Trash2, X, Zap } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import type { BackgroundJob, BackgroundJobStatus } from '../../../shared/types/background'
import type { DelegationTask } from '../../../shared/types/delegation'
import { selectJobs, selectOutput, useBackgroundStore } from '../../store/background.store'
import { useTranslation } from 'react-i18next'
import { RichText } from '../../i18n/RichText'
import { shortcutLabel } from '../../keyboard/keybindings'
import { Button, EmptyState, ErrorState, Notice, Skeleton, toast } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'
import { formatDateTime } from '../../utils/formatTime'

interface BackgroundJobsPanelProps {
  workspaceId: string
}

const STATUS_FILTERS: Array<'all' | BackgroundJobStatus> = ['all', 'running', 'exited', 'failed', 'killed']

// Onda 4: this used to render its own modal shell with backdrop. After moving
// background jobs into the right-side dock (see WorkspaceBackgroundPanel),
// only the list contents live here. The dock wrapper provides the outer chrome.
export function BackgroundJobsPanel({ workspaceId }: BackgroundJobsPanelProps): ReactElement {
  const { t } = useTranslation('code')
  const jobsSelector = useCallback(selectJobs(workspaceId), [workspaceId])
  const jobs = useBackgroundStore(jobsSelector)
  const loadJobs = useBackgroundStore((s) => s.loadJobs)
  const loadOutput = useBackgroundStore((s) => s.loadOutput)
  const stopJob = useBackgroundStore((s) => s.stopJob)
  const removeJob = useBackgroundStore((s) => s.removeJob)
  const expandedJobId = useBackgroundStore((s) => s.expandedJobId)
  const setExpanded = useBackgroundStore((s) => s.setExpanded)
  const [filter, setFilter] = useState<'all' | BackgroundJobStatus>('all')
  const [source, setSource] = useState<'jobs' | 'delegated'>('jobs')
  const [delegated, setDelegated] = useState<DelegationTask[]>([])
  const [delegatedError, setDelegatedError] = useState('')
  const [delegatedLoading, setDelegatedLoading] = useState(false)
  const [delegatedRefresh, setDelegatedRefresh] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    void loadJobs(workspaceId)
  }, [workspaceId, loadJobs])

  useEffect(() => {
    if (source !== 'delegated' || !window.oxe?.delegation?.status) return
    let active = true
    const refresh = async (): Promise<void> => {
      setDelegatedLoading(true)
      try {
        const page = await window.oxe.delegation.status(workspaceId, undefined, 50)
        if (active) { setDelegated(page.tasks); setDelegatedError('') }
      } catch (error) {
        if (active) setDelegatedError(humanizeError(error))
      } finally {
        if (active) setDelegatedLoading(false)
      }
    }
    void refresh()
    const off = window.oxe.delegation.onChanged?.(event => { if (event.workspaceId === workspaceId) void refresh() })
    return () => { active = false; off?.() }
  }, [source, workspaceId, delegatedRefresh])

  const filtered = useMemo(() => {
    if (filter === 'all') return jobs
    return jobs.filter((j) => j.status === filter)
  }, [jobs, filter])

  const counts = useMemo(() => {
    const out: Record<string, number> = { all: jobs.length, running: 0, exited: 0, failed: 0, killed: 0, pending: 0 }
    for (const job of jobs) out[job.status] = (out[job.status] ?? 0) + 1
    return out
  }, [jobs])

  const handleRemove = async (job: BackgroundJob): Promise<void> => {
    setBusy(job.id)
    try {
      await removeJob(workspaceId, job.id)
    } catch (error) {
      toast({ title: t('background.removeFailed', { name: job.label }), description: humanizeError(error), intent: 'danger' })
    } finally {
      setBusy(null)
    }
  }

  const handleStop = async (job: BackgroundJob): Promise<void> => {
    setBusy(job.id)
    try {
      await stopJob(job.id)
      await loadJobs(workspaceId)
    } catch (error) {
      toast({ title: t('background.stopFailed', { name: job.label }), description: humanizeError(error), intent: 'danger' })
    } finally {
      setBusy(null)
    }
  }

  const handleToggleExpanded = (job: BackgroundJob): void => {
    const next = expandedJobId === job.id ? null : job.id
    setExpanded(next)
    if (next) void loadOutput(job.id)
  }

  return (
    <section className="bg-jobs-dock" aria-label={t('panels.background')}>
      <header className="bg-jobs-dock-toolbar">
        <span className="bg-jobs-dock-count">{source === 'jobs' ? t('background.jobs', { count: jobs.length }) : t('background.delegatedCount', { count: delegated.length })}</span>
        <Button
          variant="ghost" size="sm" square
          aria-label={t('background.refresh')}
          title={t('background.refresh')}
          onClick={() => { if (source === 'jobs') void loadJobs(workspaceId); else setDelegatedRefresh(value => value + 1) }}
        >
          <RotateCw size={12} aria-hidden="true" />
        </Button>
      </header>

      <nav className="bg-jobs-source-tabs" aria-label={t('background.source')}>
        <button type="button" aria-current={source === 'jobs' ? 'page' : undefined} onClick={() => setSource('jobs')}>{t('background.localJobs')}</button>
        <button type="button" aria-current={source === 'delegated' ? 'page' : undefined} onClick={() => setSource('delegated')}>{t('background.delegated')}</button>
      </nav>

      {source === 'jobs' ? <nav className="bg-jobs-dock-filters" aria-label={t('background.statusFilter')}>
        {STATUS_FILTERS.map((id) => (
          <button
            key={id}
            type="button"
            className={`bg-jobs-dock-filter${filter === id ? ' active' : ''}`}
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
          >
            {t(`background.status.${id}`)}
            <span className="bg-jobs-dock-filter-count">{counts[id] ?? 0}</span>
          </button>
        ))}
      </nav> : null}

      {source === 'delegated' ? <div className="bg-jobs-dock-list" aria-busy={delegatedLoading}>
        {delegatedError ? <ErrorState compact title={t('background.delegatedFailed')} message={delegatedError} onRetry={() => setDelegatedRefresh(value => value + 1)} /> : null}
        {delegatedLoading && delegated.length === 0 ? <Skeleton lines={3} label={t('background.delegatedLoading')} /> : null}
        {!delegatedLoading && !delegatedError && delegated.length === 0 ? <EmptyState icon={<Activity size={16} />} title={t('background.delegatedEmpty')}>{t('background.delegatedEmptyHint')}</EmptyState> : null}
        {delegated.map(task => <article key={task.id} className="bg-jobs-delegated-card">
          <div><strong>{task.objective}</strong><span data-state={task.state}>{t(`background.delegationState.${task.state}`)}</span></div>
          <small>{task.nativeSession?.provider ?? task.agentProfileId} · {task.branch} · {formatDateTime(task.updatedAt)}</small>
          {task.lastReport ? <p>{task.lastReport}</p> : null}
          {task.error ? <Notice intent="danger">{task.error}</Notice> : null}
        </article>)}
      </div> : <div className="bg-jobs-dock-list">
        {filtered.length === 0 ? (
          <EmptyState icon={<Activity size={16} />} title={filter === 'all' ? t('background.empty') : t('background.emptyStatus', { status: t(`background.status.${filter}`) })}>
            <RichText text={t('background.emptyHint', { shortcut: shortcutLabel('terminal.slash') ?? 'Ctrl+/' })} />
          </EmptyState>
        ) : (
          filtered.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              busy={busy === job.id}
              expanded={expandedJobId === job.id}
              onToggleExpanded={() => handleToggleExpanded(job)}
              onStop={() => void handleStop(job)}
              onRemove={() => void handleRemove(job)}
            />
          ))
        )}
      </div>}
    </section>
  )
}

interface JobCardProps {
  job: BackgroundJob
  busy: boolean
  expanded: boolean
  onToggleExpanded: () => void
  onStop: () => void
  onRemove: () => void
}

function JobCard({ busy, expanded, job, onRemove, onStop, onToggleExpanded }: JobCardProps): ReactElement {
  const { t } = useTranslation('code')
  const output = useBackgroundStore(useCallback(selectOutput(job.id), [job.id]))
  const isRunning = job.status === 'running' || job.status === 'pending'
  // A running job's clock keeps moving; a finished one shows how long it took.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!isRunning) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [isRunning])
  const elapsed = formatDuration(job.startedAtMs, job.finishedAtMs ?? now)

  return (
    <div className={`bg-jobs-dock-card status-${job.status}${expanded ? ' expanded' : ''}`}>
      <button
        type="button"
        className="bg-jobs-dock-card-main"
        aria-expanded={expanded}
        onClick={onToggleExpanded}
      >
        <StatusIcon status={job.status} />
        <span className="sr-only">{t(`background.status.${job.status === 'pending' ? 'running' : job.status}`)}</span>
        <div className="bg-jobs-dock-card-body">
          <div className="bg-jobs-dock-card-row">
            <strong title={job.label}>{job.label}</strong>
            <span className="bg-jobs-dock-card-elapsed">{elapsed}</span>
            {job.exitCode !== null ? <span className="bg-jobs-dock-card-exit">{t('background.exit', { code: job.exitCode })}</span> : null}
          </div>
          <span className="bg-jobs-dock-card-cwd" title={job.cwd}>{compactPath(job.cwd)}</span>
        </div>
      </button>
      <div className="bg-jobs-dock-card-actions">
        {isRunning ? (
          <button type="button" className="bg-jobs-dock-stop" aria-label={t('background.stopLabel', { name: job.label })} disabled={busy} onClick={(event) => { event.stopPropagation(); onStop() }}>
            <Square size={12} aria-hidden="true" /> {t('background.stop')}
          </button>
        ) : (
          <button
            type="button"
            className="bg-jobs-dock-remove"
            aria-label={t('background.removeLabel', { name: job.label })}
            title={t('background.removeTitle')}
            disabled={busy}
            onClick={(event) => { event.stopPropagation(); onRemove() }}
          >
            <Trash2 size={12} aria-hidden="true" />
          </button>
        )}
      </div>
      {expanded ? (
        <div className="bg-jobs-dock-output">
          <div className="bg-jobs-dock-output-header">
            <span>{t('background.output')}</span>
            <code>{job.command}</code>
          </div>
          {output.length > 0 ? (
            <pre>{formatOutput(output)}</pre>
          ) : (
            <EmptyState compact title={isRunning ? t('background.waitingOutput') : t('background.noOutput')} />
          )}
        </div>
      ) : null}
    </div>
  )
}

function StatusIcon({ status }: { status: BackgroundJobStatus }): ReactElement {
  switch (status) {
    case 'running': return <CircleDot size={12} className="bg-jobs-pulse status-running" aria-hidden="true" />
    case 'exited': return <Check size={12} className="status-exited" aria-hidden="true" />
    case 'failed': return <X size={12} className="status-failed" aria-hidden="true" />
    case 'killed': return <Square size={12} className="status-killed" aria-hidden="true" />
    case 'pending':
    default: return <Zap size={12} aria-hidden="true" />
  }
}

function formatDuration(start: number, end: number): string {
  const ms = end - start
  const sec = Math.max(0, Math.floor(ms / 1000))
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  const rem = sec % 60
  if (min < 60) return `${min}m ${rem.toString().padStart(2, '0')}s`
  const hr = Math.floor(min / 60)
  return `${hr}h ${(min % 60).toString().padStart(2, '0')}m`
}

function compactPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  if (parts.length <= 3) return path
  return '…' + path.slice(path.length - parts.slice(-3).join('/').length - 1)
}

function formatOutput(lines: string[]): string {
  return lines.map(stripAnsi).join('\n')
}

function stripAnsi(value: string): string {
  return value
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
}
