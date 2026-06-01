import { spawn } from 'node:child_process'
import type { CopilotCredits, CopilotQuotaBucket } from '../../../shared/types/copilot'
import { EMPTY_COPILOT_CREDITS } from '../../../shared/types/copilot'

/**
 * Reads the global GitHub Copilot AI-Credits quota for the gh-authenticated
 * account — the same data VS Code's Copilot status menu shows. Calls the
 * internal `copilot_internal/user` endpoint via the `gh` CLI so auth is handled
 * by gh (no token extraction). The endpoint is undocumented; parse defensively.
 *
 * Unlike the Monaco editor (which fetched from cdn.jsdelivr.net and breaks
 * behind corporate proxies), this hits api.github.com, which gh already reaches
 * on those networks.
 */

const TTL_MS = 5 * 60_000
const TIMEOUT_MS = 15_000

interface SpawnResult {
  stdout: string
  stderr: string
  code: number | null
  error: Error | null
}

function spawnGh(args: string[], timeoutMs: number): Promise<SpawnResult> {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn('gh', args, {
        shell: process.platform === 'win32',
        windowsHide: true,
        env: process.env
      })
    } catch (error) {
      resolve({ stdout: '', stderr: '', code: null, error: error instanceof Error ? error : new Error(String(error)) })
      return
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (code: number | null, error: Error | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ stdout, stderr, code, error })
    }
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* gone */ }
      finish(null, new Error(`gh ${args[0]} exceeded ${timeoutMs}ms`))
    }, timeoutMs)
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (c: string) => { stdout += c })
    child.stderr?.on('data', (c: string) => { stderr += c })
    child.on('error', (err) => finish(null, err))
    child.on('close', (code) => finish(code, null))
  })
}

export class CopilotCreditsService {
  private cache: { value: CopilotCredits; at: number } | null = null

  async getCredits(force = false): Promise<CopilotCredits> {
    if (!force && this.cache && Date.now() - this.cache.at < TTL_MS) {
      return this.cache.value
    }
    const value = await this.fetchCredits()
    this.cache = { value, at: Date.now() }
    return value
  }

  private async fetchCredits(): Promise<CopilotCredits> {
    const result = await spawnGh(['api', 'copilot_internal/user'], TIMEOUT_MS)

    // gh missing entirely → ENOENT before any output.
    if (result.error && result.stdout === '' && result.stderr === '' && result.code === null) {
      return { ...EMPTY_COPILOT_CREDITS, installed: false }
    }
    if (result.error) {
      return { ...EMPTY_COPILOT_CREDITS, installed: true, error: result.error.message }
    }
    if (result.code !== 0) {
      // gh present but not authed / endpoint 401/403/404 — keep it quiet.
      const msg = extractGhError(result.stdout, result.stderr)
      return { ...EMPTY_COPILOT_CREDITS, installed: true, error: msg }
    }
    const parsed = parseCopilotUser(result.stdout)
    if (!parsed) {
      return { ...EMPTY_COPILOT_CREDITS, installed: true, error: 'Não foi possível interpretar copilot_internal/user.' }
    }
    return parsed
  }
}

interface RawBucket {
  percent_remaining?: number
  remaining?: number
  entitlement?: number
  unlimited?: boolean
  overage_permitted?: boolean
}
interface RawCopilotUser {
  copilot_plan?: string
  access_type_sku?: string
  token_based_billing?: boolean
  quota_reset_date?: string
  quota_reset_date_utc?: string
  quota_snapshots?: Record<string, RawBucket>
}

function toBucket(raw: RawBucket | undefined): CopilotQuotaBucket | null {
  if (!raw || typeof raw !== 'object') return null
  const pctRemaining = typeof raw.percent_remaining === 'number' ? raw.percent_remaining : 100
  return {
    usedPct: clampPct(100 - pctRemaining),
    remaining: numberOr(raw.remaining, 0),
    entitlement: numberOr(raw.entitlement, 0),
    unlimited: Boolean(raw.unlimited),
    overagePermitted: Boolean(raw.overage_permitted)
  }
}

function parseCopilotUser(stdout: string): CopilotCredits | null {
  const data = extractJson<RawCopilotUser>(stdout)
  if (!data || typeof data !== 'object') return null
  const premium = toBucket(data.quota_snapshots?.premium_interactions)
  return {
    available: true,
    installed: true,
    plan: typeof data.copilot_plan === 'string' ? data.copilot_plan : null,
    sku: typeof data.access_type_sku === 'string' ? data.access_type_sku : null,
    premium,
    resetDate: data.quota_reset_date ?? data.quota_reset_date_utc ?? null,
    tokenBasedBilling: Boolean(data.token_based_billing),
    error: null
  }
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** gh prints JSON errors too; surface a short message for the panel. */
function extractGhError(stdout: string, stderr: string): string {
  const raw = (stderr || stdout || '').trim()
  const parsed = extractJson<{ message?: string }>(raw)
  if (parsed?.message) return parsed.message
  return raw.split('\n')[0]?.slice(0, 200) || 'gh api falhou.'
}

function extractJson<T>(raw: string): T | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(raw.slice(start, end + 1)) as T
  } catch {
    return null
  }
}
