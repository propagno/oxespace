import { Check, ChevronDown, CircleDashed, ExternalLink, GitMerge, GitPullRequest, Loader2, Wrench, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { GitHubCheckState, GitHubPrStatus } from '../../../shared/types/github'
import './PrStatusBar.css'

const POLL_MS = 30_000

const ICON: Record<GitHubCheckState, ReactElement> = {
  success: <Check size={13} aria-hidden="true" />,
  failure: <X size={13} aria-hidden="true" />,
  pending: <CircleDashed size={13} aria-hidden="true" />,
  neutral: <Check size={13} aria-hidden="true" />
}
const LABEL: Record<GitHubCheckState, string> = { success: 'Passed', failure: 'Failed', pending: 'Running', neutral: 'Skipped' }

/** Prompt handed to the agent when the user asks it to repair CI. Plain text so any provider can act on it. */
export function ciFixPrompt(status: GitHubPrStatus): string {
  const failing = status.checks.filter(check => check.state === 'failure')
  const lines = failing.map(check => `- ${check.name}${check.workflow ? ` (${check.workflow})` : ''}${check.url ? `: ${check.url}` : ''}`)
  return [
    `CI is failing on pull request #${status.number}${status.headRefName ? ` (branch ${status.headRefName})` : ''}.`,
    '',
    'Failing checks:',
    ...lines,
    '',
    'Read the failure output (for example with `gh run view --log-failed` or the check links), fix the cause in this project, run the relevant checks locally, and push the fix to the branch.'
  ].join('\n')
}

/**
 * CI status bar for the checked-out branch's pull request: rollup counts,
 * per-check list, "fix failing checks" and auto-merge. Renders nothing when
 * there is no pull request (or gh is unavailable), so it is safe to mount anywhere.
 */
export function PrStatusBar({ workspaceId, rootPath, onFix }: {
  workspaceId: string; rootPath: string
  /** Receives a ready-made prompt; the host decides where it goes (composer, terminal). */
  onFix?: (prompt: string) => void
}): ReactElement | null {
  const [status, setStatus] = useState<GitHubPrStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const request = useRef(0)

  const load = useCallback(async (): Promise<void> => {
    const github = window.oxe.github
    if (!github?.getPullRequestStatus) return
    const id = ++request.current
    try {
      const value = await github.getPullRequestStatus({ workspaceId, rootPath })
      if (id === request.current) setStatus(value ?? null)
    } catch { if (id === request.current) setStatus(null) }
  }, [workspaceId, rootPath])

  useEffect(() => {
    setStatus(null)
    void load()
    const refresh = (): void => { if (document.visibilityState !== 'hidden') void load() }
    const timer = window.setInterval(refresh, POLL_MS)
    window.addEventListener('focus', refresh)
    return () => { request.current += 1; window.clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [load])

  const counts = useMemo(() => {
    const total = { success: 0, failure: 0, pending: 0, neutral: 0 }
    for (const check of status?.checks ?? []) total[check.state] += 1
    return total
  }, [status])

  if (!status || status.state !== 'OPEN') return null
  const failing = counts.failure > 0
  const tone = failing ? 'failure' : counts.pending > 0 ? 'pending' : 'success'
  const summary = status.checks.length === 0 ? 'No checks reported'
    : failing ? `${counts.failure} failing${counts.pending ? `, ${counts.pending} running` : ''}`
      : counts.pending > 0 ? `${counts.pending} running` : 'All checks passed'

  const toggleAutoMerge = async (): Promise<void> => {
    setBusy(true); setNotice('')
    try {
      await window.oxe.github.setPullRequestAutoMerge({ workspaceId, rootPath, number: status.number, enable: !status.autoMerge })
      await load()
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': /, '').slice(0, 160) : 'Could not change auto-merge.')
    } finally { setBusy(false) }
  }

  return <section className={`pr-status-bar is-${tone}`} aria-label="Pull request status">
    <div className="pr-status-main">
      <button type="button" className="pr-status-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)} title={status.title}>
        <GitPullRequest size={14} aria-hidden="true" />
        <span className="pr-status-title">#{status.number} {status.title}</span>
        {status.isDraft && <i className="pr-status-chip">Draft</i>}
        <span className="pr-status-summary" role="status"><i className="pr-status-dot" aria-hidden="true" />CI · {summary}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      <span className="pr-status-actions">
        {failing && onFix && <button type="button" className="is-primary" onClick={() => onFix(ciFixPrompt(status))}><Wrench size={13} aria-hidden="true" />Fix failing checks</button>}
        <button type="button" aria-pressed={status.autoMerge} disabled={busy} onClick={() => void toggleAutoMerge()} title="Merge (squash) automatically once every required check passes">
          {busy ? <Loader2 size={13} className="usage-spin" aria-hidden="true" /> : <GitMerge size={13} aria-hidden="true" />}Auto-merge{status.autoMerge ? ' on' : ''}
        </button>
        {status.url && <button type="button" aria-label="Open pull request on GitHub" title="Open on GitHub" onClick={() => window.open(status.url!, '_blank', 'noopener,noreferrer')}><ExternalLink size={13} aria-hidden="true" /></button>}
      </span>
    </div>
    {notice && <p className="pr-status-notice" role="alert">{notice}</p>}
    {open && <ul className="pr-status-checks" aria-label="Checks">
      {status.checks.length === 0 && <li className="is-empty">No checks have reported on this pull request yet.</li>}
      {status.checks.map((check, index) => <li key={`${check.workflow ?? ''}:${check.name}:${index}`} className={`is-${check.state}`}>
        <span className="pr-check-icon" aria-label={LABEL[check.state]}>{ICON[check.state]}</span>
        <span className="pr-check-name">{check.name}</span>
        {check.workflow && <small>{check.workflow}</small>}
        {check.url && <button type="button" aria-label={`Open ${check.name}`} onClick={() => window.open(check.url!, '_blank', 'noopener,noreferrer')}><ExternalLink size={12} aria-hidden="true" /></button>}
      </li>)}
    </ul>}
  </section>
}
