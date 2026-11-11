import { redactSecrets } from './secrets'
import type { ThreadEvent } from './types/thread'
import { isCaseInsensitiveFs, normalizeRootPath } from './utils/path'

export const TOOL_ROW_KINDS = ['read', 'edit', 'run', 'query', 'http', 'container', 'other'] as const
export type ToolRowKind = (typeof TOOL_ROW_KINDS)[number]

export interface ToolRowMeta {
  additions?: number
  deletions?: number
  exitCode?: number
}

export interface ToolRow {
  kind: ToolRowKind
  verb: ToolRowKind
  target: string
  meta: ToolRowMeta
  at: number
  failed: boolean
  running: boolean
  truncated?: boolean
}

export interface FoldSummary {
  steps: number
  read: number
  edited: number
  ran: number
  queries: number
  http: number
  containers: number
  other: number
  failed: number
  fixed: number
  running: boolean
}

const TARGET_LIMIT = 160
const READ_NAMES = new Set(['Read', 'Grep', 'Glob', 'LS', 'read_file', 'list_dir', 'grep_files'])
const EDIT_NAMES = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'apply_patch'])
const RUN_NAMES = new Set(['Bash', 'PowerShell', 'BashOutput', 'KillShell', 'shell', 'command', 'exec_command', 'write_stdin', 'local_shell', 'unified_exec'])
const HTTP_NAMES = new Set(['WebFetch', 'WebSearch', 'web_search'])
const OTHER_NAMES = new Set(['update_plan', 'Task', 'ExitPlanMode', 'AskUserQuestion', 'Skill'])
const TRAILING_PUNCT = /[.,;:!?)\]}]+$/

const editedFilesByRow = new WeakMap<object, readonly string[]>()

function cutSafe(text: string, limit: number): string {
  if (text.length <= limit) return text
  let end = limit
  const code = text.charCodeAt(end - 1)
  if (code >= 0xd800 && code <= 0xdbff) end -= 1
  return text.slice(0, end)
}

function caseInsensitiveFor(base: string): boolean {
  return /^[A-Za-z]:/.test(base) || (typeof process !== 'undefined' && isCaseInsensitiveFs(process.platform))
}

function relativizePath(rawPath: string, root: string): string {
  if (!rawPath) return ''
  const norm = rawPath.replace(/\\/g, '/')
  if (!root) return norm.replace(/^\.\//, '')
  const base = normalizeRootPath(root)
  if (base === '/') return norm
  const ci = caseInsensitiveFor(base)
  const key = ci ? norm.toLowerCase() : norm
  const baseKey = ci ? base.toLowerCase() : base
  if (key === baseKey) return '.'
  if (key.startsWith(`${baseKey}/`)) {
    const rest = norm.slice(base.length + 1).replace(/^\/+/, '')
    if (rest && !rest.split('/').includes('..')) return rest
  }
  return norm.replace(/^\.\//, '')
}

function relativizeInText(text: string, root: string): string {
  if (!text || !root) return text
  const base = normalizeRootPath(root)
  if (!base || base === '/') return text
  const ci = caseInsensitiveFor(base)
  const escaped = base
    .split('/')
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\\\/]+')
  const re = new RegExp(`${escaped}(?:[\\\\/]+([^\\s"'\`<>|\\u0000-\\u001f]+)|(?=$|[\\s"'\`<>|.,;:!?)\\]}]))`, ci ? 'gi' : 'g')
  return text.replace(re, (_match, rest: string | undefined) => {
    if (!rest) return '.'
    const trail = TRAILING_PUNCT.exec(rest)?.[0] ?? ''
    const body = trail ? rest.slice(0, -trail.length) : rest
    if (!body) return `.${trail}`
    const normalized = body.replace(/[\\/]+/g, '/').replace(/^\/+/, '')
    if (!normalized || normalized.split('/').includes('..')) return `.${trail}`
    return `${normalized}${trail}`
  })
}

export function normalizeToolRowName(rawName: string): string {
  const mcp = /^mcp__[^_].*?__(.+)$/.exec(rawName)
  if (mcp) return mcp[1]
  const dot = /^[^.]+\.(.+)$/.exec(rawName)
  if (dot) return dot[1]
  return rawName
}

export function classifyToolRowKind(rawName: string): ToolRowKind {
  const name = normalizeToolRowName(rawName)
  if (OTHER_NAMES.has(name)) return 'other'
  if (READ_NAMES.has(name)) return 'read'
  if (EDIT_NAMES.has(name)) return 'edit'
  if (RUN_NAMES.has(name)) return 'run'
  if (/^oxespace_(?:db|mongo)_/.test(name)) return 'query'
  if (HTTP_NAMES.has(name)) return 'http'
  if (/^oxespace_container/.test(name)) return 'container'
  return 'other'
}

/**
 * A native tool's input arrives as JSON. The row names what it touches (the file, the command, the address), never
 * the opening brace. `null` when the detail is not JSON; '' while the JSON is still streaming in.
 */
function jsonTarget(rawDetail: string, kind: ToolRowKind): string | null {
  const detail = rawDetail.trim()
  if (!detail.startsWith('{')) return null
  try {
    const input = JSON.parse(detail) as Record<string, unknown>
    const pick = (...keys: string[]): string => {
      for (const key of keys) { const value = input[key]; if (typeof value === 'string' && value.trim()) return value.trim().split(/\r?\n/, 1)[0] }
      return ''
    }
    if (kind === 'read' || kind === 'edit') return pick('file_path', 'notebook_path', 'path', 'pattern', 'query')
    if (kind === 'run') return pick('command', 'cmd', 'description')
    return pick('url', 'query', 'description', 'command', 'file_path', 'path', 'pattern', 'action')
  } catch {
    return ''
  }
}

function targetFor(event: Extract<ThreadEvent, { type: 'tool' }>, kind: ToolRowKind, root: string): string {
  if (kind === 'edit' && event.files?.length && event.files[0].path) {
    return cutSafe(relativizeInText(redactSecrets(relativizePath(event.files[0].path, root)), root), TARGET_LIMIT)
  }
  const named = jsonTarget(event.detail ?? '', kind)
  const firstLine = named ?? (event.detail ?? '').split(/\r?\n/, 1)[0] ?? ''
  if (!firstLine) return ''
  if (kind === 'read' || kind === 'edit') {
    const rel = relativizePath(firstLine.trim(), root)
    return cutSafe(relativizeInText(redactSecrets(rel), root), TARGET_LIMIT)
  }
  return cutSafe(relativizeInText(redactSecrets(firstLine), root).trim(), TARGET_LIMIT)
}

export function toolRow(event: Extract<ThreadEvent, { type: 'tool' }>, root: string): ToolRow {
  const kind = classifyToolRowKind(event.name)
  const target = targetFor(event, kind, root)
  const meta: ToolRowMeta = kind === 'edit'
    ? {
        additions: (event.files ?? []).reduce((sum, file) => sum + (file.additions ?? 0), 0),
        deletions: (event.files ?? []).reduce((sum, file) => sum + (file.deletions ?? 0), 0)
      }
    : event.exitCode !== undefined
      ? { exitCode: event.exitCode }
      : {}
  const running = event.state === 'running'
  const failed = !running && (event.state === 'failed' || (typeof event.exitCode === 'number' && event.exitCode !== 0))
  const row: ToolRow = {
    kind,
    verb: kind,
    target,
    meta,
    at: event.startedAt ?? event.completedAt ?? 0,
    failed,
    running,
    ...(event.outputTruncated ? { truncated: true } : {})
  }
  if (kind === 'edit' && event.files?.length) {
    const paths = event.files
      .map(file => cutSafe(relativizeInText(redactSecrets(relativizePath(file.path, root)), root), TARGET_LIMIT))
      .filter(Boolean)
    if (paths.length) editedFilesByRow.set(row, paths)
  }
  return row
}

export function foldSummary(rows: ToolRow[]): FoldSummary {
  let read = 0
  let ran = 0
  let queries = 0
  let http = 0
  let containers = 0
  let other = 0
  let failed = 0
  let fixed = 0
  let running = false
  const editedFiles = new Set<string>()

  rows.forEach((row, index) => {
    if (row.running) running = true
    switch (row.kind) {
      case 'read': read += 1; break
      case 'edit': {
        const paths = editedFilesByRow.get(row)
        if (paths?.length) {
          for (const path of paths) editedFiles.add(path.replace(/\\/g, '/'))
        } else if (row.target) {
          editedFiles.add(row.target.replace(/\\/g, '/'))
        } else {
          editedFiles.add(`__anon_${index}`)
        }
        break
      }
      case 'run': ran += 1; break
      case 'query': queries += 1; break
      case 'http': http += 1; break
      case 'container': containers += 1; break
      default: other += 1; break
    }
    if (row.failed) {
      const recovered = rows.slice(index + 1).some(
        later => later.kind === row.kind && later.target === row.target && !later.failed && !later.running
      )
      if (recovered) fixed += 1
      else failed += 1
    }
  })

  return {
    steps: rows.length,
    read,
    edited: editedFiles.size,
    ran,
    queries,
    http,
    containers,
    other,
    failed,
    fixed,
    running
  }
}
