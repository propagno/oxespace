import { randomUUID } from 'node:crypto'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { encodeClaudeProjectPath } from '../usage/claude-project-path'
import { ThreadRewindError } from './thread-rewind'

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_BYTES = 256 * 1024 * 1024

interface Prompt { line: number; text: string }

function promptText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(part => part && typeof part === 'object' && (part as { type?: unknown }).type === 'text' && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : '').join('')
}

/** User entries a person typed. Tool results, meta lines, sidechains and compaction summaries are not prompts. */
export function claudePrompts(lines: string[]): Prompt[] {
  const prompts: Prompt[] = []
  lines.forEach((raw, line) => {
    let entry: Record<string, unknown>
    try { entry = JSON.parse(raw) as Record<string, unknown> } catch { throw new ThreadRewindError('proof-mismatch', 'The Claude transcript contains an unreadable line, so it was not changed.') }
    if (entry.type !== 'user' || entry.toolUseResult !== undefined || entry.isMeta === true || entry.isSidechain === true || entry.isCompactSummary === true) return
    const message = entry.message && typeof entry.message === 'object' ? entry.message as { role?: unknown; content?: unknown } : undefined
    if (message?.role !== 'user') return
    const text = promptText(message.content).trim()
    if (text) prompts.push({ line, text })
  })
  return prompts
}

/**
 * The transcript lines to keep so the session resumes just before the target
 * turn. `localPrompts` are the user messages of this conversation's turns, in
 * order; the transcript may hold older prompts from before they began, so the
 * two lists are aligned from the end and the target must match exactly.
 */
export function planClaudeFork(transcript: string, localPrompts: string[], targetIndex: number): { keep: string[]; removedPrompts: number } {
  const lines = transcript.split('\n').filter(line => line.length > 0)
  const prompts = claudePrompts(lines)
  const offset = prompts.length - localPrompts.length
  if (offset < 0 || targetIndex < 0 || targetIndex >= localPrompts.length) throw new ThreadRewindError('proof-mismatch', 'The Claude transcript has fewer prompts than this conversation. Nothing was changed.')
  const same = (index: number): boolean => prompts[offset + index].text === localPrompts[index].trim()
  if (!same(targetIndex)) throw new ThreadRewindError('proof-mismatch', 'The Claude transcript does not hold this message at that position. Nothing was changed.')
  // A shifted alignment shows up as a mismatch on any neighbouring plain prompt.
  for (let index = 0; index < localPrompts.length; index++) {
    if (!localPrompts[index].trim().startsWith('/') && !same(index)) throw new ThreadRewindError('proof-mismatch', 'The Claude transcript and this conversation have diverged. Nothing was changed.')
  }
  let cut = prompts[offset + targetIndex].line
  // Queue bookkeeping written just before the removed prompt belongs to it.
  while (cut > 0 && /"type"\s*:\s*"queue-operation"/.test(lines[cut - 1])) cut--
  return { keep: lines.slice(0, cut), removedPrompts: localPrompts.length - targetIndex }
}

export function claudeTranscriptPath(rootPath: string, sessionId: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!SESSION_ID.test(sessionId)) throw new ThreadRewindError('unavailable', 'The Claude session id is not valid.')
  const home = env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude')
  return join(home, 'projects', encodeClaudeProjectPath(rootPath), `${sessionId}.jsonl`)
}

/**
 * Writes a new session holding the conversation before the target turn and
 * returns its id. The original transcript is never modified, so the rewind can
 * be undone by resuming it.
 */
export async function forkClaudeBefore(input: { rootPath: string; sessionId: string; localPrompts: string[]; targetIndex: number; env?: NodeJS.ProcessEnv }): Promise<{ sessionId: string }> {
  const source = claudeTranscriptPath(input.rootPath, input.sessionId, input.env)
  let transcript: string
  try { transcript = await readFile(source, 'utf8') } catch { throw new ThreadRewindError('unavailable', 'The Claude transcript for this session was not found.') }
  if (transcript.length > MAX_BYTES) throw new ThreadRewindError('history-limit', 'The Claude transcript is too large to rewind safely.')
  const { keep } = planClaudeFork(transcript, input.localPrompts, input.targetIndex)
  if (!keep.length) throw new ThreadRewindError('unavailable', 'Rewinding to the very first message needs a new conversation instead.')
  const sessionId = randomUUID()
  await writeFile(claudeTranscriptPath(input.rootPath, sessionId, input.env), keep.join('\n') + '\n', { encoding: 'utf8', flag: 'wx' })
  return { sessionId }
}

/**
 * Removes a side chat's copy (B1.2): only the `<forkId>.jsonl` file of that UUID, never one of the ids in `keep`
 * (the main conversation's session). A copy that was never written is not an error.
 */
export async function removeClaudeSessionCopy(input: { rootPath: string; forkId: string; keep: readonly (string | null | undefined)[]; env?: NodeJS.ProcessEnv }): Promise<boolean> {
  if (!SESSION_ID.test(input.forkId) || input.keep.some(id => id && id.toLowerCase() === input.forkId.toLowerCase())) return false
  try { await unlink(claudeTranscriptPath(input.rootPath, input.forkId, input.env)); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}
