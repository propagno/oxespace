// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { describeFrame, parseArgs, run, type Options } from '../../scripts/remote-subscribe.mts'
import type { Harness } from '../helpers/remote-gateway-harness'
import { phoneWithDesktop } from '../helpers/remote-session'

/** 1.4.3 P5 · scripts/remote-subscribe.mts against a real gateway (the harness, loopback): no phone, no live accounts. */

const harnesses: Harness[] = []
const dirs: string[] = []
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map(value => value.close()))
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const base = (target: { host: string; port: number; fp: string }, extra: Partial<Options>): Options =>
  ({ pair: false, host: target.host, port: target.port, fp: target.fp, topic: 'terminal', target: 'p1', frames: 1, raw: false, ...extra })

describe('remote-subscribe script', () => {
  test('signs in with a device token, subscribes to a pane and prints its frames; the token is never printed', async () => {
    const phone = await phoneWithDesktop(harnesses, desk => { desk.terminals.start('p1'); desk.terminals.print('p1', 'busy: compiling 3/7\r\n') })
    const lines: string[] = []
    // The newest output is held for the flush window, so it can arrive in the frame after the snapshot.
    expect(await run(base(phone.target, { token: phone.accessToken, frames: 2 }), line => lines.push(line))).toBe(0)
    const text = lines.join('\n')
    expect(text).toContain('signed in')
    expect(text).toContain('subscribed:')
    expect(text).toContain('busy: compiling 3/7')
    expect(text).not.toContain(phone.accessToken)
  })

  test('a wrong certificate fingerprint stops before anything is sent', async () => {
    const phone = await phoneWithDesktop(harnesses, desk => desk.terminals.start('p1'))
    const lines: string[] = []
    expect(await run(base(phone.target, { token: phone.accessToken, fp: 'f'.repeat(64) }), line => lines.push(line))).toBe(2)
    expect(lines.join('\n')).toContain('Nothing was sent')
    expect(lines.join('\n')).not.toContain('signed in')
  })

  test('--pair makes a test device (the person accepts it), saves its key, and a later run signs in by refresh with it', async () => {
    const phone = await phoneWithDesktop(harnesses, desk => { desk.terminals.start('p1'); desk.terminals.print('p1', 'hello\r\n') })
    const dir = mkdtempSync(join(tmpdir(), 'oxe-subscribe-'))
    dirs.push(dir)
    const device = join(dir, 'device.json')
    const qr = phone.h.offer()
    const prompt = phone.h.nextPrompt()
    void prompt.then(value => phone.h.gateway.answerPairing({ promptId: value.promptId, accept: true }), () => undefined)
    const first: string[] = []
    expect(await run(base(phone.target, { pair: true, device, code: qr.code }), line => first.push(line))).toBe(0)
    expect(first.join('\n')).toContain('signed in')
    const saved = JSON.parse(readFileSync(device, 'utf8')) as { deviceId: string; privateKeyPkcs8: string }
    expect(phone.h.gateway.devices().map(entry => entry.name)).toContain('remote-subscribe')
    // Refresh with the saved key: no token at all.
    const second: string[] = []
    expect(await run(base(phone.target, { device }), line => second.push(line))).toBe(0)
    expect(second.join('\n')).toContain('signed in')
    expect(second.join('\n')).not.toContain(saved.privateKeyPkcs8)
  })

  test('a removed device hears revoked and the script exits non-zero', async () => {
    const phone = await phoneWithDesktop(harnesses, desk => desk.terminals.start('p1'))
    phone.h.gateway.revoke({ deviceId: phone.deviceId })
    const lines: string[] = []
    expect(await run(base(phone.target, { token: phone.accessToken }), line => lines.push(line))).toBe(1)
    expect(lines.join('\n')).toContain('"code":"revoked"')
  })
})

describe('remote-subscribe arguments and output', () => {
  test('the pairing URI gives host, port, fingerprint and code; bad input is refused with what is missing', () => {
    const fp = 'a'.repeat(64)
    expect(parseArgs(['tok', '--uri', `oxespace://pair?v=1&host=192.168.0.10&port=47321&fp=${fp}&code=${'C'.repeat(22)}`, '--pane', 'p1']))
      .toMatchObject({ token: 'tok', host: '192.168.0.10', port: 47321, fp, code: 'C'.repeat(22), topic: 'terminal', target: 'p1', frames: 5 })
    expect(parseArgs(['tok', '--host', 'h', '--port', '1', '--fp', 'AA:'.repeat(31) + 'AA', '--topic', 'threads'])).toMatchObject({ fp: 'a'.repeat(64), topic: 'threads' })
    expect(() => parseArgs(['tok', '--pane', 'p1'])).toThrow(/--uri/)
    expect(() => parseArgs(['tok', '--host', 'h', '--port', '1', '--fp', 'zz', '--pane', 'p1'])).toThrow(/fingerprint/)
    expect(() => parseArgs(['--host', 'h', '--port', '1', '--fp', fp, '--pane', 'p1'])).toThrow(/deviceToken/)
    expect(() => parseArgs(['tok', '--host', 'h', '--port', '1', '--fp', fp])).toThrow(/--pane/)
    expect(() => parseArgs(['--pair', '--host', 'h', '--port', '1', '--fp', fp, '--pane', 'p1'])).toThrow(/--pair/)
  })

  test('frame summaries hide tokens, cut long text and replace the snapshot by its size', () => {
    expect(describeFrame({ type: 'ack', id: 'auth', result: { accessToken: 'secret-token', expiresInMs: 1 } })).not.toContain('secret-token')
    const summary = describeFrame({ type: 'snapshot', data: { data: 'x'.repeat(500), truncated: false, snapshot: { ansi: '\x1b[1mhi', cols: 80, rows: 24 } } })
    expect(summary).toContain('(500 chars)')
    expect(summary).toContain('"ansi":"[6 chars]"')
  })
})
