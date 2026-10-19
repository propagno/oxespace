/**
 * Reading a saved Thread event as a row of the debug inspector, and the filter that narrows rows.
 *
 * The filter syntax and its time bounds follow VS Code's chat debug view (microsoft/vscode, MIT
 * licence, Copyright (c) Microsoft Corporation): `chat/common/chatDebugEvents.ts`.
 * Comma-separated terms match any part of a row, `!term` excludes, and `before:2026-10` /
 * `after:2026-10-14t09:30` bound the time.
 */
import type { ThreadEvent } from './types/thread'

export interface ThreadEventSummary {
  /** What the row is about: a tool name, a message role, a phase. */
  label: string
  state?: string
  durationMs?: number
  exitCode?: number
  /** Text a filter term is looked for in, in addition to the type, label and state. */
  text: string
}

const MAX_LABEL = 160

function clip(value: string, max = MAX_LABEL): string {
  const single = value.replace(/\s+/g, ' ').trim()
  return single.length > max ? `${single.slice(0, max - 1)}…` : single
}

function span(startedAt?: number, completedAt?: number): number | undefined {
  return typeof startedAt === 'number' && typeof completedAt === 'number' && completedAt >= startedAt ? completedAt - startedAt : undefined
}

export function summarizeThreadEvent(event: ThreadEvent): ThreadEventSummary {
  switch (event.type) {
    case 'message': return { label: `${event.role}: ${clip(event.text)}`, text: event.text }
    case 'delta': return { label: clip(event.text), text: event.text }
    case 'tool': return { label: `${event.name} ${clip(event.detail, 100)}`.trim(), state: event.state, durationMs: span(event.startedAt, event.completedAt), exitCode: event.exitCode, text: `${event.name}\n${event.detail}\n${event.output ?? ''}` }
    case 'subagent': return { label: `${event.action}${event.model ? ` · ${event.model}` : ''}`, state: event.state, durationMs: span(event.startedAt, event.completedAt), text: `${event.action}\n${event.prompt ?? ''}\n${event.agents.map((agent) => JSON.stringify(agent)).join('\n')}` }
    case 'reasoning': return { label: clip(event.text), durationMs: span(event.startedAt, event.completedAt), text: event.text }
    case 'activity': return { label: event.summary ? `${event.phase}: ${clip(event.summary)}` : event.phase, text: event.summary ?? '' }
    case 'approval': return { label: event.title, text: `${event.title}\n${event.detail}` }
    case 'approval-resolved': return { label: event.id, text: '' }
    case 'request': return { label: `${event.request.kind}: ${clip(event.request.title)}`, state: event.request.state, text: `${event.request.title}\n${event.request.command ?? ''}\n${event.request.detail ?? ''}\n${event.request.reason ?? ''}` }
    case 'request-resolved': return { label: event.id, state: event.state, text: event.resolution ?? '' }
    case 'queue': return { label: clip(event.item.text ?? ''), text: event.item.text ?? '' }
    case 'turn-cost': return { label: [event.usd !== undefined ? `$${event.usd.toFixed(4)}` : '', event.inputTokens !== undefined ? `${event.inputTokens} in` : '', event.outputTokens !== undefined ? `${event.outputTokens} out` : '', event.cacheReadTokens ? `${event.cacheReadTokens} cached` : ''].filter(Boolean).join(' · '), text: '' }
    case 'context-usage': return { label: 'context report', text: '' }
    case 'completed': return { label: event.error ? clip(event.error) : event.status, state: event.status, text: `${event.error ?? ''}\n${event.errorCode ?? ''}` }
    case 'failure-details': return { label: 'failure details', text: '' }
    case 'session': return { label: event.nativeSessionId, text: event.nativeSessionId }
    case 'turn-accepted': return { label: event.nativeTurnId, text: event.nativeTurnId }
    case 'turn-diff': return { label: `${event.files.length} file${event.files.length === 1 ? '' : 's'}`, text: event.files.map((file) => file.path).join('\n') }
    case 'plan': return { label: clip(event.explanation ?? `${event.steps.length} steps`), text: `${event.explanation ?? ''}\n${event.steps.map((step) => step.label).join('\n')}` }
    case 'cli-command': return { label: clip(event.command), text: event.command }
    case 'configuration': return { label: [event.model, event.reasoningEffort, event.access].filter(Boolean).join(' · ') || 'configuration', text: '' }
    default: return { label: '', text: '' }
  }
}

export interface DebugFilterRow {
  createdAt: number
  /** Already lower-cased: type, label, state and text. */
  search: string
}

const TIME_TOKEN = /\b(?:before|after):\d{4}(?:-\d{2}(?:-\d{2}(?:t\d{1,2}(?::\d{2}(?::\d{2})?)?)?)?)?(?!\w)/gi

/**
 * `before:` rounds up to the end of the unit given (`before:2026-03` is the end of March);
 * `after:` is the start of it. Null when the token is absent.
 */
export function parseDebugTimeToken(text: string, prefix: 'before' | 'after'): number | null {
  const m = new RegExp(`${prefix}:(\\d{4})(?:-(\\d{2})(?:-(\\d{2})(?:t(\\d{1,2})(?::(\\d{2})(?::(\\d{2}))?)?)?)?)?(?!\\w)`, 'i').exec(text)
  if (!m) return null
  const [year, month, day, hour, minute, second] = [m[1], m[2], m[3], m[4], m[5], m[6]].map((part) => (part === undefined ? undefined : parseInt(part, 10)))
  if (prefix === 'after') return new Date(year!, month === undefined ? 0 : month - 1, day ?? 1, hour ?? 0, minute ?? 0, second ?? 0, 0).getTime()
  if (second !== undefined) return new Date(year!, month! - 1, day!, hour!, minute!, second, 999).getTime()
  if (minute !== undefined) return new Date(year!, month! - 1, day!, hour!, minute, 59, 999).getTime()
  if (hour !== undefined) return new Date(year!, month! - 1, day!, hour, 59, 59, 999).getTime()
  if (day !== undefined) return new Date(year!, month! - 1, day, 23, 59, 59, 999).getTime()
  if (month !== undefined) return new Date(year!, month, 0, 23, 59, 59, 999).getTime()
  return new Date(year!, 11, 31, 23, 59, 59, 999).getTime()
}

/** A predicate for the filter text; an empty filter keeps every row. */
export function compileDebugFilter(filter: string): (row: DebugFilterRow) => boolean {
  const before = parseDebugTimeToken(filter, 'before')
  const after = parseDebugTimeToken(filter, 'after')
  const terms = filter.replace(TIME_TOKEN, '').split(',').map((term) => term.trim().toLowerCase()).filter(Boolean)
  const include = terms.filter((term) => !term.startsWith('!'))
  const exclude = terms.filter((term) => term.startsWith('!')).map((term) => term.slice(1).trim()).filter(Boolean)
  return (row) => {
    if (before !== null && row.createdAt > before) return false
    if (after !== null && row.createdAt < after) return false
    if (exclude.some((term) => row.search.includes(term))) return false
    return include.length === 0 || include.some((term) => row.search.includes(term))
  }
}
