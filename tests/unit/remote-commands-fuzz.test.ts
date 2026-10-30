import { describe, expect, test } from 'vitest'
import { auditDetail, parseCommandArgs } from '../../electron/main/services/remote/commands'
import { cut, redactCounted, relativeTo, scrubPaths } from '../../electron/main/services/remote/text'
import { REMOTE_COMMANDS, REMOTE_LIMITS } from '../../shared/remote/protocol'

/** A small deterministic generator, so a failure names its seed. */
function random(seed: number) {
  let state = seed >>> 0 || 1
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 0x1_0000_0000 }
}

function value(next: () => number, depth = 0): unknown {
  const pick = Math.floor(next() * (depth > 3 ? 8 : 11))
  switch (pick) {
    case 0: return null
    case 1: return undefined
    case 2: return next() > 0.5
    case 3: return Math.floor((next() - 0.5) * 2 ** 40)
    case 4: return [Number.NaN, Infinity, -0, 1.5, Number.MAX_SAFE_INTEGER + 2][Math.floor(next() * 5)]
    case 5: return ['', 't1', 'accept', 'acceptForSession', 'client-0001', 'x'.repeat(5000), '\0', '__proto__', 'é'.repeat(3000), 'host.exec'][Math.floor(next() * 10)]
    case 6: return 'y'.repeat(Math.floor(next() * 40_000))
    case 7: return Symbol('s').toString()
    case 8: return Array.from({ length: Math.floor(next() * 4) }, () => value(next, depth + 1))
    default: {
      const keys = ['threadId', 'text', 'clientId', 'requestId', 'generation', 'response', 'decision', 'answers', 'reason', 'paneId', 'data', 'beforeSeq', 'scope', 'permissions', 'constructor']
      return Object.fromEntries(Array.from({ length: Math.floor(next() * 6) }, () => [keys[Math.floor(next() * keys.length)], value(next, depth + 1)]))
    }
  }
}

describe('remote command args', () => {
  test('fuzzed args either parse to exactly the contract shape or throw; nothing else gets through', () => {
    for (let seed = 1; seed <= 4000; seed += 1) {
      const next = random(seed)
      const command = REMOTE_COMMANDS[seed % REMOTE_COMMANDS.length]
      const input = value(next)
      let parsed: Record<string, unknown>
      try { parsed = parseCommandArgs(command, input) as unknown as Record<string, unknown> } catch { continue }
      const keys = Object.keys(parsed).sort()
      switch (command) {
        case 'thread.send': case 'thread.steer':
          expect(keys, `seed ${seed}`).toEqual(['clientId', 'text', 'threadId'])
          expect((parsed.text as string).length).toBeLessThanOrEqual(REMOTE_LIMITS.maxTextLength)
          break
        case 'thread.interrupt': expect(keys).toEqual(['threadId']); break
        case 'thread.respondRequest': {
          expect(keys).toEqual(['generation', 'requestId', 'response', 'threadId'])
          const response = parsed.response as Record<string, unknown>
          expect(Object.keys(response).every(key => ['decision', 'answers', 'reason'].includes(key))).toBe(true)
          expect([undefined, 'accept', 'decline', 'cancel']).toContain(response.decision)
          break
        }
        case 'terminal.write': expect(Buffer.byteLength(parsed.data as string)).toBeLessThanOrEqual(REMOTE_LIMITS.terminalWriteBytes); break
        case 'thread.history': expect(Number.isSafeInteger(parsed.beforeSeq)).toBe(true); break
      }
      expect(auditDetail(command, input).length).toBeLessThan(700)
    }
  })

  test('the shapes the contract names are read; acceptForSession, extra keys and wrong types are not', () => {
    expect(parseCommandArgs('thread.send', { threadId: 't1', text: 'hi', clientId: 'abcdefgh' })).toEqual({ threadId: 't1', text: 'hi', clientId: 'abcdefgh' })
    expect(parseCommandArgs('thread.respondRequest', { threadId: 't', requestId: 'r', generation: 3, response: { answers: { q1: ['a'] } } }))
      .toEqual({ threadId: 't', requestId: 'r', generation: 3, response: { answers: { q1: ['a'] } } })
    for (const [command, args] of [
      ['thread.respondRequest', { threadId: 't', requestId: 'r', generation: 1, response: { decision: 'acceptForSession' } }],
      ['thread.respondRequest', { threadId: 't', requestId: 'r', generation: 1, response: { decision: 'accept', scope: 'session' } }],
      ['thread.respondRequest', { threadId: 't', requestId: 'r', generation: 1, response: { decision: 'accept', permissions: {} } }],
      ['thread.respondRequest', { threadId: 't', requestId: 'r', generation: 1, response: {} }],
      ['thread.respondRequest', { threadId: 't', requestId: 'r', generation: -1, response: { decision: 'accept' } }],
      ['thread.send', { threadId: 't', text: 'x', clientId: 'abcdefgh', attachmentIds: [] }],
      ['thread.send', Object.assign(Object.create({ polluted: true }), { threadId: 't', text: 'x', clientId: 'abcdefgh' })],
      ['terminal.write', { paneId: 'p', data: '' }],
      ['thread.interrupt', { threadId: '../etc' }]
    ] as const) expect(() => parseCommandArgs(command, args), JSON.stringify(args)).toThrow()
  })
})

describe('remote text filters', () => {
  test('paths: roots become relative, anything else absolute is replaced', () => {
    expect(scrubPaths('at C:\\Users\\dev\\proj\\src\\a.ts and c:/users/dev/proj', ['C:\\Users\\dev\\proj'])).toBe('at .\\src\\a.ts and .')
    expect(scrubPaths('see /home/dev/proj/x and /home/dev/other and /etc/passwd and D:\\x y', ['/home/dev/proj'])).toBe('see ./x and … and … and … y')
    expect(scrubPaths('C:\\Users\\dev\\project2', ['C:\\Users\\dev\\proj'])).toBe('…')
    expect(scrubPaths('a/b/c and ./rel and https://example.com/home/x', [])).toBe('a/b/c and ./rel and https://example.com/home/x')
    expect(relativeTo('C:\\R', 'c:\\r\\pkg\\a')).toBe('pkg/a')
    expect(relativeTo('/r', '/r')).toBe('.')
    expect(relativeTo('/r', '/r/../x')).toBeUndefined()
    expect(relativeTo('/r', '/other')).toBeUndefined()
    expect(relativeTo('/r', 'src/x')).toBe('src/x')
  })

  test('the redactor\'s replacements are counted; cuts never split a surrogate pair', () => {
    expect(redactCounted(`a ghp_${'a'.repeat(36)} b sk-ant-${'b'.repeat(20)} [redacted]`)).toEqual({ text: 'a [redacted] b [redacted] [redacted]', redacted: 2 })
    expect(cut('ab😀', 3)).toEqual({ text: 'ab', truncated: true })
  })
})
