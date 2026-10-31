import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { SessionSearchIndex, SessionSearchService, discoverTranscripts } from '../../electron/main/services/session-search'
import { buildMatchLadder, parseSessionQuery } from '../../electron/main/services/session-search/query'
import { parseTranscriptLine } from '../../electron/main/services/session-search/transcript'

const CLAUDE_ID = '11111111-1111-4111-8111-111111111111'
const CODEX_ID = '22222222-2222-4222-8222-222222222222'

const claudeLine = (role: 'user' | 'assistant', text: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ type: role, sessionId: CLAUDE_ID, cwd: 'C:\\work\\alpha', timestamp: '2026-10-01T10:00:00Z', message: { role, content: [{ type: 'text', text }] }, ...extra }) + '\n'

const codexMeta = (): string =>
  JSON.stringify({ type: 'session_meta', payload: { id: CODEX_ID, cwd: 'C:\\work\\beta', timestamp: '2026-10-02T10:00:00Z' } }) + '\n'
const codexMessage = (role: 'user' | 'assistant', text: string): string =>
  JSON.stringify({
    type: 'response_item', timestamp: '2026-10-02T10:01:00Z',
    payload: { type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] }
  }) + '\n'

describe('transcript parsing', () => {
  test('keeps conversation text and drops tool and injected content', () => {
    expect(parseTranscriptLine('claude', claudeLine('user', 'fix the flaky test'))?.message).toMatchObject({ role: 'user', text: 'fix the flaky test' })
    const toolResult = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'huge output' }] } })
    expect(parseTranscriptLine('claude', toolResult)?.message).toBeNull()
    expect(parseTranscriptLine('claude', claudeLine('user', 'x', { isMeta: true }))?.message).toBeNull()
    expect(parseTranscriptLine('claude', claudeLine('user', '<command-name>/clear</command-name>'))?.message).toBeNull()
    expect(parseTranscriptLine('codex', codexMessage('user', '<environment_context>cwd</environment_context>'))?.message).toBeNull()
    expect(parseTranscriptLine('codex', codexMessage('assistant', 'done'))?.message).toMatchObject({ role: 'assistant', text: 'done' })
    expect(parseTranscriptLine('codex', codexMeta())).toMatchObject({ sessionId: CODEX_ID, cwd: 'C:\\work\\beta' })
    expect(parseTranscriptLine('claude', '{torn')).toBeNull()
  })
})

describe('query building', () => {
  test('lifts operators, drops stop words and quotes every term', () => {
    const q = parseSessionQuery('repo:alpha "worktree cleanup" the NEAR* AND ("x")')
    expect(q.scopes).toEqual(['alpha'])
    expect(q.terms).toContain('worktree')
    expect(q.terms).not.toContain('the')
    const ladder = buildMatchLadder(['worktree', 'cleanup'])
    expect(ladder.map((l) => l.mode)).toEqual(['phrase', 'all', 'any'])
    expect(ladder[0].match).toBe('"worktree cleanup"')
    expect(ladder[1].match).toBe('"worktree" AND "cleanup"*')
  })
})

describe('SessionSearchIndex', () => {
  let home: string
  let claudeRoot: string
  let codexRoot: string
  let index: SessionSearchIndex
  let claudeFile: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'oxe-search-'))
    claudeRoot = join(home, 'claude', 'projects')
    codexRoot = join(home, 'codex', 'sessions')
    mkdirSync(join(claudeRoot, 'C--work-alpha', 'subagents'), { recursive: true })
    mkdirSync(join(codexRoot, '2026', '10', '02'), { recursive: true })

    claudeFile = join(claudeRoot, 'C--work-alpha', `${CLAUDE_ID}.jsonl`)
    writeFileSync(claudeFile, claudeLine('user', 'please refactor the worktree cleanup scanner') + claudeLine('assistant', 'Refactored scanner into smaller modules'))
    writeFileSync(
      join(claudeRoot, 'C--work-alpha', 'subagents', 'sub.jsonl'),
      claudeLine('user', 'subagent secret zebra phrase')
    )
    writeFileSync(
      join(codexRoot, '2026', '10', '02', `rollout-2026-10-02T10-00-00-${CODEX_ID}.jsonl`),
      codexMeta() + codexMessage('user', 'investigate the websocket reconnect bug') + codexMessage('assistant', 'The reconnect loop never resets its backoff')
    )
    index = new SessionSearchIndex(':memory:', () => discoverTranscripts(claudeRoot, codexRoot))
  })

  afterEach(() => {
    index.close()
    try { rmSync(home, { recursive: true, force: true }) } catch { /* temp */ }
  })

  test('indexes both agents and finds sessions by content with resume commands', () => {
    expect(index.refresh()).toBe(true)
    expect(index.indexedSessions).toBe(2)

    const claude = index.search({ query: 'worktree cleanup' })
    expect(claude.mode).toBe('phrase')
    expect(claude.hits[0]).toMatchObject({ agent: 'claude', sessionId: CLAUDE_ID, resumeCommand: `claude --resume ${CLAUDE_ID}` })
    expect(claude.hits[0].snippet).toMatch(/\[/)

    const codex = index.search({ query: 'backoff reconnect' })
    expect(codex.hits[0]).toMatchObject({ agent: 'codex', sessionId: CODEX_ID, resumeCommand: `codex resume ${CODEX_ID}`, role: 'assistant' })
  })

  test('never indexes subagent transcripts', () => {
    index.refresh()
    expect(index.search({ query: 'zebra' }).hits).toHaveLength(0)
  })

  test('falls back from phrase to all-terms to any-term', () => {
    index.refresh()
    expect(index.search({ query: 'scanner worktree' }).mode).toBe('all')
    const any = index.search({ query: 'scanner kubernetes' })
    expect(any.mode).toBe('any')
    expect(any.hits[0].sessionId).toBe(CLAUDE_ID)
  })

  test('scopes by cwd, agent and repo: operator', () => {
    index.refresh()
    expect(index.search({ query: 'reconnect', cwd: 'C:\\work\\alpha' }).hits).toHaveLength(0)
    expect(index.search({ query: 'reconnect', cwd: 'C:\\work\\beta' }).hits).toHaveLength(1)
    expect(index.search({ query: 'scanner', agent: 'codex' }).hits).toHaveLength(0)
    expect(index.search({ query: 'repo:beta reconnect' }).hits).toHaveLength(1)
    expect(index.search({ query: 'repo:alpha reconnect' }).hits).toHaveLength(0)
  })

  test('is incremental: appended lines are found, existing ones are not duplicated', () => {
    index.refresh()
    appendFileSync(claudeFile, claudeLine('user', 'now add telemetry for the quasar module'))
    index.refresh()
    expect(index.search({ query: 'quasar' }).hits).toHaveLength(1)
    expect(index.search({ query: 'worktree cleanup' }).hits).toHaveLength(1)
    expect(index.search({ query: 'quasar' }).hits[0].messageCount).toBe(3)
  })

  test('does not index a torn trailing line until it is complete', () => {
    index.refresh()
    const partial = claudeLine('user', 'unfinished thought about nebula').slice(0, -10)
    appendFileSync(claudeFile, partial)
    index.refresh()
    expect(index.search({ query: 'nebula' }).hits).toHaveLength(0)
    appendFileSync(claudeFile, claudeLine('user', 'unfinished thought about nebula').slice(-10))
    index.refresh()
    expect(index.search({ query: 'nebula' }).hits).toHaveLength(1)
  })

  test('rebuilds a file that was rewritten shorter', () => {
    index.refresh()
    writeFileSync(claudeFile, claudeLine('user', 'brand new conversation about pelican'))
    index.refresh()
    expect(index.search({ query: 'pelican' }).hits).toHaveLength(1)
    expect(index.search({ query: 'worktree cleanup' }).hits).toHaveLength(0)
  })

  test('drops sessions whose transcript disappeared', () => {
    index.refresh()
    rmSync(claudeFile)
    index.refresh()
    expect(index.indexedSessions).toBe(1)
    expect(index.search({ query: 'worktree cleanup' }).hits).toHaveLength(0)
  })

  test('hostile query text cannot break the match expression', () => {
    index.refresh()
    for (const q of ['"', 'NEAR(', 'a AND', '*', '-- DROP', 'x:y', ')(']) {
      expect(() => index.search({ query: q })).not.toThrow()
    }
    expect(index.search({ query: '' }).hits).toEqual([])
  })

  test('the service indexes in the background and reports progress', async () => {
    const service = new SessionSearchService(index, { sliceMs: 50, minIntervalMs: 0 })
    const first = service.search({ query: 'worktree' })
    expect(first.indexing).toBe(true)
    for (let i = 0; i < 100 && index.indexedSessions < 2; i += 1) await new Promise((r) => setTimeout(r, 20))
    expect(service.search({ query: 'worktree' }).hits.length).toBeGreaterThan(0)
  })
})
