import { useEffect, useRef, useState, type ReactElement } from 'react'
import { RefreshCw } from 'lucide-react'
import type { AgentCreditsSnapshot, CreditsWindow } from '../../../shared/types/agentCredits'
import type { CopilotCredits } from '../../../shared/types/copilot'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import './UsageModal.css'

interface UsageModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function fmtReset(ms: number | null): string {
  if (!ms) return 'reset unknown'
  const diff = ms - Date.now()
  if (diff <= 0) return 'resetting'
  const minutes = Math.floor(diff / 60_000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  if (days >= 1) return `resets in ${days}d`
  if (hours >= 1) return `resets in ${hours}h`
  return `resets in ${Math.max(1, minutes)}m`
}

function Bar({ pct }: { pct: number }): ReactElement {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)))
  const tone = clamped >= 90 ? 'bg-destructive' : clamped >= 70 ? 'bg-amber-500' : 'bg-primary'
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Allowance used" aria-valuenow={clamped} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${clamped}%` }} />
    </div>
  )
}

function WindowRow({ window }: { window: CreditsWindow }): ReactElement {
  return (
    <div className="flex flex-col gap-1" data-testid="usage-window">
      <div className="flex items-center justify-between text-xs">
        <span className="capitalize text-muted-foreground">{window.kind === 'session' ? 'Current session' : 'Current week'}</span>
        <span className="tabular-nums font-medium">{Math.round(window.usedPct)}% used</span>
      </div>
      <Bar pct={window.usedPct} />
      <span className="text-[11px] text-muted-foreground" title={window.resetsAtMs ? new Date(window.resetsAtMs).toLocaleString() : undefined}>{fmtReset(window.resetsAtMs)}</span>
    </div>
  )
}

function ProviderCard({ title, snapshot }: { title: string; snapshot: AgentCreditsSnapshot | null }): ReactElement {
  return (
    <Card className="usage-provider-card gap-3 py-4" data-testid={`usage-card-${title.toLowerCase()}`}>
      <CardHeader className="px-4">
        <CardTitle className="flex items-center justify-between text-sm">
          <span>{title}</span>
          <span className="usage-card-meta">{snapshot?.stale ? 'Last known reading' : snapshot?.planLabel ? <Badge variant="secondary">{snapshot.planLabel}</Badge> : 'Subscription'}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4">
        {!snapshot || !snapshot.installed ? (
          <p className="text-xs text-muted-foreground">Not detected on this machine.</p>
        ) : snapshot.error && !snapshot.stale ? (
          <p className="text-xs text-destructive">{snapshot.error}</p>
        ) : snapshot.windows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No quota reported.</p>
        ) : (
          snapshot.windows.map((w) => <WindowRow key={w.kind} window={w} />)
        )}
        {snapshot?.stale && <p className="usage-stale-note">Could not refresh. Showing the last known reading.</p>}
        <p className="usage-source-note">{snapshot?.source === 'oauth' ? 'Claude account' : snapshot?.source === 'local-session' ? 'Latest local Codex session' : 'Account-wide quota'}{snapshot?.observedAtMs ? ` · checked ${new Date(snapshot.observedAtMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</p>
      </CardContent>
    </Card>
  )
}

function CopilotCard({ credits }: { credits: CopilotCredits | null }): ReactElement {
  return (
    <Card className="usage-provider-card gap-3 py-4" data-testid="usage-card-copilot">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center justify-between text-sm">
          <span>Copilot</span>
          {credits?.plan ? <Badge variant="secondary">{credits.plan}</Badge> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4">
        {!credits || !credits.installed ? (
          <p className="text-xs text-muted-foreground">gh CLI not detected.</p>
        ) : credits.error ? (
          <p className="text-xs text-destructive">{credits.error}</p>
        ) : !credits.credits ? (
          <p className="text-xs text-muted-foreground">No allowance reported.</p>
        ) : credits.credits.unlimited ? (
          <p className="text-xs text-muted-foreground">Unlimited on this plan.</p>
        ) : (
          <div className="flex flex-col gap-1" data-testid="usage-window">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">AI credits</span>
              <span className="tabular-nums">
                {Math.round(credits.credits.usedPct)}% used
              </span>
            </div>
            <Bar pct={credits.credits.usedPct} />
            {credits.resetDate && <span className="text-[11px] text-muted-foreground">Resets {credits.resetDate}</span>}
            <span className="text-[11px] text-muted-foreground">
              {credits.credits.remaining} / {credits.credits.entitlement} remaining
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Usage & rate-limit dashboard (Wave 1 · #9). Surfaces OXESpace's existing
 * per-provider quota providers (agentCredits: Claude/Codex, copilot.credits)
 * in a shadcn dialog with usage bars + reset windows.
 */
export function UsageModal({ open, onOpenChange }: UsageModalProps): ReactElement {
  const [claude, setClaude] = useState<AgentCreditsSnapshot | null>(null)
  const [codex, setCodex] = useState<AgentCreditsSnapshot | null>(null)
  const [copilot, setCopilot] = useState<CopilotCredits | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshRevision, setRefreshRevision] = useState(0)
  const lastRefreshRevision = useRef(0)
  const [, setClock] = useState(0)

  useEffect(() => {
    if (!open) return
    const timer = window.setInterval(() => setClock(value => value + 1), 60_000)
    return () => window.clearInterval(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    let active = true
    const force = refreshRevision !== lastRefreshRevision.current
    lastRefreshRevision.current = refreshRevision
    setLoading(true)
    void Promise.allSettled([
      window.oxe.agentCredits.get({ provider: 'claude', force }),
      window.oxe.agentCredits.get({ provider: 'codex', force }),
      window.oxe.copilot.credits()
    ]).then((results) => {
      if (!active) return
      const [c, x, cop] = results
      setClaude(c.status === 'fulfilled' ? c.value : null)
      setCodex(x.status === 'fulfilled' ? x.value : null)
      setCopilot(cop.status === 'fulfilled' ? cop.value : null)
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [open, refreshRevision])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="usage-dialog" data-testid="usage-modal">
        <DialogHeader>
          <DialogTitle>Usage &amp; rate limits</DialogTitle>
          <DialogDescription>
            {loading ? 'Reading provider quotas…' : 'Subscription limits reported by each provider. Percentages show allowance used, not remaining.'}
          </DialogDescription>
        </DialogHeader>
        <div className="usage-toolbar"><span>Reset times use your local time zone</span><button type="button" disabled={loading} onClick={() => setRefreshRevision(value => value + 1)}><RefreshCw size={14} className={loading ? 'usage-spin' : ''} />Refresh</button></div>
        <div className="usage-roster">
          <ProviderCard title="Claude" snapshot={claude} />
          <ProviderCard title="Codex" snapshot={codex} />
          <CopilotCard credits={copilot} />
        </div>
        <p className="usage-footnote">Subscription quota differs from this thread’s token and context usage.</p>
      </DialogContent>
    </Dialog>
  )
}
