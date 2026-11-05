import { execFile } from 'node:child_process'
import { win32 } from 'node:path'
import type { RemoteFirewallChange, RemoteFirewallNetwork, RemoteFirewallStatus } from '../../../../shared/types/remote'

/*
 * 1.4.3 P1 · Windows firewall check and repair for phone pairing.
 * Adapted from Orca's src/main/runtime/windows-mobile-firewall.ts (MIT License, Copyright (c) 2026 Lovecast Inc.).
 *
 * The user's v1.4.1 report: Wi-Fi profiled Public and no inbound rule for OXESpace.exe, so the phone's request never
 * arrived. This reads the state (no elevation) and, only when the person asks, adds ONE rule through UAC:
 * - inbound, TCP, the gateway's port, program = this OXESpace.exe, profile **Private only** (never Public or Domain);
 * - a fixed name, so Undo removes exactly that rule and nothing else;
 * - the exact command is part of the status, so the window shows it before anything runs;
 * - elevation is `Start-Process -Verb RunAs`: Windows always asks; nothing here can make it silent.
 * A repair or an undo counts only when a fresh inspection confirms it.
 */

export const FIREWALL_RULE_NAME = 'OXESpace.PhonePairing'
export const FIREWALL_RULE_DISPLAY_NAME = 'OXESpace phone pairing'
const INSPECT_TIMEOUT_MS = 10_000
const ELEVATION_TIMEOUT_MS = 5 * 60_000

export type PowerShellRunner = (script: string, timeoutMs: number) => Promise<string>

export interface FirewallEnvironment {
  platform: NodeJS.Platform
  /**
   * Whether the check may run: a packaged build, or an unpackaged CI run with the test switch (`firewallCheckEnabled`).
   * A development Electron path is transient: never written into a rule on a person's machine by accident.
   */
  enabled: boolean
  executablePath: string
  systemRoot?: string
  runPowerShell?: PowerShellRunner
}

interface Inspection {
  allowRuleScopes?: unknown
  blockingRuleDetected?: unknown
  privateFirewallEnabled?: unknown
  networkCategory?: unknown
  ownRulePresent?: unknown
}

/** PowerShell single-quoted literal (typographic quotes end it too). */
export function quotePowerShellLiteral(value: string): string {
  return `'${value.replace(/['\u2018\u2019\u201A\u201B]/g, '$&$&')}'`
}

/** The exact command the repair runs, shown to the person before they confirm. */
export function repairCommand(port: number, executablePath: string): string {
  return `New-NetFirewallRule -Name ${quotePowerShellLiteral(FIREWALL_RULE_NAME)} -DisplayName ${quotePowerShellLiteral(FIREWALL_RULE_DISPLAY_NAME)} -Direction Inbound -Action Allow -Enabled True -Profile Private -Protocol TCP -LocalPort ${port} -Program ${quotePowerShellLiteral(executablePath)} -EdgeTraversalPolicy Block`
}

/** The exact command Undo runs. */
export function undoCommand(): string {
  return `Remove-NetFirewallRule -Name ${quotePowerShellLiteral(FIREWALL_RULE_NAME)}`
}

/**
 * OXESPACE_E2E_FIREWALL_CHECK=1 lets an UNPACKAGED run (the CI acceptance gate: an admin runner, UAC off) use the
 * real check and repair. A packaged build always may, and ignores the switch: an installed app's behaviour never
 * depends on it (T50's rule for test switches).
 */
export function firewallCheckEnabled(env: Record<string, string | undefined>, isPackaged: boolean): boolean {
  if (isPackaged) return true
  return env.OXESPACE_E2E_FIREWALL_CHECK === '1'
}

function supported(env: FirewallEnvironment, port: number | null): port is number {
  return env.platform === 'win32' && env.enabled && port !== null && Number.isInteger(port) && port > 0 && port <= 65_535
}

export async function inspectFirewall(port: number | null, address: string | undefined, env: FirewallEnvironment): Promise<RemoteFirewallStatus> {
  if (!supported(env, port)) return { supported: false }
  const base = { supported: true as const, port, ruleName: FIREWALL_RULE_DISPLAY_NAME, repairCommand: repairCommand(port, env.executablePath), undoCommand: undoCommand() }
  try {
    const result = JSON.parse((await runner(env)(inspectionScript(port, env.executablePath, address), INSPECT_TIMEOUT_MS)).trim()) as Inspection
    const blockingRuleDetected = result.blockingRuleDetected === true
    return {
      ...base,
      inspectionAvailable: true,
      // A Block rule for this program and port wins over any Allow: fail closed.
      ruleAllowed: !blockingRuleDetected && scopesReachLan(result.allowRuleScopes),
      blockingRuleDetected,
      ownRulePresent: result.ownRulePresent === true,
      privateFirewallEnabled: result.privateFirewallEnabled !== false,
      networkCategory: category(result.networkCategory)
    }
  } catch {
    // Advisory: no PowerShell, a managed policy or a timeout never blocks pairing nor hides the repair.
    return { ...base, inspectionAvailable: false, ruleAllowed: false, blockingRuleDetected: false, ownRulePresent: false, privateFirewallEnabled: true, networkCategory: 'unknown' }
  }
}

/** Adds the rule through UAC, then inspects again: done only when the fresh inspection says the rule allows the port. */
export async function repairFirewall(port: number | null, address: string | undefined, env: FirewallEnvironment): Promise<RemoteFirewallChange> {
  if (!supported(env, port)) return { ok: false, reason: 'unsupported' }
  const elevated = await elevate(`$ErrorActionPreference = 'Stop'
Get-NetFirewallRule -Name ${quotePowerShellLiteral(FIREWALL_RULE_NAME)} -ErrorAction SilentlyContinue | Remove-NetFirewallRule
${repairCommand(port, env.executablePath)} | Out-Null`, env)
  if (elevated !== 'ok') return { ok: false, reason: elevated }
  const status = await inspectFirewall(port, address, env)
  return status.supported && status.ruleAllowed ? { ok: true, status } : { ok: false, reason: 'not-verified', status }
}

/** Removes only the rule this app added (by its fixed name), through UAC, then confirms it is gone. */
export async function undoFirewall(port: number | null, address: string | undefined, env: FirewallEnvironment): Promise<RemoteFirewallChange> {
  if (!supported(env, port)) return { ok: false, reason: 'unsupported' }
  const elevated = await elevate(`$ErrorActionPreference = 'Stop'
Get-NetFirewallRule -Name ${quotePowerShellLiteral(FIREWALL_RULE_NAME)} -ErrorAction SilentlyContinue | Remove-NetFirewallRule`, env)
  if (elevated !== 'ok') return { ok: false, reason: elevated }
  const status = await inspectFirewall(port, address, env)
  return status.supported && !status.ownRulePresent ? { ok: true, status } : { ok: false, reason: 'not-verified', status }
}

async function elevate(script: string, env: FirewallEnvironment): Promise<'ok' | 'cancelled' | 'failed'> {
  // The elevated child gets the script base64-encoded: Start-Process -ArgumentList joins its array without quoting,
  // which would split a program path with spaces. The outer runner passes argv straight to CreateProcess.
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const outer = `$ErrorActionPreference = 'Stop'
try {
  $process = Start-Process -FilePath ${quotePowerShellLiteral(powerShellPath(env.systemRoot))} -ArgumentList @('-NoProfile', '-NonInteractive', '-EncodedCommand', '${encoded}') -Verb RunAs -Wait -PassThru
  [pscustomobject]@{ launched = $true; exitCode = $process.ExitCode } | ConvertTo-Json -Compress
} catch {
  [pscustomobject]@{ launched = $false; nativeErrorCode = $_.Exception.NativeErrorCode } | ConvertTo-Json -Compress
}`
  try {
    const result = JSON.parse((await runner(env)(outer, ELEVATION_TIMEOUT_MS)).trim()) as { launched?: boolean; exitCode?: number; nativeErrorCode?: number }
    // 1223: the person said No to the UAC prompt.
    if (!result.launched && result.nativeErrorCode === 1223) return 'cancelled'
    return result.launched && result.exitCode === 0 ? 'ok' : 'failed'
  } catch {
    return 'failed'
  }
}

/** An Allow rule reaches the phone when its remote scope is Any or the local subnet; anything narrower fails closed. */
function scopesReachLan(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  return value.some(scope => {
    const remote = (scope as { remoteAddresses?: unknown })?.remoteAddresses
    const list = Array.isArray(remote) ? remote.map(String) : typeof remote === 'string' ? [remote] : []
    return list.some(entry => /^(any|localsubnet|\*)$/i.test(entry.trim()))
  })
}

function category(value: unknown): RemoteFirewallNetwork {
  const word = String(value ?? '').trim().toLowerCase()
  if (word === 'public' || word === '0') return 'public'
  if (word === 'private' || word === '1') return 'private'
  if (word === 'domainauthenticated' || word === '2') return 'domain'
  return 'unknown'
}

function inspectionScript(port: number, executablePath: string, address?: string): string {
  const program = quotePowerShellLiteral(executablePath)
  const addressLookup = address ? `
try {
  $ip = Get-NetIPAddress -IPAddress ${quotePowerShellLiteral(address)} -ErrorAction Stop | Select-Object -First 1
  $profile = Get-NetConnectionProfile -InterfaceIndex $ip.InterfaceIndex -ErrorAction Stop | Select-Object -First 1
  if ($profile) { $networkCategory = [string]$profile.NetworkCategory }
} catch {}` : ''
  // ActiveStore includes rules a group policy applied, so a managed Block rule cannot read as allowed.
  return `$ErrorActionPreference = 'Stop'
$allowRuleScopes = @()
$blockingRuleDetected = $false
$rules = @(Get-NetFirewallApplicationFilter -PolicyStore ActiveStore -Program ${program} -ErrorAction SilentlyContinue | Get-NetFirewallRule | Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' })
foreach ($rule in $rules) {
  $portFilter = $rule | Get-NetFirewallPortFilter
  $protocol = [string]$portFilter.Protocol
  $ruleProfile = [string]$rule.Profile
  $portMatches = @($portFilter.LocalPort | Where-Object { [string]$_ -eq 'Any' -or [string]$_ -eq '${port}' }).Count -gt 0
  if (($protocol -eq 'Any' -or $protocol -eq 'TCP' -or $protocol -eq '6') -and ($ruleProfile -eq 'Any' -or $ruleProfile -match 'Private') -and $portMatches) {
    if ([string]$rule.Action -eq 'Block') { $blockingRuleDetected = $true }
    elseif ([string]$rule.Action -eq 'Allow') {
      $addressFilter = $rule | Get-NetFirewallAddressFilter
      $allowRuleScopes += [pscustomobject]@{ remoteAddresses = @($addressFilter.RemoteAddress | ForEach-Object { [string]$_ }) }
    }
  }
}
$ownRulePresent = @(Get-NetFirewallRule -Name ${quotePowerShellLiteral(FIREWALL_RULE_NAME)} -ErrorAction SilentlyContinue).Count -gt 0
$privateFirewallEnabled = [bool](Get-NetFirewallProfile -PolicyStore ActiveStore -Name Private).Enabled
$networkCategory = 'Unknown'${addressLookup}
[pscustomobject]@{
  allowRuleScopes = @($allowRuleScopes)
  blockingRuleDetected = $blockingRuleDetected
  ownRulePresent = $ownRulePresent
  privateFirewallEnabled = $privateFirewallEnabled
  networkCategory = $networkCategory
} | ConvertTo-Json -Depth 4 -Compress`
}

function powerShellPath(systemRoot = 'C:\\Windows'): string {
  return win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

function runner(env: FirewallEnvironment): PowerShellRunner {
  return env.runPowerShell ?? ((script, timeoutMs) => new Promise((resolve, reject) => {
    // argv reaches CreateProcess with no shell between, so the inspection needs no encoding. The live app's
    // OXESPACE_* values never reach PowerShell.
    const env2 = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('OXESPACE_')))
    execFile(powerShellPath(env.systemRoot), ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024, env: env2 }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  }))
}
