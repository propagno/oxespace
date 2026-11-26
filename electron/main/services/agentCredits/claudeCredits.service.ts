import { app } from 'electron'
import { execFile } from 'node:child_process'
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
 * cache for 60s to avoid hammering the endpoint; a 429 backs off (Retry-After,
 * else doubling from 2 to 15 minutes) and `force` never bypasses that.
 */

const TTL_MS = 60_000
const BACKOFF_MIN_MS = 2 * 60_000
const BACKOFF_MAX_MS = 15 * 60_000
const TIMEOUT_MS = 15_000
const CLI_VERSION_TIMEOUT_MS = 5_000
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const OAUTH_BETA = 'oauth-2025-04-20'

interface ClaudeCredentialsFile {
  claudeAiOauth?: {
    accessToken?: string
    expiresAt?: number
    subscriptionType?: string
  }
}

export interface ClaudeCreditsDeps {
  cliVersion?: () => Promise<string>
  now?: () => number
}

export class ClaudeCreditsService implements AgentCreditsProvider {
  readonly provider = 'claude' as const
  private cache: { value: AgentCreditsSnapshot; at: number } | null = null
  /** Set by a 429: no request before this time, and the next backoff doubles. */
  private blockedUntil = 0
  private backoffMs = 0
  private version: string | null = null
  private readonly cliVersion: () => Promise<string>
  private readonly now: () => number

  // The same folder the CLI reads: a run that points CLAUDE_CONFIG_DIR elsewhere (tests, a second profile) must not
  // fall back to the account in the home folder.
  constructor(
    private readonly credentialsPath: string = join(process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude'), '.credentials.json'),
    deps: ClaudeCreditsDeps = {}
  ) {
    this.cliVersion = deps.cliVersion ?? readClaudeCliVersion
    this.now = deps.now ?? Date.now
  }

  async getCredits(force = false): Promise<AgentCreditsSnapshot> {
    const currentNow = this.now()
    if (!force && this.cache && currentNow - this.cache.at < TTL_MS) {
      return this.cache.value
    }
    // Rate limited: answer from the last reading (the dispatcher marks it stale) until the window passes.
    if (currentNow < this.blockedUntil && this.cache) {
      return this.cache.value.retryAtMs === this.blockedUntil
        ? this.cache.value
        : { ...this.cache.value, retryAtMs: this.blockedUntil }
    }
    const value = await this.fetchUsage()
    this.cache = { value, at: this.now() }
    return value
  }

  private async fetchUsage(): Promise<AgentCreditsSnapshot> {
    const base = emptyAgentCredits(this.provider)
    const creds = this.readCredentials()
    if (!creds?.accessToken) return base
    base.installed = true
    base.planLabel = creds.subscriptionType ?? null

    // Avoid sending an expired OAuth token to Anthropic (which risks 401 or a 429 penalty).
    if (typeof creds.expiresAt === 'number' && Number.isFinite(creds.expiresAt) && creds.expiresAt <= this.now()) {
      return { ...base, error: 'oauth_expired' }
    }

    this.version ??= await this.cliVersion().then(
      (text) => /\d+(\.\d+){1,3}/.exec(text)?.[0] ?? app.getVersion(),
      () => app.getVersion()
    )

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(USAGE_URL, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          'anthropic-beta': OAUTH_BETA,
          'User-Agent': `claude-code/${this.version}`
        }
      })
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after'))
        this.backoffMs = Math.min(BACKOFF_MAX_MS, this.backoffMs ? this.backoffMs * 2 : BACKOFF_MIN_MS)
        this.blockedUntil = this.now() + (Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(BACKOFF_MAX_MS, retryAfter * 1000) : this.backoffMs)
        return { ...base, error: 'usage endpoint 429', retryAtMs: this.blockedUntil }
      }
      this.backoffMs = 0
      this.blockedUntil = 0
      if (!res.ok) {
        // 401 (expired/rejected token) or other — keep it quiet, hide the chip.
        return { ...base, error: `usage endpoint ${res.status}` }
      }
      const data = (await res.json()) as unknown
      return buildSnapshot(data, base.planLabel, this.now())
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

function readClaudeCliVersion(): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      execFile(
        'claude',
        ['--version'],
        { timeout: CLI_VERSION_TIMEOUT_MS, windowsHide: true, shell: process.platform === 'win32' },
        (error, stdout, stderr) => {
          if (error) reject(error)
          else resolve(`${stdout}\n${stderr}`)
        }
      )
    } catch (error) {
      reject(error)
    }
  })
}

/**
 * Parse the usage payload defensively — the endpoint is undocumented and field
 * names have varied across builds. We look for a 5h window and a 7d window under
 * several plausible keys.
 */
function buildSnapshot(data: unknown, planLabel: string | null, now: number): AgentCreditsSnapshot {
  const root = asRecord(data)
  const fiveHourRaw = root && (pick(root, 'five_hour') ?? pick(root, 'fiveHour') ?? pick(root, 'session'))
  const weeklyRaw = root && (pick(root, 'seven_day') ?? pick(root, 'sevenDay') ?? pick(root, 'weekly'))

  const windows: CreditsWindow[] = []
  const session = toWindow(fiveHourRaw, 'session', now)
  const weekly = toWindow(weeklyRaw, 'weekly', now)
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
    source: 'oauth',
    observedAtMs: now,
    error: null
  }
}

function toWindow(raw: unknown, kind: 'session' | 'weekly', now: number): CreditsWindow | null {
  const obj = asRecord(raw)
  if (!obj) return null
  const pctRaw =
    numberOrNull(obj.used_percentage) ??
    numberOrNull(obj.utilization) ??
    numberOrNull(obj.used_percent)
  if (pctRaw === null) return null
  // utilization is sometimes a 0..1 fraction; normalize to a percent.
  const pct = pctRaw <= 1 ? pctRaw * 100 : pctRaw
  return { kind, usedPct: clampPct(pct), resetsAtMs: resolveReset(obj, now) }
}

function resolveReset(obj: Record<string, unknown>, now: number): number | null {
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
  if (inSec !== null) return now + inSec * 1000
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
