import { existsSync, openSync, readSync, closeSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { emptyAgentCredits, type AgentCreditsSnapshot, type CreditsWindow } from '../../../../shared/types/agentCredits'
import type { AgentCreditsProvider } from './types'

/**
 * Codex (OpenAI) writes its subscription rate limits into the session rollout
 * logs at `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`. Each `token_count`
 * event carries a `rate_limits` object with two windows:
 *
 *   "payload": { "type": "token_count", "rate_limits": {
 *     "plan_type": "plus",
 *     "primary":   { "used_percent": 55.0, "window_minutes": 300,   "resets_at": 1780001724 },
 *     "secondary": { "used_percent": 48.0, "window_minutes": 10080, "resets_at": 1780180553 }
 *   } }
 *
 * `primary` is the short (~5h) window, `secondary` the weekly one. The figure is
 * account-wide — the same across every Codex session — so we read the newest
 * rollout that carries `rate_limits` rather than filtering by workspace. No auth
 * and no network: it's all local files.
 *
 * Reset is reported as either `resets_at` (absolute epoch seconds — this build)
 * or `resets_in_seconds` (relative — exec/older builds); we handle both. In
 * `exec` mode `rate_limits` can be null, so we skip past such events/files.
 */

const TTL_MS = 60_000
const SCAN_WINDOW_MS = 14 * 24 * 60 * 60 * 1000
/** Windows up to this length count as the short "session" window; longer = weekly. */
const SESSION_WINDOW_MAX_MIN = 600

interface RawRateWindow {
  used_percent?: number
  window_minutes?: number
  resets_at?: number
  resets_in_seconds?: number
}
interface RawRateLimits {
  primary?: RawRateWindow
  secondary?: RawRateWindow
  plan_type?: string | null
}

export class CodexCreditsService implements AgentCreditsProvider {
  readonly provider = 'codex' as const
  private cache: { value: AgentCreditsSnapshot; at: number } | null = null

  constructor(private readonly sessionsRoot: string = join(homedir(), '.codex', 'sessions')) {}

  async getCredits(force = false): Promise<AgentCreditsSnapshot> {
    if (!force && this.cache && Date.now() - this.cache.at < TTL_MS) {
      return this.cache.value
    }
    const value = this.readLatest()
    this.cache = { value, at: Date.now() }
    return value
  }

  private readLatest(): AgentCreditsSnapshot {
    const base = emptyAgentCredits(this.provider)
    if (!existsSync(this.sessionsRoot)) return base
    base.installed = true

    const files = this.recentRolloutsNewestFirst()
    for (const file of files) {
      const limits = readLatestRateLimits(file)
      if (limits) return buildSnapshot(limits)
    }
    return base
  }

  /** All rollout-*.jsonl from the last ~14 days, newest mtime first. */
  private recentRolloutsNewestFirst(): string[] {
    const cutoff = Date.now() - SCAN_WINDOW_MS
    const out: { path: string; mtimeMs: number }[] = []
    for (const year of safeReaddir(this.sessionsRoot)) {
      const yearDir = join(this.sessionsRoot, year)
      for (const month of safeReaddir(yearDir)) {
        const monthDir = join(yearDir, month)
        for (const day of safeReaddir(monthDir)) {
          const dayDir = join(monthDir, day)
          for (const file of safeReaddir(dayDir)) {
            if (!file.endsWith('.jsonl')) continue
            const fullPath = join(dayDir, file)
            try {
              const stat = statSync(fullPath)
              if (stat.mtimeMs < cutoff) continue
              out.push({ path: fullPath, mtimeMs: stat.mtimeMs })
            } catch {
              // unreadable; skip
            }
          }
        }
      }
    }
    out.sort((a, b) => b.mtimeMs - a.mtimeMs)
    return out.map((f) => f.path)
  }
}

function safeReaddir(dir: string): string[] {
  try { return readdirSync(dir) } catch { return [] }
}

/** Scan a rollout file for the last `token_count` event carrying rate_limits. */
function readLatestRateLimits(filePath: string): RawRateLimits | null {
  let raw: string
  try { raw = readWhole(filePath) } catch { return null }
  let found: RawRateLimits | null = null
  for (const line of raw.split('\n')) {
    if (line.length === 0 || !line.includes('rate_limits')) continue
    let record: { payload?: { type?: string; rate_limits?: RawRateLimits | null } }
    try { record = JSON.parse(line) } catch { continue }
    if (record.payload?.type !== 'token_count') continue
    const limits = record.payload.rate_limits
    if (limits && (limits.primary || limits.secondary)) found = limits
  }
  return found
}

function readWhole(filePath: string): string {
  const fd = openSync(filePath, 'r')
  try {
    const { size } = statSync(filePath)
    const buf = Buffer.alloc(size)
    readSync(fd, buf, 0, size, 0)
    return buf.toString('utf8')
  } finally {
    closeSync(fd)
  }
}

function buildSnapshot(limits: RawRateLimits): AgentCreditsSnapshot {
  const windows: CreditsWindow[] = []
  for (const raw of [limits.primary, limits.secondary]) {
    const win = toWindow(raw)
    if (win) windows.push(win)
  }
  const display = windows.find((w) => w.kind === 'weekly') ?? windows[0] ?? null
  return {
    provider: 'codex',
    available: display !== null,
    installed: true,
    planLabel: typeof limits.plan_type === 'string' ? limits.plan_type : null,
    display,
    windows,
    error: null
  }
}

function toWindow(raw: RawRateWindow | undefined): CreditsWindow | null {
  if (!raw || typeof raw.used_percent !== 'number') return null
  const minutes = typeof raw.window_minutes === 'number' ? raw.window_minutes : 0
  return {
    kind: minutes > SESSION_WINDOW_MAX_MIN ? 'weekly' : 'session',
    usedPct: clampPct(raw.used_percent),
    resetsAtMs: resolveReset(raw)
  }
}

function resolveReset(raw: RawRateWindow): number | null {
  if (typeof raw.resets_at === 'number' && Number.isFinite(raw.resets_at)) {
    return raw.resets_at * 1000
  }
  if (typeof raw.resets_in_seconds === 'number' && Number.isFinite(raw.resets_in_seconds)) {
    return Date.now() + raw.resets_in_seconds * 1000
  }
  return null
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}
