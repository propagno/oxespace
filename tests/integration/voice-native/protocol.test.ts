/**
 * OxeVoice F1 · A3 — frozen acceptance test (written by the plan, before execution; do not edit).
 * The helper process speaks JSON lines on stdout. Main trusts nothing it says: every line is parsed against a closed
 * schema, size-capped, and anything else is refused with a reason (never thrown, never forwarded raw).
 */
import { describe, expect, it } from 'vitest'
import { createLineSplitter, MAX_HELPER_LINE_BYTES, parseHelperLine } from '../../../electron/main/services/voice/protocol'

describe('helper JSON lines (A3)', () => {
  it('accepts the closed set of messages', () => {
    expect(parseHelperLine('{"type":"probe","available":true,"languages":["pt-BR","en-US"],"systemLanguage":"pt-BR"}'))
      .toEqual({ ok: true, message: { type: 'probe', available: true, languages: ['pt-BR', 'en-US'], systemLanguage: 'pt-BR' } })
    expect(parseHelperLine('{"type":"listening"}')).toEqual({ ok: true, message: { type: 'listening' } })
    expect(parseHelperLine('{"type":"partial","text":"olá"}')).toEqual({ ok: true, message: { type: 'partial', text: 'olá' } })
    expect(parseHelperLine('{"type":"final","text":"olá mundo"}')).toEqual({ ok: true, message: { type: 'final', text: 'olá mundo' } })
    expect(parseHelperLine('{"type":"error","hresult":"0x80045509"}')).toEqual({ ok: true, message: { type: 'error', hresult: '0x80045509' } })
    expect(parseHelperLine('{"type":"ended"}')).toEqual({ ok: true, message: { type: 'ended' } })
  })

  it('drops unknown fields instead of forwarding them', () => {
    expect(parseHelperLine('{"type":"final","text":"x","__proto__":{"polluted":true},"extra":1}')).toEqual({ ok: true, message: { type: 'final', text: 'x' } })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('refuses invalid JSON, unknown types, wrong field types and oversized lines', () => {
    expect(parseHelperLine('not json')).toEqual({ ok: false, error: 'invalid_json' })
    expect(parseHelperLine('[]')).toEqual({ ok: false, error: 'invalid_message' })
    expect(parseHelperLine('{"type":"exec","command":"calc"}')).toEqual({ ok: false, error: 'unknown_type' })
    expect(parseHelperLine('{"type":"partial","text":42}')).toEqual({ ok: false, error: 'invalid_field' })
    expect(parseHelperLine('{"type":"probe","available":"yes","languages":[]}')).toEqual({ ok: false, error: 'invalid_field' })
    expect(parseHelperLine('{"type":"probe","available":true,"languages":["pt-BR",7]}')).toEqual({ ok: false, error: 'invalid_field' })
    expect(parseHelperLine('{"type":"error","hresult":"rm -rf"}')).toEqual({ ok: false, error: 'invalid_field' })
    const huge = JSON.stringify({ type: 'final', text: 'a'.repeat(MAX_HELPER_LINE_BYTES) })
    expect(parseHelperLine(huge)).toEqual({ ok: false, error: 'line_too_long' })
  })

  it('caps the text a single message may carry', () => {
    expect(MAX_HELPER_LINE_BYTES).toBeGreaterThanOrEqual(4096)
    expect(MAX_HELPER_LINE_BYTES).toBeLessThanOrEqual(256 * 1024)
  })

  it('splits stdout chunks into lines across chunk boundaries, CRLF included', () => {
    const lines: string[] = []
    const splitter = createLineSplitter(line => lines.push(line))
    splitter.push('{"type":"lis')
    splitter.push('tening"}\r\n{"type":"partial","text":"a"}\n{"type":')
    expect(lines).toEqual(['{"type":"listening"}', '{"type":"partial","text":"a"}'])
    splitter.push('"ended"}')
    splitter.flush()
    expect(lines).toEqual(['{"type":"listening"}', '{"type":"partial","text":"a"}', '{"type":"ended"}'])
    expect(lines.every(line => !line.endsWith('\r'))).toBe(true)
  })

  it('a runaway line without newline is cut, not buffered forever', () => {
    const lines: string[] = []
    const splitter = createLineSplitter(line => lines.push(line))
    splitter.push('x'.repeat(MAX_HELPER_LINE_BYTES * 3))
    splitter.push('\n{"type":"ended"}\n')
    // The oversized chunk is discarded (or delivered as one oversized line that parseHelperLine refuses), and the stream recovers.
    expect(lines[lines.length - 1]).toBe('{"type":"ended"}')
    expect(lines.every(line => line.length <= MAX_HELPER_LINE_BYTES * 3)).toBe(true)
  })
})
