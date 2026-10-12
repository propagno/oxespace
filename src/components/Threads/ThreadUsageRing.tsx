import { useEffect, useState, type ReactElement } from 'react'
import type { AgentCreditsSnapshot } from '../../../shared/types/agentCredits'
import { useUIStore } from '../../store/ui.store'
import { usageResetIn } from './ThreadFailureCard'

const RADIUS = 7
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
const REFRESH_MS = 5 * 60_000

/**
 * Plan usage at a glance, next to the model controls. Reads the cached
 * subscription snapshot (the same one as Usage & rate limits) and opens that
 * dialog on click. Hidden when the provider reports nothing.
 */
export function ThreadUsageRing({ provider, idle }: { provider: 'claude' | 'codex'; idle: boolean }): ReactElement | null {
  const [snapshot, setSnapshot] = useState<AgentCreditsSnapshot | null>(null)
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

  const windows = snapshot?.windows ?? []
  if (!snapshot?.available || !windows.length) return null
  const worst = windows.reduce((best, value) => value.usedPct > best.usedPct ? value : best, windows[0])
  const percent = Math.max(0, Math.min(100, worst.usedPct))
  const label = `${Math.round(percent)}% of ${worst.kind === 'session' ? 'the current session' : 'this week'} used${worst.resetsAtMs ? ` · resets in ${usageResetIn(worst.resetsAtMs)}` : ''}`
  return <button type="button" className="thread-usage-ring" aria-label={`Plan usage: ${label}`} title={`${label}. Open usage details`} data-high={percent >= 90 ? 'true' : undefined} onClick={() => useUIStore.getState().openUsage()}>
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r={RADIUS} fill="none" strokeWidth="2" className="thread-usage-ring-track" />
      <circle cx="9" cy="9" r={RADIUS} fill="none" strokeWidth="2" strokeLinecap="round" className="thread-usage-ring-value"
        strokeDasharray={CIRCUMFERENCE} strokeDashoffset={CIRCUMFERENCE * (1 - percent / 100)} transform="rotate(-90 9 9)" />
    </svg>
  </button>
}
