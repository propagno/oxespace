import { describe, expect, it } from 'vitest'
import { createHash, generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto'
import {
  isCertificateFingerprint,
  isDerSignature,
  isDevicePublicKey,
  isHelloChallenge,
  isPairingCode,
  pairingVerification,
  pairingUri,
  readPairingUri,
  readPairRequest,
  refreshSigningInput,
  REMOTE_PAIRING_ERROR_CODES,
  REMOTE_PAIRING_SCHEME,
  REMOTE_WS_PATH,
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

describe('C5 pairing', () => {
  const fp = createHash('sha256').update('certificate DER').digest('hex')
  const code = randomBytes(16).toString('base64url')
  const publicKey = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64url')

  it('takes a fingerprint only as 64 lowercase hex characters', () => {
    expect(isCertificateFingerprint(fp)).toBe(true)
    for (const value of [fp.toUpperCase(), fp.slice(1), `${fp}0`, fp.replace(/.$/, 'g'), `${fp.slice(0, 62)}::`, '', null]) expect(isCertificateFingerprint(value), String(value)).toBe(false)
  })

  it('sizes the code, the challenge and the device key as the CCR sets them', () => {
    expect(isPairingCode(code)).toBe(true)
    expect(isPairingCode(randomBytes(15).toString('base64url'))).toBe(false)
    expect(isPairingCode('+/'.repeat(11))).toBe(false)
    expect(isPairingCode(`${code.slice(0, 21)}=`)).toBe(false)
    expect(isHelloChallenge(randomBytes(32).toString('base64url'))).toBe(true)
    expect(isHelloChallenge(code)).toBe(false)
    expect(isDevicePublicKey(publicKey)).toBe(true)
    const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64url')
    expect(isDevicePublicKey(rsa)).toBe(false)
  })

  it('writes and reads the QR URI, and refuses a tampered or incomplete one', () => {
    const qr = { v: 1, host: '192.168.0.10', port: 47_321, fp, code, name: 'Estudos PC' }
    const uri = pairingUri(qr)
    expect(uri.startsWith(`${REMOTE_PAIRING_SCHEME}://pair?`)).toBe(true)
    expect(readPairingUri(uri)).toEqual({ ok: true, qr })
    const { name: _name, ...unnamed } = qr
    expect(readPairingUri(pairingUri(unnamed))).toEqual({ ok: true, qr: unnamed })
    for (const bad of [
      uri.replace('oxespace://', 'https://'), uri.replace(`fp=${fp}`, `fp=${fp.toUpperCase()}`), uri.replace(`fp=${fp}`, 'fp='),
      uri.replace('port=47321', 'port=70000'), uri.replace('port=47321', 'port=0'), uri.replace('v=1', 'v=0'),
      uri.replace('host=192.168.0.10', 'host=evil.test%2Fpath'), uri.replace(`code=${code}`, 'code=short'),
      pairingUri({ ...qr, name: 'x'.repeat(65) }), `${uri}${'&pad=1'.repeat(200)}`
    ]) expect(readPairingUri(bad).ok, bad).toBe(false)
  })

  it('reads a pairing request and calls anything else malformed', () => {
    expect(readPairRequest({ code, deviceName: 'Pixel 8', publicKey })).toEqual({ ok: true, request: { code, deviceName: 'Pixel 8', publicKey } })
    for (const body of [null, [], 'x', {}, { code, deviceName: 'Pixel 8' }, { code, deviceName: 'Pixel 8', publicKey, extra: 1 },
      { code, deviceName: '', publicKey }, { code, deviceName: '   ', publicKey }, { code, deviceName: 'x'.repeat(65), publicKey }, { code, deviceName: 'a\u0007b', publicKey },
      { code: 'short', deviceName: 'Pixel 8', publicKey }, { code, deviceName: 'Pixel 8', publicKey: 'AAAA' }]) {
      expect(readPairRequest(body), JSON.stringify(body)).toEqual({ ok: false, code: 'malformed' })
    }
    expect(REMOTE_PAIRING_ERROR_CODES).toEqual(['pairing-expired', 'pairing-used', 'pairing-refused', 'pairing-locked', 'too-many-devices', 'malformed', 'pairing-invalid'])
    expect(REMOTE_WS_PATH).toBe('/v1/ws')
    expect(REMOTE_LIMITS.pairingAttemptsPerWindow).toBe(5)
  })

  it('binds a refresh signature to the certificate, the device and the connection', () => {
    const { privateKey, publicKey: key } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const nonce = randomBytes(32).toString('base64url')
    const text = refreshSigningInput(fp, 'device-1', nonce)
    expect(text).toBe(`oxespace-refresh:1:${fp}:device-1:${nonce}`)
    const signature = sign('sha256', Buffer.from(text), privateKey)
    expect(verify('sha256', Buffer.from(text), key, signature)).toBe(true)
    expect(verify('sha256', Buffer.from(refreshSigningInput(fp, 'device-1', randomBytes(32).toString('base64url'))), key, signature)).toBe(false)
  })

  it('takes a refresh signature only as DER, never as raw r and s', () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    for (let round = 0; round < 20; round += 1) {
      const der = sign('sha256', randomBytes(32), privateKey)
      expect(isDerSignature(der.toString('base64url'))).toBe(true)
      const raw = sign('sha256', randomBytes(32), { key: privateKey, dsaEncoding: 'ieee-p1363' })
      expect(raw.length).toBe(64)
      expect(isDerSignature(raw.toString('base64url'))).toBe(false)
    }
    for (const value of ['', 'MAY', 'MEQCIA', 'not base64!', 'A'.repeat(200), null, 7]) expect(isDerSignature(value), String(value)).toBe(false)
  })

  it('derives the same 6-character verification from the device key on both sides', () => {
    const digest = (key: string) => createHash('sha256').update(Buffer.from(key, 'base64url')).digest()
    const code = pairingVerification(digest(publicKey))
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/)
    expect(pairingVerification(digest(publicKey))).toBe(code)
    const other = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64url')
    expect(pairingVerification(digest(other))).not.toBe(code)
    // Fixed vector for the Kotlin side: first 30 bits of 0xFFFFFFFF... are all ones.
    expect(pairingVerification(new Uint8Array(32).fill(255))).toBe('ZZZZZZ')
    expect(pairingVerification(new Uint8Array(32))).toBe('000000')
    const vector = new Uint8Array(32); vector.set([0x12, 0x34, 0x56, 0x78])
    expect(pairingVerification(vector)).toBe('28T5CY')
    expect(() => pairingVerification(new Uint8Array(31))).toThrow()
  })
})
