import { redactSecrets } from '../../../shared/secrets'
import { threadToolSummary } from '../../../shared/threadToolSummary'
import type { ThreadActivity } from '../../../shared/types/agents'
import type { ThreadEvent, ThreadRequest, ThreadSnapshot } from '../../../shared/types/thread'
import { normalizeRootPath } from '../../../shared/utils/path'
import { i18n } from '../../i18n'

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
  if (/^[A-Za-z]:/.test(base)) return true
  if (typeof navigator !== 'undefined' && /Win|Mac/i.test(navigator.userAgent)) return true
  return false
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
  return cutSafe(relativizeInText(redactSecrets(raw), root).trim(), limit)
}

function stripInlineMarkdown(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^(?:[-*+]|\d+\.)\s+/, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .trim()
}

/** A request title inside a sentence ("asks to run a command"): its first letter in lower case, unless it is an acronym or a name. */
function midSentence(text: string): string {
  return /^[A-Z][a-z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text
}

function firstSentence(raw: string, root: string, limit: number): string {
  const withRelPaths = relativizeInText(redactSecrets(raw), root)
  const firstLine = withRelPaths
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => Boolean(line) && !line.startsWith('```'))
    .map(stripInlineMarkdown)
    .find(Boolean) ?? ''
  if (!firstLine) return ''
  const collapsed = firstLine.replace(/\s+/g, ' ')
  const match = /^(.+?[.!?])(?=\s|$)/.exec(collapsed)
  return cutSafe((match ? match[1] : collapsed).replace(/\.+$/, ''), limit)
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
  const detail = (event.detail ?? '').trim()
  // A tool's input is JSON while it streams in: say the command or the file it names, never the opening brace.
  if (detail.startsWith('{') || detail.startsWith('[')) {
    const summary = threadToolSummary({ name: event.name, detail })
    return /^Open details to inspect/.test(summary) || /^[{[]/.test(summary) ? '' : cleanText(summary, root, 160)
  }
  const firstLine = detail.split(/\r?\n/, 1)[0] ?? ''
  if (!firstLine) return ''
  if (kind === 'read' || kind === 'edit') {
    const asPath = relativizePath(firstLine.trim(), root)
    return cutSafe(relativizeInText(redactSecrets(asPath), root), 160)
  }
  return cleanText(firstLine, root, 160)
}

/**
 * Renderer-safe derivation of `ThreadActivity` from the active `ThreadSnapshot` so `<NowLine>`
 * renders live beneath `ThreadHeader` in OxeChat whenever a conversation has activity, a pending
 * approval/question, an error, or a completed summary.
 */
export function deriveThreadActivity(
  snapshot: ThreadSnapshot | null | undefined,
  pendingRequests: readonly ThreadRequest[]
): ThreadActivity | null {
  if (!snapshot) return null
  const { thread, events, turns = [] } = snapshot
  const root = thread.rootPath ?? ''
  const baseAt = typeof thread.updatedAt === 'number' && Number.isFinite(thread.updatedAt) ? thread.updatedAt : Date.now()

  const pending = pendingRequests.filter(request => request.state === 'pending')
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
    const text = midSentence(cleanText(first.title, root, 200))
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
    const runningTool = [...events].reverse().find(
      (event): event is Extract<ThreadEvent, { type: 'tool' }> => event.type === 'tool' && event.state === 'running'
    )
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
    const reasoning = [...events].reverse().find(
      (event): event is Extract<ThreadEvent, { type: 'reasoning' }> => event.type === 'reasoning'
    )
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
    // A turn the app cut short when it closed is settled with what happened (thread-recovery.service.ts); one the
    // person stopped is settled with nothing. The status line said "You stopped it" for both.
    const settled = [...events].reverse().find((event): event is Extract<ThreadEvent, { type: 'completed' }> => event.type === 'completed')
    return {
      kind: 'paused',
      at: lastTurn?.completedAt ?? lastTurn?.startedAt ?? baseAt,
      ...(settled?.status === 'interrupted' && settled.error ? { reason: 'app-closed' } : {})
    }
  }

  if (thread.status === 'failed' || turnStatus === 'failed') {
    const failedEvent = [...events].reverse().find(
      (event): event is Extract<ThreadEvent, { type: 'completed' }> => event.type === 'completed' && event.status === 'failed'
    )
    const code = failedEvent?.failure?.code ?? failedEvent?.errorCode
    const titledKey = code ? `thread:failure.title.${code}` : ''
    const humanReason = (code && i18n.exists(titledKey) ? String(i18n.t(titledKey as never)) : undefined)
      ?? failedEvent?.error
      ?? failedEvent?.failure?.message
      ?? (code ? String(code) : undefined)
    const reason = humanReason ? cleanText(humanReason, root, 200) : undefined
    return {
      kind: 'error',
      at: failedEvent?.failure?.occurredAt ?? lastTurn?.completedAt ?? lastTurn?.startedAt ?? baseAt,
      ...(reason ? { reason } : {})
    }
  }

  // A restore that was not confirmed yet keeps the undone turns in the history, for Redo. They are no longer where the
  // conversation stands: their answer is not the last word, and when the files went back, neither are their changes.
  const undoneFrom = thread.rewind ? events.findIndex(event => event.type === 'message' && event.role === 'user' && event.id === thread.rewind!.turnId) : -1
  const standing = undoneFrom >= 0 ? events.slice(0, undoneFrom) : events
  const filesWentBack = undoneFrom >= 0 && Boolean(thread.rewind?.redoCheckpointIds?.length)

  // Empty new conversation before any message or turn: keep header clean without "Done."
  if (standing.length === 0) return null

  const changedFiles = new Set(
    (filesWentBack ? standing : events).flatMap(event => event.type === 'tool' && event.files ? event.files.map(file => file.path) : [])
  ).size
  const lastAssistant = [...standing].reverse().find(
    (event): event is Extract<ThreadEvent, { type: 'message' }> => event.type === 'message' && event.role === 'assistant' && Boolean(event.text.trim())
  )
  const summary = lastAssistant ? firstSentence(lastAssistant.text, root, 200) : ''
  return {
    kind: changedFiles > 0 ? 'ready' : 'done',
    at: lastTurn?.completedAt ?? baseAt,
    ...(summary ? { text: summary } : {})
  }
}
