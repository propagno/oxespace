import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import type { McpServerConfig, McpTransport } from '../../../shared/types/mcp'
import { inheritedEnvironment } from './policy'

const WINDOWS_EXECUTABLE_EXTENSIONS = ['.cmd', '.exe', '.bat', '.ps1']

/**
 * Stops a server and everything it spawned. On Windows the command runs through
 * a shell wrapper, so killing only the wrapper leaves the real server (and, for
 * mcp-remote, its OAuth callback port) alive and blocks the next start.
 */
export function killProcessTree(child: ChildProcessWithoutNullStreams | null): void {
  if (!child) return
  try {
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => undefined)
    } else {
      child.kill()
    }
  } catch { /* already gone */ }
}

export function validateConfig(transport: McpTransport, config: McpServerConfig, trusted = false): void {
  if (config.transport !== transport) {
    throw new Error(`Config transport "${config.transport}" does not match server transport "${transport}"`)
  }
  if (config.transport === 'stdio') {
    if (!config.command?.trim()) throw new Error('stdio requer command')
    if (!Array.isArray(config.args)) throw new Error('stdio requer args como array')
    if (!trusted) {
      const sensitiveKeys = Object.keys(config.env ?? {}).filter((key) => /(token|secret|password|key|credential)/i.test(key))
      if (sensitiveKeys.length > 0) {
        throw new Error(`Sensitive environment blocked on an untrusted MCP server: ${sensitiveKeys.join(', ')}`)
      }
    }
  } else {
    if (!config.url?.trim()) throw new Error(`${transport} requer url`)
    let parsed: URL
    try { parsed = new URL(config.url.trim()) } catch { throw new Error(`${transport} requires a valid URL`) }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(`Unsupported MCP URL scheme "${parsed.protocol}". Only http and https are allowed.`)
    }
    const host = parsed.hostname.toLowerCase()
    if (!host || /^169\.254\./.test(host) || host === 'metadata.google.internal' || host === 'metadata.goog' || host === 'fd00:ec2::254' || host === '[fd00:ec2::254]') {
      throw new Error('MCP server URL targets a blocked address.')
    }
  }
}

export function isMethodNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: unknown }).code
  if (code === -32601) return true
  const msg = err instanceof Error ? err.message : String(err)
  return /method not found|-32601/i.test(msg)
}

export function buildProcessEnv(extraEnv: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...inheritedEnvironment('mcp'), ...extraEnv }
  const pathKey = getPathKey(env)
  env[pathKey] = mergePathEntries(env[pathKey] ?? process.env[pathKey] ?? process.env.PATH ?? '', commonExecutableDirs(env))
  return env
}

function getPathKey(env: NodeJS.ProcessEnv): string {
  return Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
}

function mergePathEntries(currentPath: string, entries: string[]): string {
  const seen = new Set<string>()
  const merged: string[] = []
  for (const entry of [...entries, ...currentPath.split(path.delimiter)]) {
    const trimmed = entry.trim()
    if (!trimmed) continue
    const key = process.platform === 'win32' ? trimmed.toLowerCase() : trimmed
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(trimmed)
  }
  return merged.join(path.delimiter)
}

function commonExecutableDirs(env: NodeJS.ProcessEnv): string[] {
  if (process.platform !== 'win32') return []
  return [
    env.ProgramFiles ? path.join(env.ProgramFiles, 'nodejs') : null,
    env['ProgramFiles(x86)'] ? path.join(env['ProgramFiles(x86)']!, 'nodejs') : null,
    env.APPDATA ? path.join(env.APPDATA, 'npm') : null,
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Programs', 'nodejs') : null,
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'pnpm') : null
  ].filter((entry): entry is string => Boolean(entry))
}

export function resolveExecutable(command: string, env: NodeJS.ProcessEnv): string {
  const trimmed = command.trim()
  if (!trimmed) return command
  if (process.platform !== 'win32') return trimmed
  if (path.isAbsolute(trimmed) || trimmed.includes('\\') || trimmed.includes('/')) {
    return trimmed
  }
  return findWindowsExecutable(trimmed, env) ?? trimmed
}

function findWindowsExecutable(command: string, env: NodeJS.ProcessEnv): string | null {
  const result = spawnSync('where.exe', [command], {
    env,
    windowsHide: true,
    encoding: 'utf8'
  })
  if (result.status !== 0 || !result.stdout.trim()) return null
  const matches = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (path.extname(command)) return matches[0] ?? null
  return (
    matches.find((candidate) => WINDOWS_EXECUTABLE_EXTENSIONS.includes(path.extname(candidate).toLowerCase())) ??
    matches[0] ??
    null
  )
}

export function shouldUseWindowsCommandShell(command: string): boolean {
  if (process.platform !== 'win32') return false
  const ext = path.extname(command).toLowerCase()
  return ext === '.cmd' || ext === '.bat'
}

export function formatExitMessage(code: number | null, stderrLines: string[]): string {
  const last = stderrLines.slice(-3).filter(Boolean)
  if (last.length > 0) {
    const joined = last.join(' | ')
    return code === null ? `Exited unexpectedly — ${joined}` : `Exited with code ${code} — ${joined}`
  }
  if (code === null) {
    return 'Exited without an explicit code (often: missing required env var or dependency). Check the server\'s stderr.'
  }
  return `Exited with code ${code}`
}

export function formatSpawnError(command: string, err: unknown): string {
  const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code?: unknown }).code) : null
  const rawMessage = err instanceof Error ? err.message : String(err)
  if (code === 'ENOENT') {
    const suffix = process.platform === 'win32' && !path.extname(command) ? `. On Windows, OXESpace also looks for ${command}.cmd on the PATH.` : ''
    return `Executable "${command}" not found${suffix} Install the required dependency or set the command's absolute path in the MCP server.`
  }
  return `Could not start "${command}": ${rawMessage}`
}

export function timeout<T>(ms: number, message: string): Promise<T> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))
}
