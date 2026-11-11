import { redactSecrets } from '../../../../shared/secrets'
import type { ThreadActivity, ThreadActivityKind, ThreadActivityVerb } from '../../../../shared/types/agents'
import type { ConversationThread, ThreadEvent, ThreadRequest, ThreadTurn } from '../../../../shared/types/thread'
import { isCaseInsensitiveFs, normalizeRootPath } from '../../../../shared/utils/path'

export type { ThreadActivity, ThreadActivityKind, ThreadActivityVerb }

export interface ThreadActivityInput {
  thread: ConversationThread
  events: readonly ThreadEvent[]
  requests: readonly ThreadRequest[]
  turns: readonly ThreadTurn[]
  changedFiles: number
  now: number
}

type ToolVerb = 'read' | 'edit' | 'run' | 'query' | 'http' | 'container' | 'other'

const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'read_file', 'list_dir', 'grep_files'])
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'apply_patch'])
const RUN_TOOLS = new Set(['Bash', 'PowerShell', 'BashOutput', 'KillShell', 'shell', 'command', 'exec_command', 'write_stdin', 'local_shell', 'unified_exec'])
const HTTP_TOOLS = new Set(['WebFetch', 'WebSearch', 'web_search'])
const TRAILING_PUNCT = /[.,;:!?)\]}]+$/

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

function cleanText(raw: string | undefined, root: string, limit: number): string {
  if (!raw) return ''
  const redacted = redactSecrets(raw)
  const rel = relativizeInText(redacted, root).trim()
  return cutSafe(rel, limit)
}

function firstSentence(raw: string, root: string, limit: number): string {
  const redacted = redactSecrets(raw)
  const withRelPaths = relativizeInText(redacted, root)
  const firstLine = withRelPaths
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(Boolean) ?? ''
  if (!firstLine) return ''
  const collapsed = firstLine.replace(/\s+/g, ' ')
  const match = /^(.+?[.!?])(?=\s|$)/.exec(collapsed)
  return cutSafe(match ? match[1] : collapsed, limit)
}

function normalizeToolName(name: string): string {
  const mcp = /^mcp__[^_].*?__(.+)$/.exec(name)
  if (mcp) return mcp[1]
  const dot = /^[^.]+\.(.+)$/.exec(name)
  if (dot) return dot[1]
  return name
}

function classifyToolVerb(rawName: string): ToolVerb {
  const name = normalizeToolName(rawName)
  if (READ_TOOLS.has(name)) return 'read'
  if (EDIT_TOOLS.has(name)) return 'edit'
  if (RUN_TOOLS.has(name)) return 'run'
  if (/^oxespace_(?:db|mongo)_/.test(name)) return 'query'
  if (HTTP_TOOLS.has(name)) return 'http'
  if (/^oxespace_container/.test(name)) return 'container'
  return 'other'
}

function runningToolTarget(event: Extract<ThreadEvent, { type: 'tool' }>, kind: ToolVerb, root: string): string {
  if (kind === 'edit' && event.files?.[0]?.path) {
    return cutSafe(redactSecrets(relativizePath(event.files[0].path, root)), 160)
  }
  const firstLine = (event.detail ?? '').split(/\r?\n/, 1)[0] ?? ''
  if (!firstLine) return ''
  if (kind === 'read' || kind === 'edit') {
    const asPath = relativizePath(firstLine.trim(), root)
    return cutSafe(relativizeInText(redactSecrets(asPath), root), 160)
  }
  return cleanText(firstLine, root, 160)
}

/**
 * F6 A19 / T90: builds the conversation's `activity` values in main, for conversation rows only.
 * Never returns an English sentence of the app's own (C3): the window words each kind.
 */
export function threadActivity(input: ThreadActivityInput): ThreadActivity {
  const { thread, events, requests, turns, changedFiles, now } = input
  const root = thread.rootPath ?? ''
  const baseAt = typeof thread.updatedAt === 'number' && Number.isFinite(thread.updatedAt) ? thread.updatedAt : now

  const pending = requests.filter(request => request.state === 'pending')
  const pendingQuestion = pending.find(request => request.kind === 'question')
  if (pendingQuestion) {
    return {
      kind: 'question',
      at: pendingQuestion.createdAt ?? baseAt,
      count: pendingQuestion.questions?.length ?? 1,
      requestId: pendingQuestion.id
    }
  }
  if (pending.length > 0) {
    const first = pending[0]
    const text = cleanText(first.title, root, 200)
    return {
      kind: 'needs-you',
      at: first.createdAt ?? baseAt,
      ...(text ? { text } : {}),
      requestId: first.id
    }
  }

  const runningTurn = [...turns].reverse().find(turn => turn.status === 'running')
  if (runningTurn || thread.status === 'running') {
    const since = runningTurn?.startedAt
    const runningTool = [...events].reverse().find((event): event is Extract<ThreadEvent, { type: 'tool' }> => event.type === 'tool' && event.state === 'running')
    if (runningTool) {
      const toolKind = classifyToolVerb(runningTool.name)
      const target = runningToolTarget(runningTool, toolKind, root)
      return {
        kind: 'working',
        at: runningTool.startedAt ?? since ?? baseAt,
        ...(toolKind !== 'other' ? { verb: toolKind } : {}),
        ...(target ? { text: target } : {}),
        ...(since !== undefined ? { since } : {})
      }
    }
    const reasoning = [...events].reverse().find((event): event is Extract<ThreadEvent, { type: 'reasoning' }> => event.type === 'reasoning')
    return {
      kind: 'working',
      at: reasoning?.startedAt ?? since ?? baseAt,
      verb: 'think',
      ...(since !== undefined ? { since } : {})
    }
  }

  const lastTurn = turns.at(-1)
  const turnStatus = lastTurn?.status ?? thread.lastTurnStatus

  if (thread.status === 'interrupted' || turnStatus === 'interrupted') {
    return {
      kind: 'paused',
      at: lastTurn?.completedAt ?? lastTurn?.startedAt ?? baseAt
    }
  }

  if (thread.status === 'failed' || turnStatus === 'failed') {
    const failedEvent = [...events].reverse().find(
      (event): event is Extract<ThreadEvent, { type: 'completed' }> => event.type === 'completed' && event.status === 'failed'
    )
    const rawReason = failedEvent?.errorCode ?? failedEvent?.failure?.code
    const reason = rawReason ? cleanText(String(rawReason), root, 200) : undefined
    return {
      kind: 'error',
      at: failedEvent?.failure?.occurredAt ?? lastTurn?.completedAt ?? lastTurn?.startedAt ?? baseAt,
      ...(reason ? { reason } : {})
    }
  }

  const lastAssistant = [...events].reverse().find(
    (event): event is Extract<ThreadEvent, { type: 'message' }> => event.type === 'message' && event.role === 'assistant' && Boolean(event.text.trim())
  )
  const summary = lastAssistant ? firstSentence(lastAssistant.text, root, 200) : ''
  return {
    kind: changedFiles > 0 ? 'ready' : 'done',
    at: lastTurn?.completedAt ?? baseAt,
    ...(summary ? { text: summary } : {})
  }
}
