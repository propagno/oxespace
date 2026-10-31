import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { claudeTranscriptPath, forkClaudeBefore, planClaudeFork } from '../electron/main/services/conversation/claude-transcript-fork'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

const prompt = (text: string, extra: Record<string, unknown> = {}) => JSON.stringify({ type: 'user', uuid: `u-${text}`, message: { role: 'user', content: text }, ...extra })
const toolResult = JSON.stringify({ type: 'user', uuid: 'tool', toolUseResult: { ok: true }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'x' }] } })
const assistant = (text: string) => JSON.stringify({ type: 'assistant', uuid: `a-${text}`, message: { role: 'assistant', content: [{ type: 'text', text }] } })
const queue = JSON.stringify({ type: 'queue-operation', operation: 'enqueue' })
const transcript = (lines: string[]) => lines.join('\n') + '\n'

describe('Claude transcript fork', () => {
  const lines = [queue, prompt('first'), assistant('one'), toolResult, queue, queue, prompt('second'), assistant('two'), prompt('third')]

  it('keeps everything before the target prompt and drops its queue bookkeeping', () => {
    const plan = planClaudeFork(transcript(lines), ['first', 'second', 'third'], 1)
    expect(plan.keep).toEqual(lines.slice(0, 4))
    expect(plan.removedPrompts).toBe(2)
  })

  it('aligns from the end when the transcript holds older prompts than this conversation', () => {
    const older = [prompt('imported before'), assistant('old'), ...lines]
    const plan = planClaudeFork(transcript(older), ['first', 'second', 'third'], 2)
    expect(plan.keep.at(-1)).toBe(assistant('two'))
  })

  it('refuses when the transcript and the conversation have diverged', () => {
    expect(() => planClaudeFork(transcript(lines), ['first', 'different', 'third'], 2)).toThrow(/diverged/)
    expect(() => planClaudeFork(transcript(lines), ['first', 'second', 'third'], 0)).not.toThrow()
    expect(() => planClaudeFork(transcript(lines), ['a', 'first', 'second', 'third'], 1)).toThrow(/fewer prompts/)
    expect(() => planClaudeFork(transcript([...lines, 'not json']), ['first', 'second', 'third'], 1)).toThrow(/unreadable/)
  })

  it('ignores tool results, meta lines and compaction summaries when counting prompts', () => {
    const noisy = [prompt('first'), prompt('<system>', { isMeta: true }), prompt('summary', { isCompactSummary: true }), toolResult, prompt('second')]
    expect(planClaudeFork(transcript(noisy), ['first', 'second'], 1).keep).toEqual(noisy.slice(0, 4))
  })

  it('writes a new session next to the original and leaves the original untouched', async () => {
    const home = mkdtempSync(join(tmpdir(), 'oxe-claude-fork-')); directories.push(home)
    const env = { CLAUDE_CONFIG_DIR: home }
    const original = '11111111-1111-4111-8111-111111111111'
    const path = claudeTranscriptPath('/work/project', original, env)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, transcript(lines))
    const fork = await forkClaudeBefore({ rootPath: '/work/project', sessionId: original, localPrompts: ['first', 'second', 'third'], targetIndex: 1, env })
    expect(fork.sessionId).not.toBe(original)
    expect(readFileSync(path, 'utf8')).toBe(transcript(lines))
    expect(readFileSync(claudeTranscriptPath('/work/project', fork.sessionId, env), 'utf8')).toBe(transcript(lines.slice(0, 4)))
  })

  it('rejects a session id that is not a UUID and a missing transcript', async () => {
    expect(() => claudeTranscriptPath('/p', '../../etc/passwd')).toThrow(/not valid/)
    const home = mkdtempSync(join(tmpdir(), 'oxe-claude-fork-')); directories.push(home)
    await expect(forkClaudeBefore({ rootPath: '/p', sessionId: '22222222-2222-4222-8222-222222222222', localPrompts: ['a'], targetIndex: 0, env: { CLAUDE_CONFIG_DIR: home } })).rejects.toMatchObject({ code: 'unavailable' })
  })
})
