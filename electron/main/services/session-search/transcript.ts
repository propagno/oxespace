/**
 * Line-level readers for the two native transcript formats. They return only
 * human conversation text: tool inputs/outputs and injected context are not
 * what a person remembers a session by, and they dominate transcript size.
 */
import type { SessionSearchAgent } from '../../../../shared/types/session-search'

export interface TranscriptMessage {
  role: 'user' | 'assistant'
  text: string
  /** ms epoch, when the line carried a timestamp. */
  at: number | null
}

export interface TranscriptLine {
  sessionId: string | null
  cwd: string | null
  message: TranscriptMessage | null
}

const MAX_MESSAGE_CHARS = 20_000

function clip(text: string): string {
  return text.length > MAX_MESSAGE_CHARS ? text.slice(0, MAX_MESSAGE_CHARS) : text
}

function parseTime(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

function textBlocks(content: unknown, wanted: ReadonlySet<string>): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (typeof block === 'string') parts.push(block)
    else if (block && typeof block === 'object') {
      const { type, text } = block as { type?: unknown; text?: unknown }
      if (typeof text === 'string' && typeof type === 'string' && wanted.has(type)) parts.push(text)
    }
  }
  return parts.join('\n').trim()
}

const CLAUDE_TEXT = new Set(['text'])
const CODEX_TEXT = new Set(['input_text', 'output_text', 'text'])
// Prompts Codex injects on the user's behalf; they are not the user's words.
const CODEX_INJECTED = /^\s*(<environment_context>|<user_instructions>|# AGENTS\.md instructions|<permissions)/

function parseClaude(record: Record<string, unknown>): TranscriptLine {
  const sessionId = typeof record.sessionId === 'string' ? record.sessionId : null
  const cwd = typeof record.cwd === 'string' ? record.cwd : null
  const base: TranscriptLine = { sessionId, cwd, message: null }
  if (record.type !== 'user' && record.type !== 'assistant') return base
  if (record.isMeta === true || record.isSidechain === true) return base
  const message = record.message as { role?: unknown; content?: unknown } | undefined
  const role = record.type
  const text = textBlocks(message?.content, CLAUDE_TEXT)
  // Slash-command plumbing is logged as user turns; it is noise in search.
  if (!text || /^<(command-name|local-command|command-message)/.test(text)) return base
  return { ...base, message: { role, text: clip(text), at: parseTime(record.timestamp) } }
}

function parseCodex(record: Record<string, unknown>): TranscriptLine {
  const payload = (record.payload ?? {}) as Record<string, unknown>
  if (record.type === 'session_meta') {
    return {
      sessionId: typeof payload.id === 'string' ? payload.id : null,
      cwd: typeof payload.cwd === 'string' ? payload.cwd : null,
      message: null
    }
  }
  const base: TranscriptLine = { sessionId: null, cwd: null, message: null }
  if (record.type !== 'response_item' || payload.type !== 'message') return base
  const role = payload.role
  if (role !== 'user' && role !== 'assistant') return base
  const text = textBlocks(payload.content, CODEX_TEXT)
  if (!text || (role === 'user' && CODEX_INJECTED.test(text))) return base
  return { ...base, message: { role, text: clip(text), at: parseTime(record.timestamp) } }
}

/** Returns null for a line that is not JSON (e.g. a torn trailing write). */
export function parseTranscriptLine(agent: SessionSearchAgent, line: string): TranscriptLine | null {
  if (!line.trim()) return null
  let record: unknown
  try {
    record = JSON.parse(line)
  } catch {
    return null
  }
  if (!record || typeof record !== 'object') return null
  return agent === 'claude' ? parseClaude(record as Record<string, unknown>) : parseCodex(record as Record<string, unknown>)
}
