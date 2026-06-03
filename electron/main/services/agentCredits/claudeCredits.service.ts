import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { emptyAgentCredits, type AgentCreditsSnapshot, type CreditsWindow } from '../../../../shared/types/agentCredits'
import type { AgentCreditsProvider } from './types'

/**
 * Claude Code's subscription quota (the 5h + weekly windows the `/usage` command
 * shows) is NOT persisted to the local transcripts — it's only available live
 * from an undocumented Anthropic endpoint:
 *
 *   GET https://api.anthropic.com/api/oauth/usage
 *   Authorization: Bearer <claudeAiOauth.accessToken from ~/.claude/.credentials.json>
 *   anthropic-beta: oauth-2025-04-20
 *   User-Agent: claude-code/<version>      ← critical; without it you hit an
 *                                            aggressively rate-limited bucket (429s)
 *
 * The response carries `five_hour` (session) and `seven_day` (weekly) windows.
 * Per the user's decision this is the sole source (no local fallback): on any
 * failure/401/expiry the snapshot is `available: false` and the chip hides.
 *
 * Note: Anthropic restricts OAuth tokens to its official clients — this is a
 * deliberate, user-approved grey-area use. We send the correct User-Agent and
 * cache for 60s to avoid hammering the endpoint.
 */

const TTL_MS = 60_000
const TIMEOUT_MS = 15_000
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const OAUTH_BETA = 'oauth-2025-04-20'

interface ClaudeCredentialsFile {
  claudeAiOauth?: {
    accessToken?: string
    expiresAt?: number
    subscriptionType?: string
  }
}

export class ClaudeCreditsService implements AgentCreditsProvider {
  readonly provider = 'claude' as const
  private cache: { value: AgentCreditsSnapshot; at: number } | null = null

  constructor(private readonly credentialsPath: string = join(homedir(), '.claude', '.credentials.json')) {}

  async getCredits(force = false): Promise<AgentCreditsSnapshot> {
    if (!force && this.cache && Date.now() - this.cache.at < TTL_MS) {
      return this.cache.value
    }
    const value = await this.fetchUsage()
    this.cache = { value, at: Date.now() }
    return value
  }

  private async fetchUsage(): Promise<AgentCreditsSnapshot> {
    const base = emptyAgentCredits(this.provider)
    const creds = this.readCredentials()
    if (!creds?.accessToken) return base
    base.installed = true
    base.planLabel = creds.subscriptionType ?? null

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(USAGE_URL, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          'anthropic-beta': OAUTH_BETA,
          'User-Agent': `claude-code/${app.getVersion()}`
        }
      })
      if (!res.ok) {
        // 401 (expired/rejected token) or other — keep it quiet, hide the chip.
        return { ...base, error: `usage endpoint ${res.status}` }
      }
      const data = (await res.json()) as unknown
      return buildSnapshot(data, base.planLabel)
    } catch (err) {
      return { ...base, error: err instanceof Error ? err.message : String(err) }
    } finally {
      clearTimeout(timer)
    }
  }

  private readCredentials(): ClaudeCredentialsFile['claudeAiOauth'] | null {
    try {
      const parsed = JSON.parse(readFileSync(this.credentialsPath, 'utf8')) as ClaudeCredentialsFile
      return parsed.claudeAiOauth ?? null
    } catch {
      return null
    }
  }
}

/**
 * Parse the usage payload defensively — the endpoint is undocumented and field
 * names have varied across builds. We look for a 5h window and a 7d window under
 * several plausible keys.
 */
function buildSnapshot(data: unknown, planLabel: string | null): AgentCreditsSnapshot {
  const root = asRecord(data)
  const fiveHourRaw = root && (pick(root, 'five_hour') ?? pick(root, 'fiveHour') ?? pick(root, 'session'))
  const weeklyRaw = root && (pick(root, 'seven_day') ?? pick(root, 'sevenDay') ?? pick(root, 'weekly'))

  const windows: CreditsWindow[] = []
  const session = toWindow(fiveHourRaw, 'session')
  const weekly = toWindow(weeklyRaw, 'weekly')
  if (session) windows.push(session)
  if (weekly) windows.push(weekly)

  const display = weekly ?? session ?? null
  return {
    provider: 'claude',
    available: display !== null,
    installed: true,
    planLabel,
    display,
    windows,
    error: null
  }
}

function toWindow(raw: unknown, kind: 'session' | 'weekly'): CreditsWindow | null {
  const obj = asRecord(raw)
  if (!obj) return null
  const pctRaw =
    numberOrNull(obj.used_percentage) ??
    numberOrNull(obj.utilization) ??
    numberOrNull(obj.used_percent)
  if (pctRaw === null) return null
  // utilization is sometimes a 0..1 fraction; normalize to a percent.
  const pct = pctRaw <= 1 ? pctRaw * 100 : pctRaw
  return { kind, usedPct: clampPct(pct), resetsAtMs: resolveReset(obj) }
}

function resolveReset(obj: Record<string, unknown>): number | null {
  const at = obj.resets_at ?? obj.reset_at ?? obj.resetsAt
  if (typeof at === 'number' && Number.isFinite(at)) {
    // Heuristic: seconds vs ms.
    return at < 1e12 ? at * 1000 : at
  }
  if (typeof at === 'string') {
    const parsed = Date.parse(at)
    if (Number.isFinite(parsed)) return parsed
  }
  const inSec = numberOrNull(obj.resets_in_seconds)
  if (inSec !== null) return Date.now() + inSec * 1000
  return null
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
}

function pick(obj: Record<string, unknown>, key: string): unknown {
  return obj[key]
}

function numberOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}
