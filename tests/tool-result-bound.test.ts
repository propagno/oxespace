import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { boundToolResult, pruneToolOutputs, TOOL_OUTPUT_RETENTION_MS, toolOutputSaver } from '../electron/main/mcp-internal/tool-result-bound'

const roots: string[] = []
const root = () => { const dir = mkdtempSync(join(tmpdir(), 'oxe-bound-')); roots.push(dir); return dir }
afterEach(() => { for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('bounding internal MCP tool results', () => {
  it('leaves a result within the limit untouched', () => {
    const result = { content: [{ type: 'text' as const, text: 'short' }] }
    expect(boundToolResult(result, 100)).toBe(result)
  })

  it('keeps the beginning and the end, says how much was left out, and keeps images', () => {
    const text = `HEAD${'a'.repeat(5_000)}TAIL`
    const image = { type: 'image' as const, data: 'AAAA', mimeType: 'image/png' }
    const bounded = boundToolResult({ content: [{ type: 'text', text }, image], isError: true }, 1_000)
    expect(bounded.isError).toBe(true)
    expect(bounded.content[1]).toBe(image)
    const out = bounded.content[0]
    expect(out.type === 'text' && out.text.startsWith('HEAD') && out.text.endsWith('TAIL')).toBe(true)
    expect(out.type === 'text' && out.text).toMatch(/of output omitted\. The full output was not kept\./)
  })

  it('joins several text blocks into one and saves the full text', () => {
    const dir = root()
    const bounded = boundToolResult({ content: [{ type: 'text', text: 'x'.repeat(800) }, { type: 'text', text: 'y'.repeat(800) }] }, 1_000, toolOutputSaver(dir, 'oxespace/get job', 1))
    expect(bounded.content).toHaveLength(1)
    const [file] = readdirSync(dir)
    expect(file).toMatch(/^oxespace_get_job-1-[0-9a-f]{8}\.txt$/)
    const out = bounded.content[0]
    expect(out.type === 'text' && out.text).toContain(join(dir, file))
  })

  it('never cuts a character in half', () => {
    const text = '😀'.repeat(2_000)
    const out = boundToolResult({ content: [{ type: 'text', text }] }, 1_001).content[0]
    expect(out.type === 'text' && out.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/)
  })

  it('still cuts when the full text cannot be saved', () => {
    const out = boundToolResult({ content: [{ type: 'text', text: 'z'.repeat(5_000) }] }, 1_000, () => { throw Error('disk full') }).content[0]
    expect(out.type === 'text' && out.text.length).toBeLessThan(1_200)
  })

  it('deletes saved outputs older than a week and keeps the rest', () => {
    const dir = root(), now = Date.now()
    writeFileSync(join(dir, 'old.txt'), 'old'); writeFileSync(join(dir, 'new.txt'), 'new'); writeFileSync(join(dir, 'other.log'), 'x')
    const old = (now - TOOL_OUTPUT_RETENTION_MS - 60_000) / 1000
    utimesSync(join(dir, 'old.txt'), old, old); utimesSync(join(dir, 'other.log'), old, old)
    expect(pruneToolOutputs(dir, now)).toBe(1)
    expect(readdirSync(dir).sort()).toEqual(['new.txt', 'other.log'])
    expect(pruneToolOutputs(join(dir, 'missing'), now)).toBe(0)
  })
})
