/**
 * Reads the presentation and scope data Claude attaches to a `can_use_tool`
 * request, so the approval card can say *why* it is asking and offer
 * "allow for this session" with the exact rule the CLI proposed.
 *
 * The suggestions are opaque to us: they are handed back unchanged as
 * `updatedPermissions`, never composed or edited here, so the CLI stays the
 * only author of permission rules. Field names were checked against the
 * installed CLI's own request schema.
 */
import { commandTouchesProtected, protectedConfigKind } from './kernel/protected-config'

export interface ClaudePermissionPresentation {
  title: string
  detail: string
  /** Rules the CLI proposed; returned verbatim when the person allows for the session. */
  suggestions: unknown[]
  toolUseId?: string
  decisions: ('accept' | 'acceptForSession' | 'decline')[]
}

const MAX_SUGGESTIONS = 20
const MAX_FIELD = 600

// The CLI documents that decision_reason "may carry ANSI escapes", so whole
// sequences are removed before stray control characters are dropped.
const ANSI = new RegExp(
  '\\u001b(?:\\[[0-?]*[ -/]*[@-~]|\\][^\\u0007\\u001b]*(?:\\u0007|\\u001b\\\\)|[@-Z\\\\-_])',
  'g'
)
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g

const text = (value: unknown): string =>
  typeof value === 'string' ? value.replace(ANSI, '').replace(CONTROL, '').trim().slice(0, MAX_FIELD) : ''

const pick = (record: Record<string, unknown>, ...keys: string[]): string => {
  for (const key of keys) {
    const value = text(record[key])
    if (value) return value
  }
  return ''
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '')
const baseName = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path
// A block that ends in a line break ends its last line; it has no empty line after it (a new file showed one more "+").
const signed = (block: string, sign: '-' | '+'): string => block.replace(/\r?\n$/, '').split('\n').map(line => `${sign} ${line}`).join('\n')

/**
 * What the tool is about to do, in the words a person reads: the command itself, the file with the lines that leave
 * and the lines that come in, the address. Never the tool's raw JSON, unless its input has no plain shape.
 */
export function readableToolInput(toolName: string, displayName: string, input: Record<string, unknown>): { title: string; body: string } {
  const command = str(input.command)
  if (command) return { title: 'Run a command', body: command }
  const file = str(input.file_path) || str(input.notebook_path) || str(input.path)
  if (file) {
    const verb = /write|create/i.test(toolName) ? 'Write' : /read|view/i.test(toolName) ? 'Read' : 'Edit'
    const title = `${verb} ${baseName(file)}`
    if (typeof input.old_string === 'string' && typeof input.new_string === 'string') return { title, body: [file, signed(input.old_string, '-'), signed(input.new_string, '+')].join('\n') }
    if (Array.isArray(input.edits)) {
      const edits = input.edits.filter((edit): edit is Record<string, unknown> => edit !== null && typeof edit === 'object')
      return { title, body: [file, ...edits.map(edit => [signed(str(edit.old_string), '-'), signed(str(edit.new_string), '+')].join('\n'))].join('\n\n') }
    }
    if (typeof input.content === 'string') return { title, body: [file, signed(input.content, '+')].join('\n') }
    if (typeof input.new_source === 'string') return { title, body: [file, signed(input.new_source, '+')].join('\n') }
    return { title, body: file }
  }
  const url = str(input.url)
  if (url) {
    let host = url
    try { host = new URL(url).host || url } catch { /* not a URL: shown as given */ }
    return { title: `Open ${host}`, body: [url, str(input.prompt)].filter(Boolean).join('\n') }
  }
  const entries = Object.entries(input)
  const plain = entries.every(([, value]) => value === null || ['string', 'number', 'boolean'].includes(typeof value))
  const body = entries.length === 0 ? '' : plain ? entries.map(([name, value]) => `${name}: ${String(value)}`).join('\n') : JSON.stringify(input, null, 2) ?? ''
  return { title: `Use ${displayName}`, body }
}

export function describePermissionRequest(
  request: Record<string, unknown>,
  toolName: string,
  input: Record<string, unknown>
): ClaudePermissionPresentation {
  const toolUseId = pick(request, 'tool_use_id', 'toolUseID', 'toolUseId')

  // A plan is reviewed, not "allowed": show it as prose and never offer to
  // remember the decision, since approving one plan says nothing about the next.
  if (toolName === 'ExitPlanMode' && typeof input.plan === 'string' && input.plan.trim()) {
    return {
      title: pick(request, 'title') || 'Aprovar o plano?',
      detail: input.plan.trim().slice(0, 12000),
      suggestions: [],
      ...(toolUseId ? { toolUseId } : {}),
      decisions: ['accept', 'decline']
    }
  }

  const displayName = pick(request, 'display_name', 'displayName') || toolName
  const readable = readableToolInput(toolName, displayName, input)
  const title = pick(request, 'title') || readable.title

  const lines: string[] = []
  const description = pick(request, 'description')
  const reason = pick(request, 'decision_reason', 'decisionReason')
  const blocked = pick(request, 'blocked_path', 'blockedPath')
  if (description) lines.push(description)
  if (reason) lines.push(`Reason: ${reason}`)
  if (blocked) lines.push(`Path outside the workspace: ${blocked}`)

  // Which user-configured "ask" rule forced this prompt, when the CLI says so.
  const matched = request.matched_ask_rule
  if (matched && typeof matched === 'object' && !Array.isArray(matched)) {
    const rule = matched as Record<string, unknown>
    const content = text(rule.rule_content)
    const label = [text(rule.tool_name), content && `(${content})`].filter(Boolean).join(' ')
    if (label) lines.push(`Confirmation rule: ${label}`)
  }

  const detail = [lines.join('\n'), readable.body].filter(Boolean).join('\n\n').slice(0, 12000)

  const raw = request.permission_suggestions ?? request.permissionSuggestions
  const suggestions = Array.isArray(raw)
    ? raw.filter((item) => item !== null && typeof item === 'object' && !Array.isArray(item)).slice(0, MAX_SUGGESTIONS)
    : []

  // The CLI says when remembering a decision would be wrong: a safety check
  // that needs a person (e.g. a path bypass), or an allow rule broader than the
  // ask itself. Those prompts offer a single approval and nothing more.
  const noRemember =
    request.suppress_always_allow_rule === true ||
    request.classifier_approvable === false ||
    request.decision_reason_type === 'safetyCheck' ||
    // Instructions, MCP settings and hooks are approved one change at a time, never for the session.
    ['file_path', 'notebook_path', 'path'].some(key => typeof input[key] === 'string' && protectedConfigKind(input[key] as string) !== null) ||
    (typeof input.command === 'string' && commandTouchesProtected(input.command))
  const allowScope = suggestions.length > 0 && !noRemember

  return {
    title,
    detail,
    suggestions: allowScope ? suggestions : [],
    ...(toolUseId ? { toolUseId } : {}),
    decisions: allowScope ? ['accept', 'acceptForSession', 'decline'] : ['accept', 'decline']
  }
}
