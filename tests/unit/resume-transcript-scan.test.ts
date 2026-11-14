// @vitest-environment node
// OXE-157: /resume lists Claude sessions without blocking the main process. The list is read asynchronously, in
// chunks, with partial results after each file, and must end equal to the old scan: a whole-file synchronous read
// of every transcript (the 1.5.1 algorithm, written out below as the reference) plus the first user message.
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ClaudeUsageProvider, forgetTranscripts, readTranscript } from '../../electron/main/services/usage/claudeProvider'
import { listClaudeSessions, readTranscriptAsync } from '../../electron/main/services/usage/claude-transcript-scan'
import { encodeClaudeProjectPath } from '../../electron/main/services/usage/claude-project-path'
import { UsageService } from '../../electron/main/services/usage.service'
import { SessionService } from '../../electron/main/services/session.service'
import type { AppDatabase } from '../../electron/main/db/index'

const ROOT_PATH = '/work/repo-157'
const usage = (input: number, output: number, model = 'claude-sonnet-4-5') =>
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', model, content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: input, cache_creation_input_tokens: 3, cache_read_input_tokens: 90, output_tokens: output } } })
const user = (text: string) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } })
const tool = (size: number) => JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'x'.repeat(size) }] } })
// Mentions "usage" in text but carries no token block: parsed, then skipped (both scans).
const mention = () => JSON.stringify({ type: 'user', message: { role: 'user', content: 'what is "usage" here?' } })

/** The old scan: every line of the whole file parsed, synchronously (1.5.1). */
function oldTally(file: string) {
  let inputTokens = 0, cacheCreationTokens = 0, cacheReadTokens = 0, outputTokens = 0, requestCount = 0
  let modelId: string | null = null, last = [0, 0, 0, 0]
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    let record: { message?: { model?: string; usage?: Record<string, number> } }
    try { record = JSON.parse(line) } catch { continue }
    const u = record.message?.usage
    if (!u) continue
    last = [u.input_tokens ?? 0, u.cache_creation_input_tokens ?? 0, u.cache_read_input_tokens ?? 0, u.output_tokens ?? 0]
    inputTokens += last[0]; cacheCreationTokens += last[1]; cacheReadTokens += last[2]; outputTokens += last[3]; requestCount++
    if (record.message?.model) modelId = record.message.model
  }
  return { inputTokens, cacheCreationTokens, cacheReadTokens, outputTokens, requestCount, modelId,
    lastTurnInputTokens: last[0], lastTurnCacheCreationTokens: last[1], lastTurnCacheReadTokens: last[2], lastTurnOutputTokens: last[3] }
}
function oldPreview(file: string): string | null {
  for (const line of readFileSync(file).subarray(0, 65536).toString('utf8').split('\n')) {
    let entry: { type?: string; message?: { role?: string; content?: unknown } }
    try { entry = JSON.parse(line) } catch { continue }
    if (entry.type === 'system' || entry.message?.role !== 'user') continue
    const content = entry.message.content
    const text = typeof content === 'string' ? content.trim() : Array.isArray(content) && typeof content[0]?.text === 'string' ? content[0].text.trim() : ''
    if (text) return text.length > 80 ? `${text.slice(0, 79)}…` : text
  }
  return null
}

let home = ''
let projects = ''
let dir = ''
const files: string[] = []
const id = (n: number) => `0000000${n}-0000-4000-8000-000000000000`.slice(-36)

function write(n: number, lines: string[], ageS: number, ending = '\n'): string {
  const file = join(dir, `${id(n)}.jsonl`)
  writeFileSync(file, lines.join('\n') + ending)
  const t = Date.now() / 1000 - ageS
  utimesSync(file, t, t)
  files.push(file)
  return file
}

beforeEach(() => {
  forgetTranscripts()
  home = mkdtempSync(join(tmpdir(), 'oxe-157-'))
  projects = join(home, 'projects')
  dir = join(projects, encodeClaudeProjectPath(ROOT_PATH))
  mkdirSync(dir, { recursive: true })
  files.length = 0
  // A big one past several 1 MB chunks, with a multi-byte line across a chunk boundary.
  const big = [JSON.stringify({ type: 'system', content: 'boot' }), user('Review the change, please')]
  for (let i = 0; i < 400; i++) big.push(tool(6_000 + (i % 7)), usage(1000 + i, 400 + i))
  big.push(JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-4-7', content: 'é'.repeat(700_000), usage: { input_tokens: 7, output_tokens: 1 } } }))
  big.push(mention(), usage(1500, 600, 'claude-opus-4-7'))
  write(1, big, 50)
  write(2, [user('x'.repeat(200)), usage(10, 5), tool(500), usage(20, 7)], 40)
  write(3, [user('unterminated last line'), usage(1, 1), usage(2, 2)], 30, '')
  write(4, [JSON.stringify({ type: 'summary', summary: 'no turns' })], 20)
  write(5, [user('é'.repeat(30)), 'not json {', usage(5, 5, 'claude-haiku-4-5-20251001')], 10)
  writeFileSync(join(dir, 'notes.txt'), 'not a session')
})
afterEach(() => { forgetTranscripts(); rmSync(home, { recursive: true, force: true }) })

describe('OXE-157 /resume list off the main thread', () => {
  it('ends with the same list as the old whole-file scan, newest first', async () => {
    const sessions = await listClaudeSessions(dir)
    expect(sessions.map(s => s.sessionId)).toEqual([5, 4, 3, 2, 1].map(id))
    for (const session of sessions) {
      const file = join(dir, `${session.sessionId}.jsonl`)
      expect(session.snapshot).toMatchObject(oldTally(file))
      expect(session.requestCount).toBe(oldTally(file).requestCount)
      expect(session.firstMessagePreview).toBe(oldPreview(file))
    }
    expect(sessions[4].firstMessagePreview).toBe('Review the change, please')
    expect(sessions[1].requestCount).toBe(0)
  })

  it('equals the synchronous list it replaces', async () => {
    const sync = new ClaudeUsageProvider(projects).listSessions(ROOT_PATH)
    forgetTranscripts()
    const scanned = await new ClaudeUsageProvider(projects).listSessionsAsync(ROOT_PATH)
    expect(scanned.map(({ firstMessagePreview: _preview, ...session }) => session)).toEqual(sync)
  })

  it('gives partial results after each file, each a prefix of the final list', async () => {
    const partials: string[][] = []
    const final = await listClaudeSessions(dir, sessions => partials.push(sessions.map(s => s.sessionId)))
    expect(partials).toHaveLength(final.length)
    partials.forEach((partial, index) => expect(partial).toEqual(final.slice(0, index + 1).map(s => s.sessionId)))
  })

  it('lets the event loop run while a transcript is read', async () => {
    let turns = 0
    const tick = setInterval(() => { turns++ }, 0)
    try { await readTranscriptAsync(files[0]) } finally { clearInterval(tick) }
    expect(turns).toBeGreaterThan(0)
  })

  it('shares what it read with the context chip, which then reads only what was appended', async () => {
    await listClaudeSessions(dir)
    appendFileSync(files[0], usage(2000, 700) + '\n')
    const chip = { ...readTranscript(files[0]) }
    expect(chip).toEqual(oldTally(files[0]))
    forgetTranscripts()
    expect(await readTranscriptAsync(files[0])).toEqual(chip)
  })

  it('reads a file once for lists opened together', async () => {
    const [a, b] = await Promise.all([readTranscriptAsync(files[0]), readTranscriptAsync(files[0])])
    expect(a).toBe(b)
    expect(a).toEqual(oldTally(files[0]))
  })

  it('is what SessionService lists for /resume, with fork labels and partial summaries', async () => {
    const db = { prepare: () => ({ all: () => [{ id: 'f', workspace_id: 'ws', parent_session_id: id(1), fork_session_id: id(2), fork_point_message_index: 2, label: 'try', created_at: 1 }] }) } as unknown as AppDatabase
    const service = new SessionService(db, new UsageService([new ClaudeUsageProvider(projects)]), projects)
    const partials: number[] = []
    const list = await service.listSessions('ws', ROOT_PATH, 'claude', partial => partials.push(partial.length))
    expect(partials).toEqual([1, 2, 3, 4, 5])
    expect(list.map(s => s.firstMessagePreview)).toEqual([5, 4, 3, 2, 1].map(n => oldPreview(join(dir, `${id(n)}.jsonl`))))
    expect(list.find(s => s.sessionId === id(2))).toMatchObject({ isFork: true, parentSessionId: id(1), label: 'try', totalTokens: 10 + 5 + 20 + 7 + 2 * 93 })
  })

  it('lists nothing for a project Claude never saw', async () => {
    expect(await listClaudeSessions(join(projects, 'missing'))).toEqual([])
  })
})
