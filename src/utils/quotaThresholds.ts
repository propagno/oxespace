/**
 * Quota alerts: notify once as a usage window crosses 50/75/90/95 %, never
 * again for the same level, and start over when the window resets.
 */
export const QUOTA_THRESHOLDS = [50, 75, 90, 95] as const

export interface QuotaTrack {
  /** Highest threshold already announced (or seeded) for the current window. */
  announced: number
  lastPct: number
  resetsAtMs: number | null
}

export interface QuotaDecision {
  track: QuotaTrack
  /** Threshold to announce now, or null. */
  crossed: number | null
}

const highestAtOrBelow = (pct: number): number =>
  [...QUOTA_THRESHOLDS].reverse().find((threshold) => pct >= threshold) ?? 0

/**
 * `previous` is undefined on the first sighting: the level is recorded without
 * announcing, so reopening the app at 92 % does not alert every launch.
 */
export function nextQuotaState(previous: QuotaTrack | undefined, usedPct: number, resetsAtMs: number | null): QuotaDecision {
  const pct = Math.max(0, Math.min(100, usedPct))
  const level = highestAtOrBelow(pct)
  if (!previous) return { track: { announced: level, lastPct: pct, resetsAtMs }, crossed: null }

  // The window rolled over (usage fell, or its reset time moved): start fresh.
  const rolled = pct < previous.lastPct - 1 || (previous.resetsAtMs !== null && resetsAtMs !== null && resetsAtMs > previous.resetsAtMs + 60_000)
  const announced = rolled ? 0 : previous.announced
  if (level > announced) return { track: { announced: level, lastPct: pct, resetsAtMs }, crossed: level }
  return { track: { announced: rolled ? level : announced, lastPct: pct, resetsAtMs }, crossed: null }
}

export function quotaNotificationText(
  provider: 'claude' | 'codex',
  kind: 'session' | 'weekly',
  threshold: number,
  resetsAtMs: number | null
): { title: string; body: string } {
  const name = provider === 'claude' ? 'Claude' : 'Codex'
  const window = kind === 'weekly' ? 'semanal' : 'de 5 horas'
  const severity = threshold >= 95 ? 'quase esgotada' : threshold >= 90 ? 'muito alta' : 'em uso'
  const reset = resetsAtMs ? ` Renova em ${new Date(resetsAtMs).toLocaleString()}.` : ''
  return {
    title: `${name} — cota ${window} ${severity} (${threshold}%)`,
    body: `A janela ${window} do ${name} passou de ${threshold}% do limite.${reset}`
  }
}
