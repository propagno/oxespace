import { randomUUID } from 'node:crypto'
import type { ThreadFailure, ThreadUsage } from '../../../../shared/types/thread'

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
/** Preserve useful diagnostics, bounded and with credential fields removed. Never stringify payloads. */
export function diagnosticText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.slice(0, 12000)
    .replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk-[a-zA-Z0-9_-]+|eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)\b/g, '[redacted]')
    .replace(/((?:access[_-]?token|refresh[_-]?token|api[_-]?key|authorization|password|secret)\s*["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,"'}]+)/gi, '$1[redacted]')
    .replace(/https?:\/\/[^\s<>"']+/gi, url => { try { const parsed = new URL(url); parsed.username = ''; parsed.password = ''; parsed.search = ''; parsed.hash = ''; return parsed.toString() } catch { return '[URL removed]' } })
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .slice(0, 4000)
}

export function threadFailure(value: unknown): ThreadFailure {
  const error = object(value), info = error.codexErrorInfo
  const providerCode = typeof info === 'string' ? info : Object.keys(object(info))[0]
  const upstream = object(object(info)[providerCode ?? ''])
  const httpStatus = typeof upstream.httpStatusCode === 'number' ? upstream.httpStatusCode : typeof error.httpStatusCode === 'number' ? error.httpStatusCode : undefined
  const detail = diagnosticText(error.message), extra = diagnosticText(error.additionalDetails)
  const hint = `${providerCode ?? ''} ${detail}`
  let code: ThreadFailure['code'] = 'unknown', message = 'The agent could not finish this turn.'
  if (httpStatus === 401 || /unauthorized|authentication[_ ]failed|failed to authenticate|oauth.*(?:expired|revoked)|not logged in/i.test(hint)) { code = 'authentication'; message = 'Your agent account needs to be reconnected.' }
  else if (/usageLimitExceeded|usage[_ ]limit|weekly limit|credits_depleted|hit your limit|insufficient_quota|exceeded your current quota/i.test(hint)) { code = 'usage'; message = 'The provider reported an exhausted usage allowance.' }
  else if (httpStatus === 429 || /rateLimitExceeded|rate limit|too many requests/i.test(hint)) { code = 'rate-limit'; message = 'The provider is limiting requests. Check usage and retry later.' }
  else if (/contextWindowExceeded|context window/i.test(hint)) { code = 'context'; message = 'The conversation exceeded the model context window. Compact it or start a new thread.' }
  else if (/sessionBudgetExceeded/i.test(hint)) { code = 'budget'; message = 'The session exceeded its configured budget.' }
  else if ((httpStatus && httpStatus >= 500) || /serverOverloaded|internalServerError/i.test(hint)) { code = 'server'; message = 'The provider reported a server failure. Retry later.' }
  else if (/sandboxError/i.test(hint)) { code = 'sandbox'; message = 'The agent could not run an operation in its sandbox.' }
  else if (/ConnectionFailed|StreamDisconnected|TooManyFailedAttempts|connection.*closed|timed out|network|ENOTFOUND|ECONN/i.test(hint)) { code = 'network'; message = 'The connection to the agent failed or timed out.' }
  else if (httpStatus === 400 || /badRequest|ENOENT|executable|model.*(?:not found|unavailable|unsupported)/i.test(hint)) { code = 'configuration'; message = 'The agent rejected the configuration or could not start.' }
  return { id: randomUUID(), occurredAt: Date.now(), code, message, ...(detail || extra ? { detail: [detail, extra].filter(Boolean).join('\n\n') } : {}), ...(providerCode && /^[a-zA-Z0-9_:-]{1,100}$/.test(providerCode) ? { providerCode } : {}), ...(httpStatus && httpStatus >= 100 && httpStatus <= 599 ? { httpStatus } : {}) }
}

export class ThreadAgentError extends Error {
  constructor(readonly failure: ThreadFailure, message = failure.message) { super(message); this.name = 'ThreadAgentError' }
}

export function parseThreadUsage(value: unknown): ThreadUsage {
  const response = object(value), windows: ThreadUsage['windows'] = []
  const byId = object(response.rateLimitsByLimitId)
  const all = Object.keys(byId).length ? byId : { [typeof object(response.rateLimits).limitId === 'string' ? object(response.rateLimits).limitId as string : 'account']: response.rateLimits }
  for (const [id, value] of Object.entries(all).slice(0, 20)) {
    const limit = object(value)
    for (const period of ['primary', 'secondary']) {
      const window = object(limit[period])
      if (typeof window.usedPercent !== 'number' || !Number.isFinite(window.usedPercent)) continue
      const minutes = typeof window.windowDurationMins === 'number' ? window.windowDurationMins : undefined
      const label = minutes === 10080 ? 'Weekly' : minutes === 300 ? 'Session · 5 hours' : minutes && minutes > 0 ? `${minutes >= 60 ? `${minutes / 60} hours` : `${minutes} minutes`}` : period === 'primary' ? 'Primary window' : 'Secondary window'
      const reset = typeof window.resetsAt === 'number' && Number.isFinite(window.resetsAt) && window.resetsAt > 0 && window.resetsAt < 8640000000000 ? window.resetsAt * 1000 : undefined
      windows.push({ label: `${diagnosticText(limit.limitName || id).slice(0, 80)} · ${label}`, usedPercent: window.usedPercent, ...(reset ? { resetsAt: reset } : {}), ...(minutes ? { windowMinutes: minutes } : {}) })
    }
    for (const field of ['individualLimit', 'workspaceLimit']) {
      const spending = object(limit[field])
      if (typeof spending.remainingPercent !== 'number' || !Number.isFinite(spending.remainingPercent)) continue
      const reset = typeof spending.resetsAt === 'number' && Number.isFinite(spending.resetsAt) && spending.resetsAt > 0 && spending.resetsAt < 8640000000000 ? spending.resetsAt * 1000 : undefined
      windows.push({ label: `${diagnosticText(limit.limitName || id).slice(0, 80)} · ${field === 'individualLimit' ? 'Individual spending limit' : 'Workspace spending limit'}`, usedPercent: 100 - spending.remainingPercent, ...(reset ? { resetsAt: reset } : {}) })
    }
  }
  return { windows, checkedAt: Date.now() }
}
