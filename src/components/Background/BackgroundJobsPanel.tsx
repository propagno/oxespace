import { Activity, Check, CircleDot, RotateCw, Square, Trash2, X, Zap } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import type { BackgroundJob, BackgroundJobStatus } from '../../../shared/types/background'
import { selectJobs, selectOutput, useBackgroundStore } from '../../store/background.store'

interface BackgroundJobsPanelProps {
  workspaceId: string
}

const STATUS_FILTERS: Array<{ id: 'all' | BackgroundJobStatus; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'running', label: 'Running' },
  { id: 'exited', label: 'Exited' },
  { id: 'failed', label: 'Failed' },
  { id: 'killed', label: 'Killed' }
]

// Onda 4: this used to render its own modal shell with backdrop. After moving
// background jobs into the right-side dock (see WorkspaceBackgroundPanel),
// only the list contents live here. The dock wrapper provides the outer chrome.
export function BackgroundJobsPanel({ workspaceId }: BackgroundJobsPanelProps): ReactElement {
  const jobsSelector = useCallback(selectJobs(workspaceId), [workspaceId])
  const jobs = useBackgroundStore(jobsSelector)
  const loadJobs = useBackgroundStore((s) => s.loadJobs)
  const loadOutput = useBackgroundStore((s) => s.loadOutput)
  const stopJob = useBackgroundStore((s) => s.stopJob)
  const removeJob = useBackgroundStore((s) => s.removeJob)
  const expandedJobId = useBackgroundStore((s) => s.expandedJobId)
  const setExpanded = useBackgroundStore((s) => s.setExpanded)
  const [filter, setFilter] = useState<'all' | BackgroundJobStatus>('all')
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    void loadJobs(workspaceId)
  }, [workspaceId, loadJobs])

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
    } finally {
      setBusy(null)
    }
  }

  const handleStop = async (job: BackgroundJob): Promise<void> => {
    setBusy(job.id)
    try {
      await stopJob(job.id)
      await loadJobs(workspaceId)
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
    <section className="bg-jobs-dock" aria-label="Background jobs">
      <header className="bg-jobs-dock-toolbar">
        <span className="bg-jobs-dock-count">{jobs.length} job{jobs.length === 1 ? '' : 's'}</span>
        <button
          type="button"
          className="icon-button"
          aria-label="Refresh background jobs"
          onClick={() => void loadJobs(workspaceId)}
        >
          <RotateCw size={12} aria-hidden="true" />
        </button>
      </header>

      <nav className="bg-jobs-dock-filters" aria-label="Status filter">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`bg-jobs-dock-filter${filter === f.id ? ' active' : ''}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
            <span className="bg-jobs-dock-filter-count">{counts[f.id] ?? 0}</span>
          </button>
        ))}
      </nav>

      <div className="bg-jobs-dock-list">
        {filtered.length === 0 ? (
          <div className="bg-jobs-dock-empty">
            <Activity size={24} aria-hidden="true" />
            <strong>No job{filter !== 'all' ? ` with status "${filter}"` : 's'}</strong>
            <span>
              Run a background command via <kbd>Ctrl+/</kbd> → <code>/bg npm run build</code>.
            </span>
          </div>
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
      </div>
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
  const elapsed = useMemo(() => formatDuration(job.startedAtMs, job.finishedAtMs), [job.startedAtMs, job.finishedAtMs])
  const output = useBackgroundStore(useCallback(selectOutput(job.id), [job.id]))
  const isRunning = job.status === 'running' || job.status === 'pending'

  return (
    <div className={`bg-jobs-dock-card status-${job.status}${expanded ? ' expanded' : ''}`}>
      <button
        type="button"
        className="bg-jobs-dock-card-main"
        aria-expanded={expanded}
        onClick={onToggleExpanded}
      >
        <StatusIcon status={job.status} />
        <div className="bg-jobs-dock-card-body">
          <div className="bg-jobs-dock-card-row">
            <strong title={job.label}>{job.label}</strong>
            <span className="bg-jobs-dock-card-elapsed">{elapsed}</span>
            {job.exitCode !== null ? <span className="bg-jobs-dock-card-exit">exit {job.exitCode}</span> : null}
          </div>
          <span className="bg-jobs-dock-card-cwd" title={job.cwd}>{compactPath(job.cwd)}</span>
        </div>
      </button>
      <div className="bg-jobs-dock-card-actions">
        {isRunning ? (
          <button type="button" className="bg-jobs-dock-stop" aria-label="Stop job" disabled={busy} onClick={(event) => { event.stopPropagation(); onStop() }}>
            <Square size={11} aria-hidden="true" /> Stop
          </button>
        ) : (
          <button
            type="button"
            className="bg-jobs-dock-remove"
            aria-label="Remove job from history"
            title="Remove from history"
            disabled={busy}
            onClick={(event) => { event.stopPropagation(); onRemove() }}
          >
            <Trash2 size={11} aria-hidden="true" />
          </button>
        )}
      </div>
      {expanded ? (
        <div className="bg-jobs-dock-output">
          <div className="bg-jobs-dock-output-header">
            <span>Output</span>
            <code>{job.command}</code>
          </div>
          {output.length > 0 ? (
            <pre>{formatOutput(output)}</pre>
          ) : (
            <div className="bg-jobs-dock-output-empty">
              {isRunning ? 'Aguardando output do processo...' : 'Nenhum output capturado para este job.'}
            </div>
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

function formatDuration(start: number, end: number | null): string {
  const ms = (end ?? Date.now()) - start
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
