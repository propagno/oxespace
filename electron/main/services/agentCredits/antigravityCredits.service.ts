import { execFile } from 'node:child_process'
import { emptyAgentCredits, type AgentCreditsSnapshot, type CreditsWindow } from '../../../../shared/types/agentCredits'
import type { AgentCreditsProvider } from './types'

/**
 * Antigravity's subscription quota (the weekly and five-hour limits its own `/usage` screen shows) is not written to
 * disk and is not offered over ACP, the protocol OxeChat speaks with `agy`: a session answers with the plan's name
 * and nothing else, and "/usage" sent as a prompt goes to the model. It is only available live from the service the
 * CLI itself calls:
 *
 *   POST https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary   body: {}
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
export const ANTIGRAVITY_PLAN_URL = `${HOST}:loadCodeAssist`
export const ANTIGRAVITY_CREDENTIAL_TARGET = 'gemini:antigravity'
const FALLBACK_CLI_VERSION = '1.5.7'

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
 * The summary's groups each hold a weekly and a five-hour bucket ("Claude and GPT models", and on some plans one for
 * Gemini). One reading per kind is shown: the most used of the groups, which is the one that stops the person first.
 */
export function antigravityWindows(data: unknown): CreditsWindow[] {
  const groups = asRecord(data)?.groups
  const worst = new Map<CreditsWindow['kind'], CreditsWindow>()
  for (const group of Array.isArray(groups) ? groups : []) {
    const buckets = asRecord(group)?.buckets
    for (const raw of Array.isArray(buckets) ? buckets : []) {
      const bucket = asRecord(raw)
      const kind = bucket?.window === 'weekly' ? 'weekly' : bucket?.window === '5h' ? 'session' : null
      const remaining = typeof bucket?.remainingFraction === 'number' ? bucket.remainingFraction : Number.NaN
      if (!kind || !Number.isFinite(remaining)) continue
      const usedPct = Math.min(100, Math.max(0, Math.round((1 - remaining) * 100)))
      const reset = typeof bucket?.resetTime === 'string' ? Date.parse(bucket.resetTime) : Number.NaN
      const window: CreditsWindow = { kind, usedPct, resetsAtMs: Number.isFinite(reset) ? reset : null }
      const known = worst.get(kind)
      if (!known || window.usedPct > known.usedPct) worst.set(kind, window)
    }
  }
  return (['session', 'weekly'] as const).flatMap(kind => worst.get(kind) ?? [])
}

/** "Google AI Ultra": the paid plan when there is one, else the current tier's name. */
export function antigravityPlan(data: unknown): string | null {
  const root = asRecord(data)
  const name = asRecord(root?.paidTier)?.name ?? asRecord(root?.currentTier)?.name
  return typeof name === 'string' && name.trim() ? name.trim().slice(0, 60) : null
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
  private cache: { value: AgentCreditsSnapshot; at: number } | null = null
  private signIn: AntigravitySignIn | null = null
  private plan: { label: string | null; token: string } | null = null
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
    if (this.now() < this.blockedUntil && this.cache) return this.cache.value
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

    const quota = await this.post(ANTIGRAVITY_QUOTA_URL, {}, headers)
    if (quota.status === 429) {
      const retryAfter = Number(quota.retryAfter)
      this.backoffMs = Math.min(BACKOFF_MAX_MS, this.backoffMs ? this.backoffMs * 2 : BACKOFF_MIN_MS)
      this.blockedUntil = this.now() + (Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(BACKOFF_MAX_MS, retryAfter * 1000) : this.backoffMs)
      return { ...base, error: 'quota endpoint 429' }
    }
    this.backoffMs = 0
    if (quota.status === 401 || quota.status === 403) this.signIn = null
    if (!quota.ok) return { ...base, error: `quota endpoint ${quota.status}` }

    // The plan's name changes with the account, not with the minute: asked once per token.
    if (this.plan?.token !== signIn.accessToken) {
      const plan = await this.post(ANTIGRAVITY_PLAN_URL, { metadata: { ideType: 'ANTIGRAVITY', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' } }, headers).catch(() => null)
      this.plan = { label: plan?.ok ? antigravityPlan(plan.data) : null, token: signIn.accessToken }
    }
    const windows = antigravityWindows(quota.data)
    const display = windows.find(window => window.kind === 'weekly') ?? windows[0] ?? null
    return { provider: this.provider, available: display !== null, installed: true, planLabel: this.plan.label, display, windows, error: null, source: 'oauth', observedAtMs: this.now() }
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
