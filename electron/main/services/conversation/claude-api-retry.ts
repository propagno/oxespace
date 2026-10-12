/**
 * Claude reports provider-side retries (rate limit, overload) as `system`
 * frames with subtype `api_retry`. They are not failures: the request is being
 * retried and will usually succeed. They are surfaced as one transcript line
 * that is revised in place per attempt, so a retry storm is one row, not forty.
 */
export interface ApiRetryNotice {
  /** Stable for one run of consecutive retries; the timeline revises the row with this id. */
  id: string
  summary: string
}

type Frame = Record<string, unknown>

const REASON: Record<string, string> = {
  rate_limit: 'limite de requisições',
  overloaded: 'provedor sobrecarregado',
  server_error: 'erro do servidor',
  timeout: 'tempo esgotado',
  connection: 'falha de conexão'
}

const int = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : null)

/** Detects and renders `api_retry`; returns null for any other frame. */
export function describeApiRetry(frame: Frame): { attempt: number | null; summary: string } | null {
  if (frame.type !== 'system' || frame.subtype !== 'api_retry') return null
  const attempt = int(frame.attempt)
  const max = int(frame.max_retries)
  const delay = int(frame.retry_delay_ms)
  const status = int(frame.error_status)
  const error = typeof frame.error === 'string' ? frame.error : ''
  const reason = REASON[error] ?? (error ? error.replace(/_/g, ' ').slice(0, 60) : 'erro temporário do provedor')

  const parts = [`O provedor está tentando novamente — ${reason}${status ? ` (HTTP ${status})` : ''}`]
  if (attempt !== null) parts.push(max ? `tentativa ${attempt} de ${max}` : `tentativa ${attempt}`)
  if (delay !== null && delay > 0) parts.push(`próxima em ${Math.max(1, Math.round(delay / 1000))}s`)
  return { attempt, summary: `${parts.join(', ')}.` }
}

/**
 * Numbers runs of retries. An attempt that does not exceed the previous one
 * starts a new run (a later, unrelated storm gets its own row), and `reset()`
 * ends the current run when the turn finishes.
 */
export function createApiRetryTracker(newId: () => string): {
  observe(frame: Frame): ApiRetryNotice | null
  reset(): void
} {
  let runId: string | null = null
  let lastAttempt = 0
  return {
    observe(frame) {
      const described = describeApiRetry(frame)
      if (!described) return null
      const attempt = described.attempt ?? lastAttempt + 1
      if (runId === null || attempt <= lastAttempt) runId = newId()
      lastAttempt = attempt
      return { id: runId, summary: described.summary }
    },
    reset() {
      runId = null
      lastAttempt = 0
    }
  }
}
