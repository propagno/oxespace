import { execFile } from 'node:child_process'
import { emptyAgentCredits, type AgentCreditsSnapshot, type CreditsWindow } from '../../../../shared/types/agentCredits'
import type { AgentCreditsProvider } from './types'

/**
 * Antigravity's subscription quota (the weekly and five-hour limits its own `/usage` screen shows) is not written to
 * disk and is not offered over ACP, the protocol OxeChat speaks with `agy`: a session answers with the plan's name
 * and nothing else, and "/usage" sent as a prompt goes to the model. It is only available live from the service the
 * CLI itself calls:
 *
 *   POST https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist              (plan + cloudaicompanionProject)
 *   POST https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary    body: { project } or {}
 *   POST https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota           body: { project } (Gemini fallback)
 *   Authorization: Bearer <token.access_token of the CLI's sign-in>
 *   User-Agent: antigravity/<cli version> <os>/<arch>   ← required: any other client name is answered 403
 *
 * The sign-in lives in the system's credential store (service "gemini", user "antigravity"), as JSON:
 * `{ token: { access_token, refresh_token, expiry }, auth_method, id_token_email }`. It is read on Windows only,
 * where it was measured (Credential Manager, target "gemini:antigravity"); elsewhere the chip stays hidden.
 *
 * The access token lasts about an hour. This file never refreshes it itself (that needs the CLI's own client): when
 * it has expired, `agy models` is run once, which signs in from the same store and leaves a fresh token there.
 *
 * Note: Google restricts this service to its own clients. Sending the CLI's client name with the person's own
 * sign-in to read their own quota is a deliberate, user-approved grey-area use (12/11/2026), like the Claude reading
 * beside it. The answer is cached for 60 s; a 429 backs off (Retry-After, else doubling from 2 to 15 minutes) and
 * `force` never bypasses that. The token is never logged, stored or sent anywhere but that one host.
 */

const TTL_MS = 60_000
const BACKOFF_MIN_MS = 2 * 60_000
const BACKOFF_MAX_MS = 15 * 60_000
const TIMEOUT_MS = 15_000
/** `agy models` is tried at most this often when the stored token has expired. */
const RENEW_EVERY_MS = 10 * 60_000
/** A token this close to its expiry is treated as expired: the request would arrive with it dead. */
const EXPIRY_MARGIN_MS = 60_000
const HOST = 'https://daily-cloudcode-pa.googleapis.com/v1internal'
export const ANTIGRAVITY_QUOTA_URL = `${HOST}:retrieveUserQuotaSummary`
export const ANTIGRAVITY_USER_QUOTA_URL = `${HOST}:retrieveUserQuota`
export const ANTIGRAVITY_PLAN_URL = `${HOST}:loadCodeAssist`
export const ANTIGRAVITY_CREDENTIAL_TARGET = 'gemini:antigravity'
const FALLBACK_CLI_VERSION = '1.5.7'
/** Reset horizons up to 6h (5h rolling window + skew margin) map to 'session'; longer (daily/weekly) map to 'weekly'. */
const SESSION_HORIZON_MAX_MS = 6 * 60 * 60 * 1000

export interface AntigravitySignIn { accessToken: string; expiresAtMs: number | null }

/** The CLI's sign-in as the credential store holds it, or null when it is not there or not in the known shape. */
export function parseAntigravitySignIn(text: string): AntigravitySignIn | null {
  try {
    const token = asRecord(asRecord(JSON.parse(text))?.token)
    const accessToken = typeof token?.access_token === 'string' ? token.access_token.trim() : ''
    if (!accessToken) return null
    const expiry = typeof token?.expiry === 'string' ? Date.parse(token.expiry) : Number.NaN
    return { accessToken, expiresAtMs: Number.isFinite(expiry) ? expiry : null }
  } catch {
    return null
  }
}

/** `antigravity/1.5.7 windows/amd64`: the client name the service expects, in the CLI's (Go's) words for the system. */
export function antigravityUserAgent(version: string, platform: NodeJS.Platform = process.platform, arch: string = process.arch): string {
  const os = platform === 'win32' ? 'windows' : platform
  const cpu = arch === 'x64' ? 'amd64' : arch === 'ia32' ? '386' : arch
  return `antigravity/${/^\d+(\.\d+){1,3}$/.test(version) ? version : FALLBACK_CLI_VERSION} ${os}/${cpu}`
}

/**
 * The summary's groups each hold a weekly and a five-hour bucket ("Gemini models", "Claude and GPT models"). Each group
 * counts apart, so every window keeps its group (OXE-174): showing the most used group as "Antigravity" read the
 * Claude and GPT quota to a person working with Gemini. Gemini, Antigravity's own models, comes first, then the rest
 * in the service's order. The response's ungrouped buckets count too, grouped by their own words. Window names are
 * read loosely ("weekly", "WEEKLY", "5h", "five_hour", "short", "rolling", "daily", "24h", "1d", or from `bucketId`
 * when `window` is empty or numeric); proto3-omitted `remainingFraction: 0` with a valid `resetTime` counts as 100%
 * used (OXE-420); `unknown` collects what was still not read, for the log.
 */
export function antigravityWindows(data: unknown, unknown: Set<string> = new Set()): CreditsWindow[] {
  const root = asRecord(data)
  const read = new Map<string, Map<CreditsWindow['kind'], CreditsWindow>>()
  const add = (group: string, value: unknown): void => {
    const bucket = asRecord(value)
    if (!bucket || bucket.disabled === true) return
    const rawWindow = typeof bucket.window === 'string' ? bucket.window.trim() : typeof bucket.window === 'number' ? String(bucket.window) : ''
    const bucketId = typeof bucket.bucketId === 'string' ? bucket.bucketId.trim() : ''
    const fallbackToId = !rawWindow || /^\d+$/.test(rawWindow) || /unspecified/i.test(rawWindow)
    const kind = windowKind(rawWindow) ?? (fallbackToId ? windowKind(bucketId) : null)
    if (!kind) { if (rawWindow) unknown.add(`window ${rawWindow.slice(0, 40)}`); return }
    const reset = typeof bucket.resetTime === 'string' ? Date.parse(bucket.resetTime) : Number.NaN
    const remaining = resolveRemainingFraction(bucket, reset)
    // remainingAmount (the proto's other "remaining") has no total beside it: not a share, so not shown.
    if (!remaining) return
    if ('amountOnly' in remaining) { unknown.add(`amount-only ${String(bucket.bucketId ?? rawWindow).slice(0, 40)}`); return }
    const usedPct = toUsedPct(remaining.value)
    recordWindow(read, group, kind, usedPct, Number.isFinite(reset) ? reset : null)
  }
  for (const raw of Array.isArray(root?.groups) ? root.groups : []) {
    const record = asRecord(raw)
    const group = antigravityGroup(typeof record?.displayName === 'string' ? record.displayName : '')
    for (const value of Array.isArray(record?.buckets) ? record.buckets : []) add(group, value)
  }
  // The response's own buckets, outside any group (quota_summary.proto: RetrieveUserQuotaSummaryResponse.buckets):
  // each is named by its own words ("Gemini …", a "1p-" or "3p-" id).
  for (const value of Array.isArray(root?.buckets) ? root.buckets : []) {
    const bucket = asRecord(value)
    const words = [bucket?.displayName, bucket?.description, bucket?.bucketId].filter((word): word is string => typeof word === 'string').join(' ')
    add(antigravityGroup(words), value)
  }
  return flattenOrderedWindows(read)
}

/**
 * Parses `v1internal:retrieveUserQuota` per-model buckets (`{ buckets: [{ modelId, remainingFraction, resetTime, tokenType }] }`).
 * Used to supplement/fallback when `retrieveUserQuotaSummary` omits Gemini buckets (OXE-420).
 */
export function antigravityUserQuotaWindows(data: unknown, nowMs: number = Date.now()): CreditsWindow[] {
  const root = asRecord(data)
  const read = new Map<string, Map<CreditsWindow['kind'], CreditsWindow>>()
  for (const value of Array.isArray(root?.buckets) ? root.buckets : []) {
    const bucket = asRecord(value)
    if (!bucket || bucket.disabled === true) continue
    const words = [bucket.modelId, bucket.displayName, bucket.description, bucket.bucketId]
      .filter((word): word is string => typeof word === 'string' && word.trim().length > 0)
      .join(' ')
    if (!words) continue
    const reset = typeof bucket.resetTime === 'string' ? Date.parse(bucket.resetTime) : Number.NaN
    const remaining = resolveRemainingFraction(bucket, reset)
    if (!remaining || 'amountOnly' in remaining) continue
    const rawWindow = typeof bucket.window === 'string' ? bucket.window.trim() : ''
    const bucketId = typeof bucket.bucketId === 'string' ? bucket.bucketId.trim() : ''
    const explicitKind = windowKind(rawWindow) ?? windowKind(bucketId)
    const kind: CreditsWindow['kind'] = explicitKind ?? (Number.isFinite(reset) && reset - nowMs > SESSION_HORIZON_MAX_MS ? 'weekly' : 'session')
    recordWindow(read, antigravityGroup(words), kind, toUsedPct(remaining.value), Number.isFinite(reset) ? reset : null)
  }
  return flattenOrderedWindows(read)
}

function resolveRemainingFraction(bucket: Record<string, unknown>, resetMs: number): { value: number } | { amountOnly: true } | null {
  if (typeof bucket.remainingFraction === 'number' && Number.isFinite(bucket.remainingFraction)) return { value: bucket.remainingFraction }
  if (bucket.remainingAmount !== undefined && bucket.remainingAmount !== null) return { amountOnly: true }
  // Proto3 JSON omits 0.0 float fields: an enabled bucket with a valid resetTime and no remainingAmount is exhausted (0 remaining).
  if (Number.isFinite(resetMs)) return { value: 0 }
  return null
}

function toUsedPct(remainingFraction: number): number {
  return Math.min(100, Math.max(0, Math.round((1 - remainingFraction) * 100)))
}

function recordWindow(read: Map<string, Map<CreditsWindow['kind'], CreditsWindow>>, group: string, kind: CreditsWindow['kind'], usedPct: number, resetsAtMs: number | null): void {
  const windows = read.get(group) ?? new Map<CreditsWindow['kind'], CreditsWindow>()
  const known = windows.get(kind)
  // Two buckets of one kind in one group: the more used one, which stops the person first (on ties, soonest known reset).
  const better = !known
    || usedPct > known.usedPct
    || (usedPct === known.usedPct && resetsAtMs !== null && (known.resetsAtMs === null || resetsAtMs < known.resetsAtMs))
  if (better) windows.set(kind, { kind, usedPct, resetsAtMs, group })
  read.set(group, windows)
}

function flattenOrderedWindows(read: Map<string, Map<CreditsWindow['kind'], CreditsWindow>>): CreditsWindow[] {
  const order = [...read.keys()].sort((a, b) => (a === 'gemini' ? 0 : 1) - (b === 'gemini' ? 0 : 1))
  return order.flatMap(group => (['session', 'weekly'] as const).flatMap(kind => read.get(group)?.get(kind) ?? []))
}

function mergeOrderedWindows(windows: CreditsWindow[]): CreditsWindow[] {
  const read = new Map<string, Map<CreditsWindow['kind'], CreditsWindow>>()
  for (const window of windows) recordWindow(read, window.group ?? 'other', window.kind, window.usedPct, window.resetsAtMs)
  return flattenOrderedWindows(read)
}

/** 'gemini' and 'claude-gpt' for the groups the app names; any other group keeps the service's own words. */
export function antigravityGroup(displayName: string): string {
  if (/gemini|(^|[^a-z0-9])(1p|carbon|neon|hydrogen|argon)([^a-z0-9]|$)/i.test(displayName)) return 'gemini'
  if (/claude|gpt|(^|[^a-z0-9])3p([^a-z0-9]|$)/i.test(displayName)) return 'claude-gpt'
  if (/(^|[^a-z0-9])(pro|flash)([^a-z0-9]|$)/i.test(displayName)) return 'gemini'
  return displayName.trim().slice(0, 40) || 'other'
}

function windowKind(name: string): CreditsWindow['kind'] | null {
  if (!name) return null
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, '')
  // An enum's spelling too ("WINDOW_WEEKLY", "FIVE_HOUR_WINDOW", "1p-weekly", "1p-5h").
  if (key.includes('week') || /(^|[^a-z0-9])7d(?:ays?)?([^a-z0-9]|$)/i.test(name)) return 'weekly'
  if (
    key.includes('fivehour')
    || key.includes('5hour')
    || key.includes('short')
    || key.includes('rolling')
    || key.includes('daily')
    || /(^|[^a-z0-9])(5h(?:rs?)?|24h(?:rs?)?|1d(?:ay)?)([^a-z0-9]|$)/i.test(name)
  ) return 'session'
  return null
}

/** "Google AI Ultra": the paid plan when there is one, else the current tier's name. */
export function antigravityPlan(data: unknown): string | null {
  const root = asRecord(data)
  const name = asRecord(root?.paidTier)?.name ?? asRecord(root?.currentTier)?.name
  return typeof name === 'string' && name.trim() ? name.trim().slice(0, 60) : null
}

/** Project ID bound to the Code Assist session (string or `{ id }` shape), or null when absent. */
export function antigravityProject(data: unknown): string | null {
  const raw = asRecord(data)?.cloudaicompanionProject
  if (typeof raw === 'string' && raw.trim()) return raw.trim().slice(0, 200)
  const id = asRecord(raw)?.id
  return typeof id === 'string' && id.trim() ? id.trim().slice(0, 200) : null
}

export interface AntigravityCreditsDeps {
  /** The stored sign-in's text, or null: no store on this system, no entry, or the read failed. */
  readStored?: () => Promise<string | null>
  /** Has the CLI sign in again, which leaves a fresh token in the store. Resolves when it has finished. */
  renew?: () => Promise<void>
  cliVersion?: () => Promise<string>
  fetch?: typeof fetch
  now?: () => number
}

export class AntigravityCreditsService implements AgentCreditsProvider {
  readonly provider = 'antigravity' as const
  /** Window names already logged as not read, so each is logged once. */
  private readonly unknownWindows = new Set<string>()
  private cache: { value: AgentCreditsSnapshot; at: number } | null = null
  private signIn: AntigravitySignIn | null = null
  private account: { label: string | null; project: string | null; token: string } | null = null
  private version: string | null = null
  private renewedAt = Number.NEGATIVE_INFINITY
  /** Set by a 429: no request before this time, and the next backoff doubles. */
  private blockedUntil = 0
  private backoffMs = 0
  private readonly readStored: () => Promise<string | null>
  private readonly renew: () => Promise<void>
  private readonly cliVersion: () => Promise<string>
  private readonly request: typeof fetch
  private readonly now: () => number

  constructor(deps: AntigravityCreditsDeps = {}) {
    this.readStored = deps.readStored ?? readStoredSignIn
    this.renew = deps.renew ?? (() => runCli(['models'], 45_000).then(() => undefined))
    this.cliVersion = deps.cliVersion ?? (() => runCli(['--version'], 10_000))
    this.request = deps.fetch ?? fetch
    this.now = deps.now ?? Date.now
  }

  async getCredits(force = false): Promise<AgentCreditsSnapshot> {
    if (!force && this.cache && this.now() - this.cache.at < TTL_MS) return this.cache.value
    // Rate limited: answer from the last reading (the dispatcher marks it stale) until the window passes.
    if (this.now() < this.blockedUntil && this.cache) {
      return this.cache.value.retryAtMs === this.blockedUntil
        ? this.cache.value
        : { ...this.cache.value, retryAtMs: this.blockedUntil }
    }
    const value = await this.read().catch((error: unknown) => ({ ...emptyAgentCredits(this.provider), error: error instanceof Error ? error.message : String(error) }))
    this.cache = { value, at: this.now() }
    return value
  }

  private live(signIn: AntigravitySignIn | null): signIn is AntigravitySignIn {
    return Boolean(signIn && (signIn.expiresAtMs === null || signIn.expiresAtMs - this.now() > EXPIRY_MARGIN_MS))
  }

  /** The token to use: the one in hand while it lasts, else the store's, else the store's after the CLI renewed it. */
  private async token(): Promise<{ signIn: AntigravitySignIn | null; stored: boolean }> {
    if (this.live(this.signIn)) return { signIn: this.signIn, stored: true }
    const text = await this.readStored()
    let signIn = text ? parseAntigravitySignIn(text) : null
    if (signIn && !this.live(signIn) && this.now() - this.renewedAt >= RENEW_EVERY_MS) {
      this.renewedAt = this.now()
      await this.renew().catch(() => undefined)
      const again = await this.readStored()
      signIn = again ? parseAntigravitySignIn(again) ?? signIn : signIn
    }
    this.signIn = this.live(signIn) ? signIn : null
    return { signIn: this.signIn, stored: signIn !== null }
  }

  private async read(): Promise<AgentCreditsSnapshot> {
    const base = emptyAgentCredits(this.provider)
    const { signIn, stored } = await this.token()
    if (!stored) return base
    base.installed = true
    if (!signIn) return { ...base, error: 'Antigravity sign-in expired' }
    this.version ??= await this.cliVersion().then(text => /\d+(\.\d+){1,3}/.exec(text)?.[0] ?? FALLBACK_CLI_VERSION, () => FALLBACK_CLI_VERSION)
    const headers = { Authorization: `Bearer ${signIn.accessToken}`, 'Content-Type': 'application/json', 'User-Agent': antigravityUserAgent(this.version) }

    // Plan name + cloudaicompanionProject change with the account, not with the minute: asked first, cached per token.
    if (this.account?.token !== signIn.accessToken) {
      const plan = await this.post(ANTIGRAVITY_PLAN_URL, { metadata: { ideType: 'ANTIGRAVITY', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' } }, headers).catch(() => null)
      if (plan?.status === 429) {
        this.applyBackoff(plan.retryAfter)
        return { ...base, error: 'quota endpoint 429', retryAtMs: this.blockedUntil }
      }
      if (plan?.ok) {
        this.account = { label: antigravityPlan(plan.data), project: antigravityProject(plan.data), token: signIn.accessToken }
      }
    }
    const account = this.account?.token === signIn.accessToken ? this.account : null
    const project = account?.project ?? null

    const quota = await this.post(ANTIGRAVITY_QUOTA_URL, project ? { project } : {}, headers)
    if (quota.status === 429) {
      this.applyBackoff(quota.retryAfter)
      return { ...base, error: 'quota endpoint 429', retryAtMs: this.blockedUntil }
    }
    this.backoffMs = 0
    this.blockedUntil = 0
    if (quota.status === 401 || quota.status === 403) this.signIn = null
    if (!quota.ok) return { ...base, error: `quota endpoint ${quota.status}` }

    const unknown = new Set<string>()
    const summaryWindows = antigravityWindows(quota.data, unknown)
    for (const name of unknown) {
      if (this.unknownWindows.has(name)) continue
      this.unknownWindows.add(name)
      // The name only: what the service calls a window it did not understand, never the token or the account.
      console.warn(`[agent-credits] antigravity: a quota bucket was not read (${name})`)
    }

    let windows = summaryWindows
    let supplementedGeminiFromUserQuota = false
    // When the summary omits Gemini buckets (e.g. only Claude and GPT returned) and we have the bound project,
    // supplement/fallback via v1internal:retrieveUserQuota so Gemini usage is still measured (OXE-420).
    if (!summaryWindows.some(window => window.group === 'gemini') && project) {
      const detail = await this.post(ANTIGRAVITY_USER_QUOTA_URL, { project }, headers).catch(() => null)
      if (detail?.status === 429) {
        this.applyBackoff(detail.retryAfter)
        if (!summaryWindows.length) return { ...base, error: 'quota endpoint 429', retryAtMs: this.blockedUntil }
      } else {
        if (detail?.status === 401) this.signIn = null
        if (detail?.ok) {
          const fallback = antigravityUserQuotaWindows(detail.data, this.now())
          const supplement = summaryWindows.length ? fallback.filter(window => window.group === 'gemini') : fallback
          if (supplement.length) {
            windows = mergeOrderedWindows([...supplement, ...summaryWindows])
            supplementedGeminiFromUserQuota = supplement.some(window => window.group === 'gemini')
          }
        }
      }
    }

    const geminiWeeklyUnavailable = supplementedGeminiFromUserQuota
      && windows.some(window => window.group === 'gemini' && window.kind === 'session')
      && !windows.some(window => window.group === 'gemini' && window.kind === 'weekly')

    // The bar shows the first group (Gemini when the plan has it): the weekly window, else the five-hour one.
    const first = windows[0]?.group
    const display = windows.find(window => window.group === first && window.kind === 'weekly') ?? windows[0] ?? null
    return {
      provider: this.provider,
      available: display !== null,
      installed: true,
      planLabel: account?.label ?? null,
      display,
      windows,
      error: null,
      source: 'oauth',
      observedAtMs: this.now(),
      ...(geminiWeeklyUnavailable ? { geminiWeeklyUnavailable: true } : {})
    }
  }

  private applyBackoff(retryAfterHeader: string | null): void {
    const retryAfter = Number(retryAfterHeader)
    this.backoffMs = Math.min(BACKOFF_MAX_MS, this.backoffMs ? this.backoffMs * 2 : BACKOFF_MIN_MS)
    this.blockedUntil = this.now() + (Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(BACKOFF_MAX_MS, retryAfter * 1000) : this.backoffMs)
  }

  private async post(url: string, body: unknown, headers: Record<string, string>): Promise<{ ok: boolean; status: number; retryAfter: string | null; data: unknown }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const response = await this.request(url, { method: 'POST', signal: controller.signal, headers, body: JSON.stringify(body) })
      return { ok: response.ok, status: response.status, retryAfter: response.headers.get('retry-after'), data: response.ok ? await response.json().catch(() => null) : null }
    } finally {
      clearTimeout(timer)
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/** Runs the CLI with fixed arguments and no shell; resolves with what it printed, rejects when it is not there. */
function runCli(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(process.platform === 'win32' ? 'agy.exe' : 'agy', args, { timeout: timeoutMs, windowsHide: true }, (error, stdout) => {
      if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') reject(error)
      else resolve(String(stdout))
    })
  })
}

/**
 * Reads one generic credential from Windows' Credential Manager, as base64: PowerShell has no cmdlet for it, so the
 * script declares `CredRead` itself. The target is a constant; nothing of the caller's reaches the script.
 */
const READ_WINDOWS_CREDENTIAL = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class OxeCredentialReader {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL { public int Flags; public int Type; public string TargetName; public string Comment; public long LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist; public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool CredRead(string target, int type, int flags, out IntPtr credential);
  [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr buffer);
  public static string Read(string target) {
    IntPtr pointer;
    if (!CredRead(target, 1, 0, out pointer)) return "";
    try {
      CREDENTIAL credential = (CREDENTIAL)Marshal.PtrToStructure(pointer, typeof(CREDENTIAL));
      byte[] bytes = new byte[credential.CredentialBlobSize];
      Marshal.Copy(credential.CredentialBlob, bytes, 0, bytes.Length);
      return Convert.ToBase64String(bytes);
    } finally { CredFree(pointer); }
  }
}
"@
[OxeCredentialReader]::Read('${ANTIGRAVITY_CREDENTIAL_TARGET}')
`

function readStoredSignIn(): Promise<string | null> {
  if (process.platform !== 'win32') return Promise.resolve(null)
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', READ_WINDOWS_CREDENTIAL], { timeout: 20_000, windowsHide: true, maxBuffer: 256 * 1024 }, (error, stdout) => {
      const base64 = error ? '' : String(stdout).trim()
      if (!base64) { resolve(null); return }
      const bytes = Buffer.from(base64, 'base64')
      // The CLI stores UTF-8; a store that kept UTF-16 shows as a NUL after the first character.
      resolve(bytes.length > 1 && bytes[1] === 0 ? bytes.toString('utf16le') : bytes.toString('utf8'))
    })
  })
}
