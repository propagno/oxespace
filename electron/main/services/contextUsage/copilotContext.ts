import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isWorkspacePath } from '../usage/copilotProvider'

/**
 * Copilot CLI doesn't persist token usage to its session DB, but it logs the live
 * context-window utilization to `~/.copilot/logs/process-*.log` every turn:
 *
 *   [INFO] CompactionProcessor: Utilization 28.8% (36901/128000 tokens) below threshold 80%
 *
 * That single line carries everything the `/context` meter shows — used, the real
 * window (e.g. 128000, not the SDK's nominal 256000), and the auto-compact threshold.
 * Each log also registers its session (`Registering foreground session: <uuid>`),
 * which maps to a `cwd` via `~/.copilot/session-state/<id>/workspace.yaml`, so we can
 * scope the figure to the pane's workspace.
 */

const UTILIZATION_RE = /Utilization\s+([\d.]+)%\s+\((\d+)\/(\d+)\s+tokens\)/
const SESSION_RE = /Registering foreground session:\s+([0-9a-f-]{36})/i
/** Cap the scan so a poll never reads the whole (unbounded) log history. */
const MAX_LOGS = 24

export interface CopilotContextReading {
  usedTokens: number
  limitTokens: number
  usedPct: number
  modelId: string | null
}

export function readCopilotContext(
  workspaceRootPath: string,
  copilotRoot: string = join(homedir(), '.copilot')
): CopilotContextReading | null {
  const logsDir = join(copilotRoot, 'logs')
  if (!existsSync(logsDir)) return null

  const logs = newestLogsFirst(logsDir)
  let fallback: CopilotContextReading | null = null

  for (const logPath of logs) {
    const parsed = parseLog(logPath)
    if (!parsed) continue
    // Prefer the log whose session was opened in this workspace.
    const cwd = parsed.sessionId ? resolveSessionCwd(copilotRoot, parsed.sessionId) : null
    if (cwd && isWorkspacePath(cwd, workspaceRootPath)) return parsed.reading
    // Newest log with a utilization line, regardless of cwd — used only if no
    // workspace-scoped match is found (e.g. cwd unresolvable).
    if (!fallback) fallback = parsed.reading
  }
  return fallback
}

function newestLogsFirst(logsDir: string): string[] {
  const entries: { path: string; mtimeMs: number }[] = []
  for (const name of safeReaddir(logsDir)) {
    if (!name.startsWith('process-') || !name.endsWith('.log')) continue
    const full = join(logsDir, name)
    try { entries.push({ path: full, mtimeMs: statSync(full).mtimeMs }) } catch { /* skip */ }
  }
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return entries.slice(0, MAX_LOGS).map((e) => e.path)
}

function parseLog(logPath: string): { reading: CopilotContextReading; sessionId: string | null } | null {
  let raw: string
  try { raw = readFileSync(logPath, 'utf8') } catch { return null }

  let sessionId: string | null = null
  let last: RegExpMatchArray | null = null
  for (const line of raw.split('\n')) {
    if (!sessionId) {
      const s = line.match(SESSION_RE)
      if (s) sessionId = s[1]
    }
    if (line.includes('Utilization')) {
      const m = line.match(UTILIZATION_RE)
      if (m) last = m
    }
  }
  if (!last) return null

  const usedTokens = Number(last[2])
  const limitTokens = Number(last[3])
  if (!Number.isFinite(usedTokens) || !Number.isFinite(limitTokens) || limitTokens <= 0) return null
  const usedPct = clampPct((usedTokens / limitTokens) * 100)
  return { reading: { usedTokens, limitTokens, usedPct, modelId: 'GitHub Copilot' }, sessionId }
}

/** Read `cwd:` from `session-state/<id>/workspace.yaml` (a flat YAML; no parser needed). */
function resolveSessionCwd(copilotRoot: string, sessionId: string): string | null {
  const yaml = join(copilotRoot, 'session-state', sessionId, 'workspace.yaml')
  try {
    for (const line of readFileSync(yaml, 'utf8').split('\n')) {
      const m = line.match(/^\s*cwd:\s*(.+?)\s*$/)
      if (m) return stripQuotes(m[1])
    }
  } catch { /* missing/unreadable */ }
  return null
}

function stripQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, '')
}

function safeReaddir(dir: string): string[] {
  try { return readdirSync(dir) } catch { return [] }
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}
