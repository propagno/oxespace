import { useEffect, useState, type ReactElement } from 'react'
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
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${clamped}%` }} />
    </div>
  )
}

function WindowRow({ window }: { window: CreditsWindow }): ReactElement {
  return (
    <div className="flex flex-col gap-1" data-testid="usage-window">
      <div className="flex items-center justify-between text-xs">
        <span className="capitalize text-muted-foreground">{window.kind}</span>
        <span className="tabular-nums">{Math.round(window.usedPct)}% · {fmtReset(window.resetsAtMs)}</span>
      </div>
      <Bar pct={window.usedPct} />
    </div>
  )
}

function ProviderCard({ title, snapshot }: { title: string; snapshot: AgentCreditsSnapshot | null }): ReactElement {
  return (
    <Card className="gap-3 py-4" data-testid={`usage-card-${title.toLowerCase()}`}>
      <CardHeader className="px-4">
        <CardTitle className="flex items-center justify-between text-sm">
          <span>{title}</span>
          {snapshot?.planLabel ? <Badge variant="secondary">{snapshot.planLabel}</Badge> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4">
        {!snapshot || !snapshot.installed ? (
          <p className="text-xs text-muted-foreground">Not detected on this machine.</p>
        ) : snapshot.error ? (
          <p className="text-xs text-destructive">{snapshot.error}</p>
        ) : snapshot.windows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No quota reported.</p>
        ) : (
          snapshot.windows.map((w) => <WindowRow key={w.kind} window={w} />)
        )}
      </CardContent>
    </Card>
  )
}

function CopilotCard({ credits }: { credits: CopilotCredits | null }): ReactElement {
  return (
    <Card className="gap-3 py-4" data-testid="usage-card-copilot">
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
                {Math.round(credits.credits.usedPct)}%{credits.resetDate ? ` · resets ${credits.resetDate}` : ''}
              </span>
            </div>
            <Bar pct={credits.credits.usedPct} />
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

  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)
    void Promise.allSettled([
      window.oxe.agentCredits.get({ provider: 'claude' }),
      window.oxe.agentCredits.get({ provider: 'codex' }),
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
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" data-testid="usage-modal">
        <DialogHeader>
          <DialogTitle>Usage &amp; rate limits</DialogTitle>
          <DialogDescription>
            {loading ? 'Reading provider quotas…' : 'Per-provider quota and reset windows.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ProviderCard title="Claude" snapshot={claude} />
          <ProviderCard title="Codex" snapshot={codex} />
          <CopilotCard credits={copilot} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
