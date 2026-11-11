import type { AppDatabase } from '../../db'
import type { ContainerEngine, ContainerStartedBy } from '../../../../shared/types/oxepod'

const EARLY_SKEW_MS = 5_000
const LATE_WINDOW_MS = 60_000
const CASE_INSENSITIVE_PATHS = process.platform === 'win32' || process.platform === 'darwin'

const GLOBAL_VALUE_FLAGS = new Set(['--context', '-H', '--host', '--log-level', '--config'])
const COMPOSE_VALUE_FLAGS = new Set(['--env-file', '--profile', '--ansi', '--progress', '--parallel'])
const START_VALUE_FLAGS = new Set(['-t', '--time', '--detach-keys', '-s', '--signal'])
const SUDO_VALUE_FLAGS = new Set(['-u', '--user', '-g', '--group', '-C', '-D', '-R', '-T'])

export interface OriginContainerTarget {
  id: string
  name: string
  startedAt: number | null
  labels: Record<string, string>
}

interface ParsedComposeStart {
  kind: 'stack'
  folder: string
  projectName: string | null
}

interface ParsedContainerStart {
  kind: 'container'
  ref: string
}

type ParsedStart = ParsedComposeStart | ParsedContainerStart

interface CandidateMatch {
  at: number
  startedBy: ContainerStartedBy
}

export function normalizeOriginPath(raw: string): string {
  const slashed = raw.trim().replace(/\\/g, '/')
  if (!slashed) return ''
  const unc = slashed.startsWith('//')
  const driveMatch = /^([A-Za-z]:)(\/.*)?$/.exec(slashed)
  const prefix = unc ? '//' : driveMatch ? `${driveMatch[1]}/` : slashed.startsWith('/') ? '/' : ''
  const body = unc
    ? slashed.slice(2)
    : driveMatch
      ? (driveMatch[2] ?? '').replace(/^\/+/, '')
      : slashed.replace(/^\/+/, '')
  const out: string[] = []
  for (const part of body.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop()
      else if (!prefix) out.push('..')
    } else {
      out.push(part)
    }
  }
  const joined = out.join('/')
  if (!prefix) return joined || '.'
  return joined ? `${prefix}${joined}` : (prefix === '//' ? '/' : prefix)
}

export function resolveOriginPath(base: string, target: string): string {
  const trimmed = target.trim().replace(/\\/g, '/')
  if (!trimmed) return normalizeOriginPath(base)
  if (trimmed.startsWith('/') || /^[A-Za-z]:(\/|$)/.test(trimmed)) return normalizeOriginPath(trimmed)
  const normBase = normalizeOriginPath(base)
  if (!normBase || normBase === '.') return normalizeOriginPath(trimmed)
  return normalizeOriginPath(`${normBase.replace(/\/+$/, '')}/${trimmed}`)
}

function parentDir(filePath: string): string {
  const norm = normalizeOriginPath(filePath)
  const idx = norm.lastIndexOf('/')
  if (idx < 0) return '.'
  if (idx === 0) return '/'
  if (/^[A-Za-z]:$/.test(norm.slice(0, idx))) return `${norm.slice(0, idx)}/`
  return norm.slice(0, idx)
}

function samePath(a: string, b: string): boolean {
  const na = normalizeOriginPath(a)
  const nb = normalizeOriginPath(b)
  if (!na || !nb) return false
  return CASE_INSENSITIVE_PATHS ? na.toLowerCase() === nb.toLowerCase() : na === nb
}

function splitShellSegments(command: string): string[][] {
  const segments: string[][] = []
  let current: string[] = []
  let token = ''
  let quote: "'" | '"' | null = null
  let escaped = false
  const pushToken = (): void => {
    if (token.length > 0) {
      current.push(token)
      token = ''
    }
  }
  const pushSegment = (): void => {
    pushToken()
    if (current.length > 0) {
      segments.push(current)
      current = []
    }
  }
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]
    if (escaped) {
      token += ch
      escaped = false
      continue
    }
    if (ch === '\\' && quote !== "'") {
      const next = command[i + 1]
      if (next === '"' || next === '\\' || next === '$' || next === '`' || next === '\n' || (!quote && (next === ' ' || next === '&' || next === ';' || next === '|'))) {
        if (next === '\n') { i++; continue }
        escaped = true
        continue
      }
    }
    if (quote) {
      if (ch === quote) quote = null
      else token += ch
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      continue
    }
    if (ch === '\n' || ch === ';') {
      pushSegment()
      continue
    }
    if ((ch === '&' && command[i + 1] === '&') || (ch === '|' && command[i + 1] === '|')) {
      pushSegment()
      i++
      continue
    }
    if (/\s/.test(ch)) {
      pushToken()
      continue
    }
    token += ch
  }
  pushSegment()
  return segments
}

function stripCommandPrefixes(tokens: string[]): string[] {
  let idx = 0
  while (idx < tokens.length) {
    const cur = tokens[idx]
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(cur)) { idx++; continue }
    if (cur === 'env') { idx++; continue }
    if (cur === 'sudo') {
      idx++
      while (idx < tokens.length && tokens[idx].startsWith('-')) {
        const flag = tokens[idx]
        idx++
        if (SUDO_VALUE_FLAGS.has(flag) && idx < tokens.length) idx++
      }
      continue
    }
    break
  }
  return tokens.slice(idx)
}

function binaryName(token: string): string {
  const base = token.replace(/\\/g, '/').split('/').pop() ?? token
  return base.replace(/\.exe$/i, '').toLowerCase()
}

function parseComposeArgs(args: string[], cwd: string): ParsedComposeStart | null {
  const files: string[] = []
  let projectDir: string | null = null
  let projectName: string | null = null
  let idx = 0
  while (idx < args.length) {
    const arg = args[idx]
    if (!arg.startsWith('-')) break
    if ((arg === '-f' || arg === '--file') && idx + 1 < args.length) {
      files.push(args[idx + 1])
      idx += 2
      continue
    }
    if (arg.startsWith('--file=')) {
      files.push(arg.slice('--file='.length))
      idx++
      continue
    }
    if (arg === '--project-directory' && idx + 1 < args.length) {
      projectDir = args[idx + 1]
      idx += 2
      continue
    }
    if (arg.startsWith('--project-directory=')) {
      projectDir = arg.slice('--project-directory='.length)
      idx++
      continue
    }
    if ((arg === '-p' || arg === '--project-name') && idx + 1 < args.length) {
      projectName = args[idx + 1]
      idx += 2
      continue
    }
    if (arg.startsWith('--project-name=')) {
      projectName = arg.slice('--project-name='.length)
      idx++
      continue
    }
    if (COMPOSE_VALUE_FLAGS.has(arg) && idx + 1 < args.length) {
      idx += 2
      continue
    }
    idx++
  }
  const sub = args[idx]
  if (sub !== 'up' && sub !== 'start' && sub !== 'restart') return null
  const folder = projectDir
    ? resolveOriginPath(cwd, projectDir)
    : files.length > 0
      ? parentDir(resolveOriginPath(cwd, files[0]))
      : normalizeOriginPath(cwd)
  return { kind: 'stack', folder, projectName }
}

function parseRunArgs(args: string[]): ParsedContainerStart | null {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--') break
    if (arg === '--name' && i + 1 < args.length) return { kind: 'container', ref: args[i + 1] }
    if (arg.startsWith('--name=')) {
      const ref = arg.slice('--name='.length)
      if (ref) return { kind: 'container', ref }
    }
  }
  return null
}

function parseStartRestartArgs(args: string[]): ParsedContainerStart[] {
  const out: ParsedContainerStart[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--') {
      for (const rest of args.slice(i + 1)) if (rest) out.push({ kind: 'container', ref: rest })
      break
    }
    if (arg.startsWith('-')) {
      if (START_VALUE_FLAGS.has(arg)) i++
      continue
    }
    out.push({ kind: 'container', ref: arg })
  }
  return out
}

export function extractCommandStarts(command: string, rootPath: string): ParsedStart[] {
  const starts: ParsedStart[] = []
  let cwd = normalizeOriginPath(rootPath)
  for (const rawSegment of splitShellSegments(command)) {
    const tokens = stripCommandPrefixes(rawSegment)
    if (tokens.length === 0) continue
    const bin = binaryName(tokens[0])
    if (bin === 'cd') {
      if (tokens[1] && tokens[1] !== '-') cwd = resolveOriginPath(cwd, tokens[1])
      continue
    }
    if (bin === 'docker-compose' || bin === 'podman-compose') {
      const compose = parseComposeArgs(tokens.slice(1), cwd)
      if (compose) starts.push(compose)
      continue
    }
    if (bin === 'docker' || bin === 'podman') {
      let idx = 1
      while (idx < tokens.length && tokens[idx].startsWith('-')) {
        const flag = tokens[idx]
        idx++
        if (GLOBAL_VALUE_FLAGS.has(flag) && idx < tokens.length) idx++
      }
      const sub = tokens[idx]
      if (!sub) continue
      if (sub === 'compose') {
        const compose = parseComposeArgs(tokens.slice(idx + 1), cwd)
        if (compose) starts.push(compose)
      } else if (sub === 'run') {
        const run = parseRunArgs(tokens.slice(idx + 1))
        if (run) starts.push(run)
      } else if (sub === 'container' && tokens[idx + 1] === 'run') {
        const run = parseRunArgs(tokens.slice(idx + 2))
        if (run) starts.push(run)
      } else if (sub === 'start' || sub === 'restart') {
        starts.push(...parseStartRestartArgs(tokens.slice(idx + 1)))
      } else if (sub === 'container' && (tokens[idx + 1] === 'start' || tokens[idx + 1] === 'restart')) {
        starts.push(...parseStartRestartArgs(tokens.slice(idx + 2)))
      }
    }
  }
  return starts
}

function matchesContainerRef(ref: string, target: OriginContainerTarget): boolean {
  if (!ref) return false
  if (ref === target.name || ref === target.id) return true
  return ref.length >= 6 && (target.id.startsWith(ref) || ref.startsWith(target.id))
}

function containerStackFolders(labels: Record<string, string>): string[] {
  const out: string[] = []
  const workingDir = labels['com.docker.compose.project.working_dir'] ?? labels['io.podman.compose.project.working_dir']
  if (workingDir) out.push(workingDir)
  const configFiles = labels['com.docker.compose.project.config_files'] ?? labels['io.podman.compose.project.config_files'] ?? ''
  for (const entry of configFiles.split(',')) {
    const trimmed = entry.trim()
    if (trimmed) out.push(parentDir(trimmed))
  }
  return out
}

function matchesStack(folder: string, projectName: string | null, target: OriginContainerTarget): boolean {
  const projectLabel = target.labels['com.docker.compose.project'] ?? target.labels['io.podman.compose.project']
  if (!projectLabel) return false
  if (projectName && projectName !== projectLabel) return false
  const folders = containerStackFolders(target.labels)
  return folders.some(candidate => samePath(folder, candidate))
}

function inWindow(startedAt: number, began: number, ended: number): boolean {
  return startedAt >= began - EARLY_SKEW_MS && startedAt <= ended + LATE_WINDOW_MS
}

function extractToolCommand(detail: unknown): string | null {
  if (typeof detail !== 'string' || !detail.trim()) return null
  try {
    const parsed = JSON.parse(detail) as Record<string, unknown>
    if (typeof parsed.command === 'string') return parsed.command
    if (typeof parsed.cmd === 'string') return parsed.cmd
    if (Array.isArray(parsed.command)) return parsed.command.map(String).join(' ')
  } catch {
    return null
  }
  return null
}

/**
 * Resolves who started each container (`conversation`, `person`, or `null` when unknown / outside OXESpace)
 * by comparing Docker's `StartedAt` clock against person actions, agent MCP audits, and conversation commands.
 */
export class ContainerOrigins {
  constructor(private readonly db: AppDatabase) {}

  recordPersonContainer(engine: ContainerEngine | '*', target: string, at = Date.now()): void {
    this.db.prepare('INSERT INTO container_starts (engine, target, target_kind, at) VALUES (?, ?, ?, ?)')
      .run(engine, target, 'container', at)
  }

  recordPersonStack(engine: ContainerEngine | '*', workingDir: string, at = Date.now()): void {
    const normalized = normalizeOriginPath(workingDir)
    if (!normalized) return
    this.db.prepare('INSERT INTO container_starts (engine, target, target_kind, at) VALUES (?, ?, ?, ?)')
      .run(engine, normalized, 'stack', at)
  }

  resolve(engine: ContainerEngine, containers: OriginContainerTarget[], now = Date.now()): Map<string, ContainerStartedBy | null> {
    const result = new Map<string, ContainerStartedBy | null>()
    if (containers.length === 0) return result

    const best = new Map<string, CandidateMatch>()
    const consider = (containerId: string, at: number, startedBy: ContainerStartedBy): void => {
      const current = best.get(containerId)
      if (!current || at >= current.at) {
        best.set(containerId, { at, startedBy })
      }
    }

    const threadRows = this.db.prepare('SELECT id, data_json, events_json, history_version FROM conversation_threads').all() as Array<{
      id: string
      data_json: string
      events_json: string
      history_version?: number
    }>
    const threadsById = new Map<string, { id: string; title: string; provider: 'claude' | 'codex'; rootPath: string; eventsJson: string; historyVersion: number }>()
    for (const row of threadRows) {
      try {
        const thread = JSON.parse(row.data_json) as { id?: string; title?: string; provider?: string; rootPath?: string }
        if (thread.provider !== 'claude' && thread.provider !== 'codex') continue
        threadsById.set(row.id, {
          id: row.id,
          title: typeof thread.title === 'string' ? thread.title : '',
          provider: thread.provider,
          rootPath: typeof thread.rootPath === 'string' ? thread.rootPath : '',
          eventsJson: row.events_json,
          historyVersion: row.history_version ?? 0
        })
      } catch {
        // Ignore malformed thread rows.
      }
    }

    // Source 3: Conversation shell commands.
    for (const thread of threadsById.values()) {
      if (!thread.rootPath) continue
      let events: Array<Record<string, unknown>> = []
      try {
        if (thread.historyVersion > 0) {
          const eventRows = this.db.prepare('SELECT data_json FROM conversation_events WHERE thread_id = ? ORDER BY seq').all(thread.id) as Array<{ data_json: string }>
          events = eventRows.map(entry => JSON.parse(entry.data_json) as Record<string, unknown>)
        } else {
          const parsed = JSON.parse(thread.eventsJson) as unknown
          if (Array.isArray(parsed)) events = parsed as Array<Record<string, unknown>>
        }
      } catch {
        events = []
      }
      for (const event of events) {
        if (event.type !== 'tool' || typeof event.startedAt !== 'number') continue
        const command = extractToolCommand(event.detail)
        if (!command) continue
        const began = event.startedAt
        const ended = typeof event.completedAt === 'number' ? event.completedAt : Math.max(began, now)
        const starts = extractCommandStarts(command, thread.rootPath)
        if (starts.length === 0) continue
        for (const container of containers) {
          if (container.startedAt === null || !inWindow(container.startedAt, began, ended)) continue
          const matched = starts.some(start =>
            start.kind === 'container'
              ? matchesContainerRef(start.ref, container)
              : matchesStack(start.folder, start.projectName, container)
          )
          if (matched) {
            consider(container.id, began, {
              kind: 'conversation',
              conversationId: thread.id,
              title: thread.title,
              provider: thread.provider
            })
          }
        }
      }
    }

    // Source 2: Agents' MCP container action audit.
    const auditRows = this.db.prepare(
      "SELECT ts, actor, text FROM oxequery_audit WHERE tool = 'oxespace_container_action' AND outcome = 'ok' AND actor LIKE 'thread:%' ORDER BY ts ASC"
    ).all() as Array<{ ts: number; actor: string; text: string }>
    for (const audit of auditRows) {
      const match = /^(?:start|restart)\s+container\s+(\S+)/i.exec(audit.text.trim())
      if (!match) continue
      const threadId = audit.actor.slice('thread:'.length)
      const thread = threadsById.get(threadId)
      if (!thread) continue
      const ref = match[1]
      for (const container of containers) {
        if (container.startedAt === null || !inWindow(container.startedAt, audit.ts, audit.ts)) continue
        if (matchesContainerRef(ref, container)) {
          consider(container.id, audit.ts, {
            kind: 'conversation',
            conversationId: thread.id,
            title: thread.title,
            provider: thread.provider
          })
        }
      }
    }

    // Source 1: Person starts recorded through OXESpace.
    const personRows = this.db.prepare('SELECT engine, target, target_kind, at FROM container_starts ORDER BY at ASC').all() as Array<{
      engine: string
      target: string
      target_kind: 'container' | 'stack'
      at: number
    }>
    for (const row of personRows) {
      if (row.engine !== '*' && row.engine !== engine) continue
      for (const container of containers) {
        if (container.startedAt === null || !inWindow(container.startedAt, row.at, row.at)) continue
        const matched = row.target_kind === 'container'
          ? matchesContainerRef(row.target, container)
          : matchesStack(row.target, null, container)
        if (matched) consider(container.id, row.at, { kind: 'person' })
      }
    }

    for (const container of containers) {
      result.set(container.id, best.get(container.id)?.startedBy ?? null)
    }
    return result
  }
}
