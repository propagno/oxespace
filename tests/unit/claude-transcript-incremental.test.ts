// 1.5.2: Claude transcripts are read once and then only what was appended (the context chip and /resume read whole
// transcripts, up to 214 MB, synchronously on the main process each time). The totals must equal a full read.
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { forgetTranscripts, readTranscript } from '../../electron/main/services/usage/claudeProvider'

const usage = (input: number, output: number, model = 'claude-opus-4-7') =>
  JSON.stringify({ type: 'assistant', message: { model, usage: { input_tokens: input, cache_creation_input_tokens: 1, cache_read_input_tokens: 2, output_tokens: output } } })
const user = (text: string) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } })
const tool = (size: number) => JSON.stringify({ type: 'user', toolUseResult: { stdout: 'x'.repeat(size) } })

let dir = ''
let file = ''
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'oxe-transcript-')); file = join(dir, 's.jsonl'); forgetTranscripts() })
afterEach(() => { forgetTranscripts(); rmSync(dir, { recursive: true, force: true }) })

const fresh = () => { forgetTranscripts(); return readTranscript(file) }

describe('reading a Claude transcript incrementally', () => {
  it('adds up the usage lines and skips the rest', () => {
    writeFileSync(file, [user('hi'), usage(10, 5), tool(1000), usage(20, 7), ''].join('\n'))
    const tally = readTranscript(file)
    expect(tally).toMatchObject({ requestCount: 2, inputTokens: 30, outputTokens: 12, cacheCreationTokens: 2, cacheReadTokens: 4, lastTurnInputTokens: 20, lastTurnOutputTokens: 7, modelId: 'claude-opus-4-7' })
  })

  it('reads only what was appended, and ends equal to a full read', () => {
    writeFileSync(file, [user('hi'), usage(10, 5), ''].join('\n'))
    expect(readTranscript(file).requestCount).toBe(1)
    appendFileSync(file, [tool(500), usage(3, 4, 'claude-sonnet-4-6'), ''].join('\n'))
    const incremental = { ...readTranscript(file) }
    expect(incremental).toMatchObject({ requestCount: 2, inputTokens: 13, outputTokens: 9, modelId: 'claude-sonnet-4-6', lastTurnInputTokens: 3 })
    expect(fresh()).toEqual(incremental)
  })

  it('counts an unterminated last line once, and not again when its newline arrives', () => {
    writeFileSync(file, [usage(10, 5), usage(1, 1)].join('\n'))
    expect(readTranscript(file).requestCount).toBe(2)
    appendFileSync(file, '\n' + usage(2, 2) + '\n')
    expect(readTranscript(file)).toMatchObject({ requestCount: 3, inputTokens: 13 })
    expect(fresh()).toMatchObject({ requestCount: 3, inputTokens: 13 })
  })

  it('keeps a multi-byte character that a 4 MB chunk boundary splits', () => {
    const big = JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-4-7', content: 'é'.repeat(2_200_000), usage: { input_tokens: 7, output_tokens: 1 } } })
    writeFileSync(file, [usage(1, 1), big, usage(2, 2), ''].join('\n'))
    expect(readTranscript(file)).toMatchObject({ requestCount: 3, inputTokens: 10, outputTokens: 4 })
  })

  it('reads a transcript that got shorter again from the start', () => {
    writeFileSync(file, [usage(10, 5), usage(10, 5), ''].join('\n'))
    expect(readTranscript(file).requestCount).toBe(2)
    writeFileSync(file, [usage(1, 1), ''].join('\n'))
    expect(readTranscript(file)).toMatchObject({ requestCount: 1, inputTokens: 1 })
  })
})
