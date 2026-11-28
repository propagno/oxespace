/**
 * Bounded, secret-redacted main-process resolvers for OxeChat composer context sources (OXE-478):
 * `@changes` (Git working-tree status + diff), `@terminal` (ScreenMirror / terminal snapshot),
 * and `@thread:<id>` (concise summary of another conversation).
 *
 * Keeps zero direct `node:fs` imports so filesystem access remains centralized in allowlisted modules.
 */
import type { AppDatabase } from '../../db'
import type { ConversationThread, ThreadEvent } from '../../../../shared/types/thread'
import type { ThreadPane } from '../../../../shared/types/thread-places'
import { threadAgentName } from '../../../../shared/threadProviders'
import { execGit } from '../../utils/safe-git'
import { stripAnsi } from '../../utils/strip-ansi'
import { maskLogLine } from '../oxequery/agent-output'
import { readTerminalScreenSnapshot, type ThreadSideTerminalHost } from './side-chat-context'

export const MAX_CHANGES_BYTES = 16 * 1024
export const MAX_TERMINAL_BYTES = 8 * 1024
export const MAX_THREAD_REF_BYTES = 8 * 1024

const GIT_LIMITS = { maxBuffer: 2 * 1024 * 1024, timeout: 10_000 }
const MAX_THREAD_TURNS = 10
const MAX_THREAD_TURN_CHARS = 700
const MAX_THREAD_FILES = 16
const MAX_SHELL_SLOTS = 8

export interface ResolvedContextPart {
  /** Context label recorded on the user message event (`@changes`, `@terminal`, `@thread:...`). */
  label: string
  /** XML block to attach to the outgoing prompt. */
  block: string
  bytes: number
  truncated?: boolean
}

const escapeAttr = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

function sanitizeOutput(raw: string): string {
  return stripAnsi(raw)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(maskLogLine)
    .join('\n')
    .trimEnd()
}

function clipUtf8(text: string, maxBytes: number): { text: string; bytes: number; truncated: boolean } {
  const fullBytes = Buffer.byteLength(text, 'utf8')
  if (fullBytes <= maxBytes) return { text, bytes: fullBytes, truncated: false }
  const buf = Buffer.from(text, 'utf8').subarray(0, Math.max(0, maxBytes))
  // Drop any incomplete trailing multi-byte UTF-8 sequence cleanly.
  const sliced = buf.toString('utf8').replace(/\uFFFD+$/, '')
  return { text: sliced, bytes: Buffer.byteLength(sliced, 'utf8'), truncated: true }
}

function clipTailUtf8(text: string, maxBytes: number): { text: string; bytes: number; truncated: boolean } {
  const fullBytes = Buffer.byteLength(text, 'utf8')
  if (fullBytes <= maxBytes) return { text, bytes: fullBytes, truncated: false }
  const buf = Buffer.from(text, 'utf8')
  const tail = buf.subarray(Math.max(0, buf.length - maxBytes)).toString('utf8').replace(/^\uFFFD+/, '')
  return { text: tail, bytes: Buffer.byteLength(tail, 'utf8'), truncated: true }
}

/**
 * Resolves `@changes` for the thread's checkout/worktree using safe Git commands.
 * Always bounded so giant diffs never blow up the prompt context.
 */
export async function resolveGitChangesContext(
  rootPath: string,
  maxBytes = MAX_CHANGES_BYTES
): Promise<ResolvedContextPart | null> {
  const run = async (args: string[]): Promise<string> => (await execGit(rootPath, args, GIT_LIMITS)).stdout
  let status: string
  try {
    status = sanitizeOutput(await run(['status', '--porcelain=v1', '-uall']))
  } catch {
    return null
  }

  let hasHead = true
  try {
    await run(['rev-parse', '--verify', '-q', 'HEAD'])
  } catch {
    hasHead = false
  }

  let baseRef = 'HEAD'
  if (!hasHead) {
    try {
      baseRef = (await run(['hash-object', '-t', 'tree', '--stdin'])).trim()
    } catch {
      baseRef = ''
    }
  }

  let statSummary = ''
  let diffBody = ''
  if (baseRef) {
    statSummary = sanitizeOutput(
      await run(['--no-pager', 'diff', '--stat', '--no-ext-diff', '--no-textconv', baseRef, '--']).catch(() => '')
    )
    diffBody = sanitizeOutput(
      await run(['--no-pager', 'diff', '--no-ext-diff', '--no-textconv', '--unified=2', baseRef, '--']).catch(() => '')
    )
  }

  const sections: string[] = []
  if (status) sections.push(`Git status:\n${status}`)
  if (statSummary) sections.push(`Diff summary (${hasHead ? 'vs HEAD' : 'unborn branch'}):\n${statSummary}`)
  if (diffBody) sections.push(`Diff excerpt:\n${diffBody}`)

  const rawBody = sections.length > 0 ? sections.join('\n\n') : '(working tree is clean — no uncommitted changes)'
  const clipped = clipUtf8(rawBody, maxBytes)
  const body = clipped.truncated
    ? `${clipped.text}\n[diff truncated at ${clipped.bytes} bytes; inspect remaining files with git tools]`
    : clipped.text

  return {
    label: '@changes',
    bytes: clipped.bytes,
    ...(clipped.truncated ? { truncated: true } : {}),
    block: `<attached_changes base="${escapeAttr(hasHead ? 'HEAD' : 'unborn')}"${clipped.truncated ? ' truncated="true"' : ''}>\n${body}\n</attached_changes>`
  }
}

export interface ResolveTerminalContextInput {
  threadId?: string
  paneId?: string
  terminal?: ThreadSideTerminalHost
  listThreadPanes?: () => Promise<ThreadPane[]>
  isAllowedPane?: (paneId: string) => boolean
  maxBytes?: number
}

/**
 * Resolves `@terminal` or `@terminal:<paneId>` using OXE-445 ScreenMirror (`PaneScreen`)
 * and read-only terminal ring snapshots. Never writes to the PTY.
 */
export async function resolveTerminalContext(input: ResolveTerminalContextInput): Promise<ResolvedContextPart | null> {
  const { threadId, paneId, terminal, listThreadPanes, isAllowedPane, maxBytes = MAX_TERMINAL_BYTES } = input
  if (!terminal) return null

  const candidates: Array<{ paneId: string; title?: string }> = []
  const seen = new Set<string>()
  const pushCandidate = (id: string, title?: string): void => {
    if (!id || seen.has(id)) return
    seen.add(id)
    candidates.push({ paneId: id, title })
  }

  const threadPanes = listThreadPanes ? await listThreadPanes().catch(() => [] as ThreadPane[]) : []
  const threadPaneById = new Map(threadPanes.map(pane => [pane.paneId, pane]))

  if (paneId) {
    const isThreadShell = Boolean(threadId && new RegExp(`^thread-shell:${threadId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:[1-8]$`).test(paneId))
    const allowed = isThreadShell || threadPaneById.has(paneId) || Boolean(isAllowedPane?.(paneId))
    if (!allowed) return null
    pushCandidate(paneId, threadPaneById.get(paneId)?.title)
  } else {
    if (threadId) {
      for (let slot = 1; slot <= MAX_SHELL_SLOTS; slot += 1) {
        const shellId = `thread-shell:${threadId}:${slot}`
        if (terminal.peek(shellId) || terminal.readScreen?.(shellId)?.screen?.trim()) {
          pushCandidate(shellId, `Terminal ${slot}`)
        }
      }
    }
    for (const pane of threadPanes) {
      pushCandidate(pane.paneId, pane.title)
    }
  }

  let chosen: { paneId: string; title?: string; screenText: string; altScreen: boolean; truncated: boolean } | null = null
  for (const candidate of candidates) {
    const snap = await readTerminalScreenSnapshot(candidate.paneId, terminal).catch(() => null)
    if (!snap) continue
    if (snap.screenText.trim() || !chosen) {
      chosen = { ...candidate, ...snap }
      if (snap.screenText.trim()) break
    }
  }

  if (!chosen) return null

  const clipped = clipTailUtf8(chosen.screenText || '(no terminal output captured yet)', maxBytes)
  const truncated = chosen.truncated || clipped.truncated
  const prefix = truncated && chosen.screenText ? '[earlier output omitted]\n' : ''
  const cwd = terminal.shellCwd?.(chosen.paneId) ?? terminal.status?.(chosen.paneId)?.launchDirectory ?? null
  const label = chosen.title ? `@terminal (${chosen.title})` : '@terminal'

  return {
    label,
    bytes: clipped.bytes,
    ...(truncated ? { truncated: true } : {}),
    block: `<attached_terminal pane="${escapeAttr(chosen.title || chosen.paneId)}" mode="${chosen.altScreen ? 'screen' : 'buffer'}"${cwd ? ` cwd="${escapeAttr(cwd)}"` : ''}${truncated ? ' truncated="true"' : ''}>\n${prefix}${clipped.text}\n</attached_terminal>`
  }
}

export interface ResolveThreadRefInput {
  db?: AppDatabase
  targetThreadId: string
  maxBytes?: number
}

function collectTouchedFiles(events: readonly ThreadEvent[]): string[] {
  const seen = new Set<string>()
  for (let index = events.length - 1; index >= 0 && seen.size < MAX_THREAD_FILES; index -= 1) {
    const event = events[index]
    const files = event.type === 'tool' || event.type === 'turn-diff' ? event.files : undefined
    if (!files?.length) continue
    for (const file of files) {
      if (file.path && !seen.has(file.path)) seen.add(file.path)
      if (seen.size >= MAX_THREAD_FILES) break
    }
  }
  return [...seen].reverse()
}

/**
 * Resolves `@thread:<id>` into a concise, bounded, secret-redacted reference summary of another conversation.
 */
export function resolveThreadReferenceContext(input: ResolveThreadRefInput): ResolvedContextPart | null {
  const { db, targetThreadId, maxBytes = MAX_THREAD_REF_BYTES } = input
  if (!db || !targetThreadId) return null

  let thread: ConversationThread
  let events: ThreadEvent[]
  try {
    const row = db
      .prepare('SELECT data_json, events_json, history_version FROM conversation_threads WHERE id = ?')
      .get(targetThreadId) as { data_json: string; events_json: string; history_version: number } | undefined
    if (!row) return null
    thread = JSON.parse(row.data_json) as ConversationThread
    events = row.history_version
      ? (db.prepare('SELECT data_json FROM conversation_events WHERE thread_id = ? ORDER BY seq DESC LIMIT 60').all(targetThreadId) as { data_json: string }[])
          .reverse()
          .map(entry => JSON.parse(entry.data_json) as ThreadEvent)
      : (JSON.parse(row.events_json) as ThreadEvent[]).slice(-60)
  } catch {
    return null
  }

  const title = sanitizeOutput(thread.title || targetThreadId).slice(0, 160)
  const touched = collectTouchedFiles(events)
  const messages: string[] = []
  for (const event of events) {
    if (event.type !== 'message') continue
    const clean = sanitizeOutput(event.text).trim()
    if (!clean) continue
    const role = event.role === 'user' ? 'User' : 'Assistant'
    const excerpt = clean.length > MAX_THREAD_TURN_CHARS ? `${clean.slice(0, MAX_THREAD_TURN_CHARS - 12).trimEnd()}\n[truncated]` : clean
    messages.push(`${role}: ${excerpt}`)
  }
  const recent = messages.slice(-MAX_THREAD_TURNS)

  const headerLines = [
    `Title: ${title}`,
    `Provider: ${threadAgentName(thread.provider)}`,
    ...(thread.ownedWorktree?.branch ? [`Branch: ${sanitizeOutput(thread.ownedWorktree.branch).slice(0, 120)}`] : []),
    ...(touched.length ? [`Touched files: ${touched.join(', ')}`] : [])
  ]
  const bodyRaw = `${headerLines.join('\n')}\n\n${recent.length ? `Recent messages:\n${recent.join('\n\n')}` : '(no messages yet)'}`
  const clipped = clipUtf8(bodyRaw, maxBytes)
  const body = clipped.truncated ? `${clipped.text}\n[truncated]` : clipped.text

  return {
    label: `@thread:${title}`,
    bytes: clipped.bytes,
    ...(clipped.truncated ? { truncated: true } : {}),
    block: `<attached_thread id="${escapeAttr(thread.id)}" title="${escapeAttr(title)}" provider="${escapeAttr(thread.provider)}"${clipped.truncated ? ' truncated="true"' : ''}>\n${body}\n</attached_thread>`
  }
}
