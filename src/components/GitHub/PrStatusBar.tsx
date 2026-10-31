import { Check, ChevronDown, CircleDashed, ExternalLink, GitMerge, GitPullRequest, Wrench, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { GitHubCheckState, GitHubPrStatus } from '../../../shared/types/github'
import { useTranslation } from 'react-i18next'
import { humanizeError } from '../../utils/humanizeError'
import { EmptyState, ErrorState, Spinner } from '../../ui'
import './PrStatusBar.css'

const POLL_MS = 30_000

const ICON: Record<GitHubCheckState, ReactElement> = {
  success: <Check size={14} aria-hidden="true" />,
  failure: <X size={14} aria-hidden="true" />,
  pending: <CircleDashed size={14} aria-hidden="true" />,
  neutral: <Check size={14} aria-hidden="true" />
}


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
  const { t } = useTranslation('code')
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
  const summary = status.checks.length === 0 ? t('git.pr.noChecks')
    : failing ? [t('git.pr.failing', { count: counts.failure }), counts.pending ? t('git.pr.running', { count: counts.pending }) : ''].filter(Boolean).join(', ')
      : counts.pending > 0 ? t('git.pr.running', { count: counts.pending }) : t('git.pr.passed')

  const toggleAutoMerge = async (): Promise<void> => {
    setBusy(true); setNotice('')
    try {
      await window.oxe.github.setPullRequestAutoMerge({ workspaceId, rootPath, number: status.number, enable: !status.autoMerge })
      await load()
    } catch (cause) {
      setNotice(humanizeError(cause, t('git.pr.autoMergeFailed')))
    } finally { setBusy(false) }
  }

  return <section className={`pr-status-bar is-${tone}`} aria-label={t('git.pr.label')}>
    <div className="pr-status-main">
      <button type="button" className="pr-status-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)} title={status.title}>
        <GitPullRequest size={14} aria-hidden="true" />
        <span className="pr-status-title">#{status.number} {status.title}</span>
        {status.isDraft && <i className="pr-status-chip">{t('git.pr.draft')}</i>}
        <span className="pr-status-summary" role="status"><i className="pr-status-dot" aria-hidden="true" />CI · {summary}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      <span className="pr-status-actions">
        {failing && onFix && <button type="button" className="is-primary" onClick={() => onFix(ciFixPrompt(status))}><Wrench size={14} aria-hidden="true" />{t('git.pr.fix')}</button>}
        <button type="button" aria-pressed={status.autoMerge} disabled={busy} onClick={() => void toggleAutoMerge()} title={t('git.pr.autoMergeTitle')}>
          {busy ? <Spinner size="sm" decorative /> : <GitMerge size={14} aria-hidden="true" />}{t('git.pr.autoMerge')}
        </button>
        {status.url && <button type="button" aria-label={t('git.pr.open')} title={t('git.pr.open')} onClick={() => window.open(status.url!, '_blank', 'noopener,noreferrer')}><ExternalLink size={14} aria-hidden="true" /></button>}
      </span>
    </div>
    {notice && <ErrorState compact title={t('git.pr.autoMergeFailed')} message={notice} />}
    {open && <ul className="pr-status-checks" aria-label={t('git.pr.checks')}>
      {status.checks.length === 0 && <li><EmptyState compact title={t('git.pr.noChecksYet')} /></li>}
      {status.checks.map((check, index) => <li key={`${check.workflow ?? ''}:${check.name}:${index}`} className={`is-${check.state}`}>
        <span className="pr-check-icon" role="img" aria-label={t(`git.pr.check.${check.state}`)}>{ICON[check.state]}</span>
        <span className="pr-check-name">{check.name}</span>
        {check.workflow && <small>{check.workflow}</small>}
        {check.url && <button type="button" aria-label={t('git.pr.openCheck', { name: check.name })} onClick={() => window.open(check.url!, '_blank', 'noopener,noreferrer')}><ExternalLink size={12} aria-hidden="true" /></button>}
      </li>)}
    </ul>}
  </section>
}
