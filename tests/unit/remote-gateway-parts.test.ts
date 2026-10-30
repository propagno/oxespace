// @vitest-environment node
import { createPrivateKey, generateKeyPairSync, sign, X509Certificate } from 'node:crypto'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { certificateFingerprint, createGatewayCertificate, derInteger, derOid, derTime } from '../../electron/main/services/remote/certificate'
import { RemoteConnection, mentionsForbidden, type ConnectionHost, type FrameSocket } from '../../electron/main/services/remote/connection'
import {
  parseAnswerPairingInput, parseDesktopNameInput, parseDeviceId, parseDeviceName, parseNoInput, parseRenameInput, parseSetEnabledInput, parseSetPhoneWriteInput
} from '../../electron/main/services/remote/inputs'
import { messageFromError } from '../../shared/messages'
import { isPrivateAddress, listenAddresses, peerAddress } from '../../electron/main/services/remote/network'
import { PairingDesk } from '../../electron/main/services/remote/pairing'
import { AccessTokens, readDevicePublicKey, sameSecret, verifyRefreshSignature } from '../../electron/main/services/remote/tokens'
import { upgradeRefusal } from '../../electron/main/services/remote/websocket'
import { REMOTE_LIMITS, refreshSigningInput } from '../../shared/remote/protocol'

afterEach(() => { vi.useRealTimers() })

describe('certificate', () => {
  test('a valid self-signed EC P-256 certificate, 10 years, whose fingerprint is the SHA-256 of its DER', () => {
    const now = Date.UTC(2026, 9, 30)
    const made = createGatewayCertificate(now)
    const certificate = new X509Certificate(made.der)
    expect(certificate.verify(certificate.publicKey)).toBe(true)
    expect(certificate.checkPrivateKey(createPrivateKey(made.keyPem))).toBe(true)
    expect(certificate.publicKey.asymmetricKeyDetails?.namedCurve).toBe('prime256v1')
    expect(certificate.ca).toBe(false)
    expect(new Date(certificate.validTo).getUTCFullYear()).toBe(2036)
    expect(certificate.fingerprint256.replace(/:/g, '').toLowerCase()).toBe(certificateFingerprint(made.der))
    expect(createGatewayCertificate(now).der.equals(made.der)).toBe(false)
  })

  test('DER pieces', () => {
    expect(derInteger(Buffer.from([0x00, 0x00, 0x80])).toString('hex')).toBe('02020080')
    expect(derInteger(Buffer.from([0]))).toEqual(Buffer.from([2, 1, 0]))
    expect(derOid('1.2.840.10045.4.3.2').toString('hex')).toBe('06082a8648ce3d040302')
    expect(derTime(new Date(Date.UTC(2049, 11, 31, 23, 59, 59))).toString('latin1')).toBe('\x17\x0d491231235959Z')
    expect(derTime(new Date(Date.UTC(2050, 0, 1))).toString('latin1')).toBe('\x18\x0f20500101000000Z')
    // A certificate dated after 2049 still parses.
    expect(() => new X509Certificate(createGatewayCertificate(Date.UTC(2045, 0, 1)).der)).not.toThrow()
  })
})

describe('network', () => {
  test.each([
    ['10.0.0.1', true], ['172.16.0.1', true], ['172.31.255.255', true], ['192.168.1.20', true], ['169.254.3.4', true],
    ['fd12:3456::1', true], ['fc00::1', true], ['fe80::1', true], ['fe80::1%12', true], ['febf::1', true],
    ['172.15.0.1', false], ['172.32.0.1', false], ['11.0.0.1', false], ['127.0.0.1', false], ['0.0.0.0', false], ['8.8.8.8', false],
    ['::', false], ['::1', false], ['::ffff:10.0.0.1', false], ['fec0::1', false], ['2001:db8::1', false], ['ff02::1', false], ['', false], ['localhost', false]
  ])('%s private: %s', (address, expected) => expect(isPrivateAddress(address)).toBe(expected))

  test('listen addresses: private only, LAN IPv4 first, link-local IPv6 with its zone', () => {
    const entry = (address: string, family: 'IPv4' | 'IPv6', scopeid?: number) => ({ address, family, internal: false, netmask: '', mac: '', cidr: null, ...(scopeid !== undefined ? { scopeid } : {}) })
    const found = listenAddresses({
      a: [entry('fe80::1', 'IPv6', 7), entry('127.0.0.1', 'IPv4'), entry('203.0.113.4', 'IPv4')],
      b: [entry('169.254.1.1', 'IPv4'), entry('192.168.0.10', 'IPv4'), entry('fd00::2', 'IPv6', 0), entry('192.168.0.10', 'IPv4')]
    } as never)
    expect(found).toEqual([
      { address: '192.168.0.10', host: '192.168.0.10', family: 'IPv4' },
      { address: '169.254.1.1', host: '169.254.1.1', family: 'IPv4' },
      { address: 'fd00::2', host: 'fd00::2', family: 'IPv6' },
      { address: 'fe80::1', host: 'fe80::1%7', family: 'IPv6' }
    ])
    expect(peerAddress('::ffff:192.168.0.5')).toBe('192.168.0.5')
    expect(peerAddress(undefined)).toBe('unknown')
  })
})

describe('tokens', () => {
  const key = Buffer.alloc(32, 9)
  test('issued tokens verify until they expire, on the desktop clock', () => {
    let now = 1_000_000
    const tokens = new AccessTokens(key, () => now)
    const { accessToken, expiresInMs } = tokens.issue('device-1')
    expect(expiresInMs).toBe(REMOTE_LIMITS.accessTokenTtlMs)
    expect(tokens.check(accessToken)).toEqual({ ok: true, deviceId: 'device-1', expiresAt: now + REMOTE_LIMITS.accessTokenTtlMs })
    now += REMOTE_LIMITS.accessTokenTtlMs
    expect(tokens.check(accessToken)).toEqual({ ok: false, code: 'token-expired' })
  })

  test('altered, foreign or nonsense tokens are unauthenticated', () => {
    const tokens = new AccessTokens(key), other = new AccessTokens(Buffer.alloc(32, 1))
    const { accessToken } = tokens.issue('device-1')
    const [version, payload, mac] = accessToken.split('.')
    const forgedPayload = Buffer.from(JSON.stringify({ d: 'device-2', e: Date.now() + 1e9, n: 'x' })).toString('base64url')
    for (const token of [other.issue('device-1').accessToken, `${version}.${forgedPayload}.${mac}`, `v2.${payload}.${mac}`, `${accessToken}.x`, '', 'a.b.c', 42, null, 'v1.' + 'A'.repeat(600)]) {
      expect(tokens.check(token)).toEqual({ ok: false, code: 'unauthenticated' })
    }
    expect(() => new AccessTokens(Buffer.alloc(16))).toThrow()
  })

  test('refresh signatures: DER only, by the paired key, over the exact text', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    const spki = publicKey.export({ format: 'der', type: 'spki' })
    const text = Buffer.from(refreshSigningInput('ab'.repeat(32), 'dev', 'nonce'))
    const der = sign('sha256', text, privateKey).toString('base64url')
    const raw = sign('sha256', text, { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')
    expect(verifyRefreshSignature(spki, 'ab'.repeat(32), 'dev', 'nonce', der)).toBe(true)
    expect(verifyRefreshSignature(spki, 'ab'.repeat(32), 'dev', 'nonce', raw)).toBe(false) // r‖s is not DER
    expect(verifyRefreshSignature(spki, 'ab'.repeat(32), 'dev', 'other', der)).toBe(false)
    expect(verifyRefreshSignature(spki, 'ab'.repeat(32), 'dev2', 'nonce', der)).toBe(false)
    expect(verifyRefreshSignature(Buffer.from('junk'), 'ab'.repeat(32), 'dev', 'nonce', der)).toBe(false)
    expect(verifyRefreshSignature(spki, 'ab'.repeat(32), 'dev', 'nonce', 'not base64!')).toBe(false)
    expect(readDevicePublicKey(spki)?.equals(spki)).toBe(true)
    expect(readDevicePublicKey(generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }))).toBeNull()
    expect(readDevicePublicKey(Buffer.alloc(91))).toBeNull()
    expect(sameSecret('abc', 'abc') && !sameSecret('abc', 'abd') && !sameSecret('abc', 'abcd')).toBe(true)
  })
})

describe('pairing desk', () => {
  test('one code at a time, one attempt per code, attempts per address, one question at a time', async () => {
    let now = 0
    const prompts: unknown[] = []
    const desk = new PairingDesk(() => now, 50, prompt => prompts.push(prompt))
    const first = desk.start(), second = desk.start()
    expect(first.code).toHaveLength(22)
    expect(desk.claim(first.code)).toBe('pairing-invalid') // replaced
    expect(desk.claim(second.code)).toBe('ok')
    expect(desk.claim(second.code)).toBe('pairing-used')
    const third = desk.start()
    now += REMOTE_LIMITS.pairingCodeTtlMs
    expect(desk.claim(third.code)).toBe('pairing-expired')

    for (let index = 0; index < REMOTE_LIMITS.pairingAttemptsPerWindow; index += 1) expect(desk.attempt('10.0.0.2')).toBe(true)
    expect(desk.attempt('10.0.0.2')).toBe(false)
    expect(desk.attempt('10.0.0.3')).toBe(true)
    now += REMOTE_LIMITS.pairingAttemptWindowMs + 1
    expect(desk.attempt('10.0.0.2')).toBe(true)

    const asked = desk.ask('Pixel', 'ABCDEF')!
    expect(desk.ask('Other', 'ZZZZZZ')).toBeNull()
    expect(() => desk.answer('nope', true)).toThrow('No such pairing request')
    desk.answer(asked.promptId, true)
    expect(await asked.answer).toBe('accepted')
    const timed = desk.ask('Pixel', 'ABCDEF')!
    expect(await timed.answer).toBe('expired')
    expect(prompts.filter(prompt => prompt === null)).toHaveLength(2)
    const cancelled = desk.ask('Pixel', 'ABCDEF')!
    expect(desk.cancel()).toBe(true)
    expect(await cancelled.answer).toBe('cancelled')
    const declined = desk.ask('Pixel', 'ABCDEF')!
    desk.answer(declined.promptId, false)
    expect(await declined.answer).toBe('declined')
    const abandoned = desk.ask('Pixel', 'ABCDEF')!
    desk.settle('abandoned', abandoned.promptId)
    expect(await abandoned.answer).toBe('abandoned')
  })

  test('tracks a bounded number of addresses', () => {
    const desk = new PairingDesk(() => 0)
    for (let index = 0; index < 3000; index += 1) desk.attempt(`10.0.${index >> 8}.${index & 255}`)
    expect((desk as unknown as { attempts: Map<string, number[]> }).attempts.size).toBeLessThanOrEqual(1024)
  })
})

describe('window inputs', () => {
  test('strict', () => {
    expect(parseSetEnabledInput({ enabled: true, port: 50_000 })).toEqual({ enabled: true, port: 50_000 })
    expect(parseSetEnabledInput({ enabled: false })).toEqual({ enabled: false })
    for (const input of [{ enabled: true, port: 65_536 }, { enabled: 1 }, { enabled: true, port: NaN }, Object.create({ enabled: true })]) expect(() => parseSetEnabledInput(input)).toThrow()
    expect(() => parseNoInput({})).toThrow()
    expect(() => parseNoInput(undefined)).not.toThrow()
    expect(parseAnswerPairingInput({ promptId: '00000000-0000-4000-8000-000000000000', accept: false }).accept).toBe(false)
    expect(() => parseAnswerPairingInput({ promptId: '00000000-0000-4000-8000-000000000000', accept: false, more: 1 })).toThrow()
    expect(() => parseRenameInput({ deviceId: 'x', name: 'a' })).toThrow()
    expect(parseDeviceName('  Phone ')).toBe('Phone')
    expect(() => parseDeviceName('a\nb')).toThrow()
    expect(parseDesktopNameInput({ name: ' Desk ' })).toEqual({ name: 'Desk' })
    expect(parseDesktopNameInput({ name: null })).toEqual({ name: null })
    for (const input of [{ name: 'x'.repeat(33) }, { name: '' }, { name: 'a\u0000' }, { name: undefined }, {}]) expect(() => parseDesktopNameInput(input)).toThrow()
  })

  test('what the person can fix carries a C3 code; malformed input does not', () => {
    const code = (run: () => unknown) => { try { run() } catch (error) { return messageFromError(error) } throw new Error('did not throw') }
    expect(code(() => parseDeviceId('x'))).toEqual({ code: 'remote.device.notFound', params: {} })
    expect(code(() => parseDeviceName(''))).toEqual({ code: 'remote.device.invalidName', params: { max: REMOTE_LIMITS.maxDeviceNameLength } })
    expect(code(() => parseDesktopNameInput({ name: 'x'.repeat(33) }))).toEqual({ code: 'remote.desktop.invalidName', params: { max: 32 } })
    expect(code(() => parseSetPhoneWriteInput({ paneId: 'a b', allowed: true }))).toEqual({ code: 'remote.pane.invalid', params: {} })
    for (const run of [() => parseDeviceId(5), () => parseDeviceName(null), () => parseDesktopNameInput({ name: 5 }), () => parseSetPhoneWriteInput({ paneId: 5, allowed: true }),
      () => parseRenameInput({ deviceId: '00000000-0000-4000-8000-000000000000', name: 'a', extra: 1 })]) {
      expect(code(run)).toBeNull()
    }
  })
})

describe('websocket upgrade', () => {
  test('only GET, and never from a browser page; `ws` checks the rest of the handshake', () => {
    const req = (headers: Record<string, string>, method = 'GET') => ({ method, headers }) as never
    expect(upgradeRefusal(req({}))).toBeNull()
    expect(upgradeRefusal(req({}, 'POST'))).toBe(405)
    expect(upgradeRefusal(req({ origin: 'null' }))).toBe(403)
  })
})

describe('connection', () => {
  const host = (overrides: Partial<ConnectionHost> = {}): ConnectionHost => ({
    desktopName: 'Desk', now: () => 0, isRevoked: () => false, takeCommand: () => ({ ok: true }), topic: () => undefined,
    authenticate: () => ({ ok: true, deviceId: 'd', expiresAt: 10, result: { accessToken: 't', expiresInMs: 10 } }),
    authenticated: () => {}, seen: () => {}, closed: () => {}, ...overrides
  })
  const socket = () => { const sent: Array<Record<string, unknown>> = []; const closes: number[] = []; return { sent, closes, socket: { sendText: (text: string) => { sent.push(JSON.parse(text)); return true }, close: (code?: number) => { closes.push(code ?? 0) }, isOpen: true } satisfies FrameSocket } }

  test('closes when nobody authenticates within authTimeoutMs', () => {
    vi.useFakeTimers()
    const out = socket()
    const connection = new RemoteConnection('10.0.0.2', host())
    connection.attach(out.socket)
    connection.receive(JSON.stringify({ type: 'hello', versions: [1] }))
    vi.advanceTimersByTime(REMOTE_LIMITS.authTimeoutMs)
    expect(out.sent.at(-1)).toEqual({ type: 'error', code: 'unauthenticated' })
    expect(out.closes).toEqual([1008])
    connection.closed()
  })

  test('a frame flood ends the connection', () => {
    const out = socket()
    const connection = new RemoteConnection('10.0.0.2', host())
    connection.attach(out.socket)
    connection.receive(JSON.stringify({ type: 'hello', versions: [1] }))
    connection.receive(JSON.stringify({ type: 'auth', id: 'a', accessToken: 't' }))
    for (let index = 0; index < 700; index += 1) connection.receive(JSON.stringify({ type: 'unsubscribe', id: `u${index}`, subscription: 'x' }))
    expect(out.sent.some(frame => frame.code === 'rate-limited')).toBe(true)
    expect(out.closes.length).toBeGreaterThan(0)
    connection.closed()
  })

  test('forbidden names are found anywhere in arguments', () => {
    expect(mentionsForbidden({ a: [{ b: 'secrets.read' }] })).toBe(true)
    expect(mentionsForbidden({ 'policy.edit': 1 })).toBe(true)
    expect(mentionsForbidden({ text: 'please secrets.read' })).toBe(false)
    let deep: unknown = 'x'
    for (let index = 0; index < 40; index += 1) deep = [deep]
    expect(mentionsForbidden(deep)).toBe(true)
  })
})
