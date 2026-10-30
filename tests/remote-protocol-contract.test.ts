import { describe, expect, it } from 'vitest'
import {
  readRemoteFrame,
  REMOTE_CLIENT_FRAMES,
  REMOTE_COMMANDS,
  REMOTE_ERROR_CODES,
  REMOTE_FORBIDDEN,
  REMOTE_FRAME_TYPES,
  REMOTE_LIMITS,
  REMOTE_PROTOCOL_VERSION,
  REMOTE_SUBSCRIPTIONS
} from '../shared/remote/protocol'

/** Words that name what stays with the person at the desktop; no command or subscription may carry them. */
const FORBIDDEN_WORDS = /approve|approval|confirm|trust|token|secret|password|credential|sign.?in|login|policy|access|exec|shell|spawn|vault/i

describe('C5 remote protocol', () => {
  it('is versioned and frames JSON of the C5 kinds', () => {
    expect(Number.isInteger(REMOTE_PROTOCOL_VERSION) && REMOTE_PROTOCOL_VERSION >= 1).toBe(true)
    for (const type of ['hello', 'auth', 'subscribe', 'event', 'snapshot', 'command', 'ack', 'error']) expect(REMOTE_FRAME_TYPES).toContain(type)
    expect(REMOTE_CLIENT_FRAMES).not.toContain('event')
    expect(REMOTE_CLIENT_FRAMES).not.toContain('snapshot')
  })

  it('keeps the limits the mobile roadmap sets', () => {
    expect(REMOTE_LIMITS.maxFrameBytes).toBe(64 * 1024)
    expect(REMOTE_LIMITS.accessTokenTtlMs).toBe(15 * 60_000)
    expect(REMOTE_LIMITS.pairingCodeTtlMs).toBe(2 * 60_000)
    expect(REMOTE_LIMITS.maxDevices).toBe(5)
  })

  it('has no forbidden capability as a command or a subscription', () => {
    const offered = [...REMOTE_COMMANDS, ...REMOTE_SUBSCRIPTIONS] as string[]
    for (const forbidden of REMOTE_FORBIDDEN) expect(offered, forbidden).not.toContain(forbidden)
    expect(offered.filter(name => FORBIDDEN_WORDS.test(name))).toEqual([])
    expect(REMOTE_FORBIDDEN).toEqual(expect.arrayContaining(['oxequery.approve', 'mcp.confirm', 'mcp.trust', 'accounts.signIn', 'accounts.token', 'secrets.read', 'policy.edit', 'host.exec']))
  })

  it('answers a Thread request only through the generation-checked command, and has the errors for it', () => {
    expect(REMOTE_COMMANDS).toContain('thread.respondRequest')
    expect(REMOTE_ERROR_CODES).toEqual(expect.arrayContaining(['not-pending', 'stale-generation', 'revoked', 'token-expired', 'pane-not-shared']))
    expect(new Set(REMOTE_ERROR_CODES).size).toBe(REMOTE_ERROR_CODES.length)
  })

  it('refuses oversized, malformed, desktop-only and unknown frames', () => {
    expect(readRemoteFrame('x'.repeat(REMOTE_LIMITS.maxFrameBytes + 1), 'client')).toEqual({ ok: false, code: 'frame-too-large' })
    // Size is counted in bytes, not characters.
    expect(readRemoteFrame(JSON.stringify({ type: 'hello', versions: [1], pad: 'é'.repeat(REMOTE_LIMITS.maxFrameBytes / 2) }), 'client')).toEqual({ ok: false, code: 'frame-too-large' })
    for (const text of ['', 'not json', '[]', 'null', '1', '{"type":"teleport"}']) expect(readRemoteFrame(text, 'client'), text).toEqual({ ok: false, code: 'malformed' })
    expect(readRemoteFrame('{"type":"event","subscription":"s","seq":1,"schemaVersion":1,"data":{}}', 'client')).toEqual({ ok: false, code: 'malformed' })
    expect(readRemoteFrame('{"type":"command","id":"1","command":"host.exec","args":{}}', 'client')).toEqual({ ok: false, code: 'unknown-command' })
    expect(readRemoteFrame('{"type":"command","id":"1","command":"oxequery.approve","args":{}}', 'client')).toEqual({ ok: false, code: 'unknown-command' })
  })

  it('reads the frames each side may send', () => {
    expect(readRemoteFrame('{"type":"hello","versions":[1]}', 'client')).toEqual({ ok: true, frame: { type: 'hello', versions: [1] } })
    expect(readRemoteFrame('{"type":"command","id":"1","command":"thread.interrupt","args":{"threadId":"t"}}', 'client').ok).toBe(true)
    expect(readRemoteFrame('{"type":"event","subscription":"s","seq":1,"schemaVersion":1,"data":{}}', 'desktop').ok).toBe(true)
  })
})
