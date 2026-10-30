import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentCreditsSnapshot } from '../../../shared/types/agentCredits'
import type { ThreadContextReport } from '../../../shared/types/thread'
import { useUIStore } from '../../store/ui.store'
import { usageResetIn } from './ThreadFailureCard'
import { Button, Popover } from '../../ui'

const RADIUS = 7
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
const REFRESH_MS = 5 * 60_000

const compact = (tokens: number): string => tokens >= 1_000_000 ? `${(tokens / 1_000_000).toFixed(1)}M` : tokens >= 1_000 ? `${Math.round(tokens / 1_000)}k` : String(tokens)

/**
 * Context window and plan usage at a glance, next to the model controls.
 * The ring shows the context fill when the provider reports it and falls back
 * to the plan window otherwise. The plan numbers are the cached subscription
 * snapshot (the same one as Usage & rate limits). Hidden when neither exists.
 */
export function ThreadUsageRing({ provider, idle, threadId, context }: { provider: 'claude' | 'codex'; idle: boolean; threadId?: string; context?: ThreadContextReport }): ReactElement | null {
  const { t } = useTranslation('thread')
  const [snapshot, setSnapshot] = useState<AgentCreditsSnapshot | null>(null)
  const [open, setOpen] = useState(false)
  const [fresh, setFresh] = useState<ThreadContextReport | null>(null)
  useEffect(() => {
    let active = true
    const load = (): void => {
      void window.oxe.agentCredits?.get({ provider, force: false }).then(value => { if (active) setSnapshot(value) }, () => undefined)
    }
    load()
    const timer = window.setInterval(load, REFRESH_MS)
    return () => { active = false; window.clearInterval(timer) }
    // A finished turn is the moment the numbers change; re-read when the thread goes idle.
  }, [provider, idle])
  useEffect(() => {
    if (!open || !idle || !threadId) return
    let active = true
    void window.oxe.thread?.contextUsage?.(threadId).then(value => { if (active && value) setFresh(value) }, () => undefined)
    return () => { active = false }
  }, [open, idle, threadId])

  const report = fresh && (!context || fresh.capturedAt >= context.capturedAt) ? fresh : context
  const windows = snapshot?.available ? snapshot.windows ?? [] : []
  const worst = windows.length ? windows.reduce((best, value) => value.usedPct > best.usedPct ? value : best, windows[0]) : null
  if (!report && !worst) return null
  const planPercent = worst ? Math.max(0, Math.min(100, worst.usedPct)) : 0
  const planUsed = worst ? t(worst.kind === 'session' ? 'usage.planLabelSession' : 'usage.planLabelWeek', { percent: Math.round(planPercent) }) : ''
  const planLabel = worst?.resetsAtMs ? t('usage.resetsIn', { label: planUsed, time: usageResetIn(worst.resetsAtMs) }) : planUsed
  const percent = report ? report.percentage : planPercent
  const label = report ? t('usage.contextLabel', { percent: report.percentage, used: compact(report.usedTokens), total: compact(report.windowTokens) }) : planLabel
  const high = report ? percent >= 85 : percent >= 90
  const visible = report?.categories.filter(category => category.kind === 'used' || category.kind === 'deferred') ?? []
  return <Popover open={open} onOpenChange={setOpen} side="top" align="end" label={t('usage.details')}
    trigger={<button type="button" className="thread-usage-ring" aria-label={t('usage.trigger', { label })} title={label} data-high={high ? 'true' : undefined}>
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <circle cx="9" cy="9" r={RADIUS} fill="none" strokeWidth="2" className="thread-usage-ring-track" />
        <circle cx="9" cy="9" r={RADIUS} fill="none" strokeWidth="2" strokeLinecap="round" className="thread-usage-ring-value"
          strokeDasharray={CIRCUMFERENCE} strokeDashoffset={CIRCUMFERENCE * (1 - Math.max(0, Math.min(100, percent)) / 100)} transform="rotate(-90 9 9)" />
      </svg>
    </button>}>
    <div className="thread-usage-popover">
      {report && <section aria-label={t('usage.context')}>
        <h4>{t('usage.context')}</h4>
        <div className="thread-usage-bar" role="img" aria-label={t('usage.used', { percent: report.percentage })}><span style={{ width: `${Math.min(100, report.percentage)}%` }} /></div>
        <p>{t('usage.tokens', { used: compact(report.usedTokens), total: compact(report.windowTokens), percent: report.percentage })}</p>
        {report.autoCompactAtTokens !== undefined && <p>{t('usage.autoCompact', { tokens: compact(report.autoCompactAtTokens) })}</p>}
        {visible.length > 0 && <table><tbody>{visible.map(category => <tr key={category.name}><th scope="row">{category.kind === 'deferred' ? t('usage.deferred', { name: category.name }) : category.name}</th><td>{compact(category.tokens)}</td></tr>)}</tbody></table>}
      </section>}
      {worst && <section aria-label={t('usage.plan')}>
        <h4>{t('usage.plan')}</h4>
        <p>{planLabel}</p>
        <Button size="sm" onClick={() => { setOpen(false); useUIStore.getState().openUsage() }}>{t('usage.open')}</Button>
      </section>}
    </div>
  </Popover>
}
