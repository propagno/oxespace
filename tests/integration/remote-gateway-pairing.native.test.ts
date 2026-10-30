// @vitest-environment node
import { X509Certificate } from 'node:crypto'
import http from 'node:http'
import net from 'node:net'
import { hostname, networkInterfaces } from 'node:os'
import { afterEach, describe, expect, test } from 'vitest'
import { isPrivateAddress } from '../../electron/main/services/remote/network'
import { RemoteStore } from '../../electron/main/services/remote/store'
import { isCertificateFingerprint, isPairingCode, pairingVerification, readPairingUri, REMOTE_LIMITS } from '../../shared/remote/protocol'
import { connectPinned, peerFingerprint, request } from '../helpers/remote-client'
import { fakeSafeStorage, freePort, Harness, LOOPBACK, newPhone, spkiDigest, tcpOpen } from '../helpers/remote-gateway-harness'

const harnesses: Harness[] = []
const harness = (...args: ConstructorParameters<typeof Harness>) => { const value = new Harness(...args); harnesses.push(value); return value }
afterEach(async () => { await Promise.all(harnesses.splice(0).map(value => value.close())) })

describe('remote gateway: off by default, on only by the person', () => {
  test('off means no port at all; on listens on TLS only; off closes it again', async () => {
    const h = harness()
    h.port = await freePort()
    expect(await tcpOpen('127.0.0.1', h.port)).toBe(false)
    expect(h.gateway.status()).toMatchObject({ enabled: false, listening: null, fingerprint: null, devices: 0, maxDevices: 5 })

    const target = await h.enable()
    expect(h.gateway.status()).toMatchObject({ enabled: true, listening: { addresses: ['127.0.0.1'], port: h.port } })
    expect(isCertificateFingerprint(target.fp)).toBe(true)

    // The certificate the TLS server presents is the one whose fingerprint the status (and so the QR) carries.
    const socket = await connectPinned(target)
    const certificate = new X509Certificate(socket.getPeerX509Certificate()!.raw)
    expect(peerFingerprint(socket)).toBe(target.fp)
    socket.destroy()
    expect(certificate.publicKey.asymmetricKeyDetails?.namedCurve).toBe('prime256v1')
    expect(certificate.verify(certificate.publicKey)).toBe(true)

    // Plain HTTP gets no HTTP answer.
    const plain = await new Promise<string>(resolve => {
      const req = http.request({ host: '127.0.0.1', port: h.port, path: '/pair', method: 'POST' }, res => resolve(`answered ${res.statusCode}`))
      req.on('error', error => resolve(`error ${(error as NodeJS.ErrnoException).code ?? error.message}`))
      req.setTimeout(3000, () => { req.destroy(); resolve('timeout') })
      req.end('{}')
    })
    expect(plain).not.toMatch(/^answered/)

    // Bound to the address, never the wildcard: another loopback address on the same port finds nothing.
    if (process.platform !== 'darwin') expect(await tcpOpen('127.0.0.2', h.port)).toBe(false)

    const off = await h.gateway.setEnabled({ enabled: false })
    expect(off).toMatchObject({ enabled: false, listening: null, fingerprint: target.fp })
    expect(await tcpOpen('127.0.0.1', h.port)).toBe(false)
    const actions = new RemoteStore(h.db).auditEntries().map(entry => `${entry.action}:${entry.outcome}`)
    expect(actions).toEqual(expect.arrayContaining(['certificate:created', 'enable:ok', 'disable:ok']))
  })

  test('routes other than POST /pair answer 404/405 as JSON, without CORS', async () => {
    const h = harness()
    const target = await h.enable()
    for (const [method, path, status] of [['GET', '/', 404], ['GET', '/pair', 405], ['OPTIONS', '/pair', 405], ['POST', '/pair?x=1', 404], ['GET', '/healthz', 404]] as const) {
      const res = await request(target, { method, path, body: method === 'GET' ? '' : '{}', headers: { origin: 'https://evil.example' } })
      expect(res.status, `${method} ${path}`).toBe(status)
      expect(Object.keys(res.headers).filter(name => name.startsWith('access-control-'))).toEqual([])
      expect(res.headers['cache-control']).toBe('no-store')
    }
  })

  test('a privileged port, a port in use, no private interface or no secure storage leave it off with the C3 error', async () => {
    const h = harness()
    expect(await h.gateway.setEnabled({ enabled: true, port: 80 })).toMatchObject({ enabled: false, listening: null, error: { code: 'remote.port.privileged', params: { port: 80 } } })

    const busy = net.createServer()
    const port = await freePort()
    await new Promise<void>(resolve => busy.listen(port, '127.0.0.1', resolve))
    try {
      expect(await h.gateway.setEnabled({ enabled: true, port })).toMatchObject({ enabled: false, error: { code: 'remote.port.inUse', params: { port } } })
    } finally { await new Promise(resolve => busy.close(resolve)) }

    const noLan = harness({ isAllowedAddress: undefined, interfaces: () => LOOPBACK })
    expect(await noLan.gateway.setEnabled({ enabled: true, port: await freePort() })).toMatchObject({ enabled: false, error: { code: 'remote.network.noPrivateInterface' } })

    const noStorage = harness({ storage: fakeSafeStorage(false) })
    expect(await noStorage.gateway.setEnabled({ enabled: true, port: await freePort() })).toMatchObject({ enabled: false, error: { code: 'remote.certificate.failed' } })
    const weakLinux = harness({ platform: 'linux', env: {}, storage: { ...fakeSafeStorage(), getSelectedStorageBackend: () => 'basic_text' } })
    expect(await weakLinux.gateway.setEnabled({ enabled: true, port: await freePort() })).toMatchObject({ enabled: false, error: { code: 'remote.certificate.failed' } })

    // A successful start clears the error.
    const target = await h.enable()
    expect(h.gateway.status().error).toBeUndefined()
    expect(target.port).toBe(h.port)
  })

  test('malformed window input rejects', async () => {
    const h = harness()
    for (const input of [undefined, null, [], 'on', { enabled: 'yes' }, { enabled: true, port: 1.5 }, { enabled: true, port: -1 }, { enabled: true, port: 70_000 }, { enabled: true, extra: 1 }, { enabled: true, port: '47321' }]) {
      await expect(h.gateway.setEnabled(input), JSON.stringify(input)).rejects.toThrow()
    }
    expect(() => h.gateway.answerPairing({ promptId: 'nope', accept: true })).toThrow()
    expect(() => h.gateway.answerPairing({ promptId: '00000000-0000-4000-8000-000000000000', accept: 'yes' })).toThrow()
    expect(() => h.gateway.revoke({ deviceId: '00000000-0000-4000-8000-000000000000' })).toThrow('Unknown device')
    expect(() => h.gateway.revoke({ deviceId: '1', extra: true })).toThrow()
    expect(() => h.gateway.rename({ deviceId: '00000000-0000-4000-8000-000000000000', name: 'x' })).toThrow('Unknown device')
    expect(() => h.gateway.startPairing()).toThrow('Turn the gateway on first')
  })

  test('the certificate is made once, kept with its key encrypted, and replaced (revoking every device) when it cannot be read back', async () => {
    const h = harness()
    const first = await h.enable()
    await h.gateway.setEnabled({ enabled: false })
    expect((await h.enable()).fp).toBe(first.fp)
    const row = h.db.prepare('SELECT certificate_key FROM remote_gateway').get() as { certificate_key: Buffer }
    expect(row.certificate_key.toString('latin1')).not.toContain('PRIVATE KEY')
    expect(row.certificate_key.subarray(0, 4).toString()).toBe('ENC1')

    const { res } = await h.pair()
    expect(res.status).toBe(200)
    await h.gateway.stop()

    // Same database, new process: same certificate.
    const again = h.create()
    h.gateway = again
    expect((await h.enable()).fp).toBe(first.fp)
    await h.gateway.stop()

    // The system key changed: the stored secrets no longer decrypt.
    h.db.prepare('UPDATE remote_gateway SET certificate_key = ?').run(Buffer.from('garbage'))
    h.gateway = h.create()
    const replaced = await h.enable()
    expect(replaced.fp).not.toBe(first.fp)
    expect(h.gateway.devices()).toEqual([])
    expect(new RemoteStore(h.db).auditEntries().some(entry => entry.action === 'certificate' && entry.outcome === 'replaced')).toBe(true)
  })

  test.runIf(process.env.CI && Object.values(networkInterfaces()).flat().some(entry => entry && isPrivateAddress(entry.address)))('on a real machine it listens only on private addresses', async () => {
    const h = harness({ isAllowedAddress: undefined, interfaces: undefined })
    h.port = await freePort()
    const status = await h.gateway.setEnabled({ enabled: true, port: h.port })
    expect(status.enabled).toBe(true)
    expect(status.listening!.addresses.every(isPrivateAddress)).toBe(true)
    expect(await tcpOpen('127.0.0.1', h.port)).toBe(false)
  })
})

describe('remote gateway: pairing', () => {
  test('accepted: the person sees the phone key\'s verification code and the phone gets a device id and a token', async () => {
    const h = harness()
    await h.enable()
    const qr = h.offer()
    expect(qr).toMatchObject({ v: 1, host: '127.0.0.1', port: h.port, name: 'OXESpace' })
    expect(isPairingCode(qr.code)).toBe(true)
    const { res, phone, prompt } = await h.pair({ qr })
    expect(res.status).toBe(200)
    expect(prompt).toMatchObject({ deviceName: 'Pixel 8', verification: pairingVerification(spkiDigest(phone.spki)) })
    const body = res.body as { deviceId: string; accessToken: string; expiresInMs: number }
    expect(Object.keys(body).sort()).toEqual(['accessToken', 'deviceId', 'expiresInMs'])
    expect(body.expiresInMs).toBe(REMOTE_LIMITS.accessTokenTtlMs)
    expect(h.gateway.devices()).toEqual([expect.objectContaining({ deviceId: body.deviceId, name: 'Pixel 8', connected: false })])
    expect(h.gateway.status().devices).toBe(1)
    expect(h.changes.some(change => change.pairing === null)).toBe(true)
    expect(h.changes.at(-1)).toMatchObject({ devices: [expect.objectContaining({ deviceId: body.deviceId })], status: { devices: 1 } })
    // The code was good for that one attempt.
    expect((await h.pair({ qr })).res.body).toEqual({ code: 'pairing-used' })
  })

  test('declined, unanswered or cancelled: pairing-refused, and the code is spent', async () => {
    const h = harness({ promptTimeoutMs: 300 })
    await h.enable()
    const declined = await h.pair({ accept: false })
    expect([declined.res.status, declined.res.body]).toEqual([403, { code: 'pairing-refused' }])
    expect((await h.pair({ qr: declined.qr })).res.body).toEqual({ code: 'pairing-used' })

    const started = Date.now()
    const unanswered = await h.pair({ accept: null })
    expect(unanswered.res.body).toEqual({ code: 'pairing-refused' })
    expect(Date.now() - started).toBeGreaterThanOrEqual(250)
    expect(h.gateway.devices()).toEqual([])
    expect(h.changes.filter(change => 'pairing' in change).map(change => change.pairing === null)).toContain(true)

    // Cancelled from the window while the question is on screen.
    h.passAttemptWindow()
    const qr = h.offer()
    const prompt = h.nextPrompt()
    const pending = request(qr, { body: JSON.stringify({ code: qr.code, deviceName: 'Pixel', publicKey: newPhone().publicKey }) })
    await prompt
    h.gateway.cancelPairing()
    expect((await pending).body).toEqual({ code: 'pairing-refused' })
  })

  test('expired, cancelled and wrong codes are refused; five attempts per address lock it', async () => {
    const h = harness()
    await h.enable()
    const expired = h.offer()
    h.clock += REMOTE_LIMITS.pairingCodeTtlMs + 1
    expect((await h.pair({ qr: expired })).res).toMatchObject({ status: 410, body: { code: 'pairing-expired' } })

    const cancelled = h.offer()
    h.gateway.cancelPairing()
    expect((await h.pair({ qr: cancelled })).res).toMatchObject({ status: 403, body: { code: 'pairing-invalid' } })

    const real = h.offer()
    const wrong = { ...real, code: 'A'.repeat(22) }
    for (let attempt = 0; attempt < 3; attempt += 1) expect((await h.pair({ qr: wrong })).res.body).toEqual({ code: 'pairing-invalid' })
    // Five attempts used (expired, cancelled, three wrong): even the right code is locked out now.
    expect((await h.pair({ qr: real })).res).toMatchObject({ status: 429, body: { code: 'pairing-locked' } })
    // Wrong codes did not spend the one on screen; after the window a fresh one pairs.
    h.passAttemptWindow()
    expect((await h.pair()).res.status).toBe(200)
  })

  test('no more than five devices', async () => {
    const h = harness()
    await h.enable()
    for (let index = 0; index < 4; index += 1) {
      expect((await h.pair({ name: `Phone ${index}` })).res.status).toBe(200)
      h.passAttemptWindow()
    }
    const qr = h.offer()
    // A fifth device pairs in between (another window, a race): the code on screen meets a full list.
    new RemoteStore(h.db).addDevice('Racer', newPhone().spki)
    expect((await h.pair({ qr })).res).toMatchObject({ status: 409, body: { code: 'too-many-devices' } })
    expect(() => h.gateway.startPairing()).toThrow('Too many devices')
    expect(h.gateway.status().devices).toBe(5)
  })

  test('malformed and oversized bodies are refused before anything else', async () => {
    const h = harness()
    const target = await h.enable()
    const qr = h.offer()
    const phone = newPhone()
    const valid = { code: qr.code, deviceName: 'Pixel', publicKey: phone.publicKey }
    const cases: Array<{ body: string | Buffer; headers?: Record<string, string> }> = [
      { body: 'not json' },
      { body: JSON.stringify({ ...valid, extra: 1 }) },
      { body: JSON.stringify({ ...valid, deviceName: '' }) },
      { body: JSON.stringify({ ...valid, deviceName: 'x'.repeat(65) }) },
      { body: JSON.stringify({ ...valid, publicKey: Buffer.alloc(91, 7).toString('base64url') }) }, // right length, not a key
      { body: JSON.stringify(valid), headers: { 'content-type': 'text/plain' } },
      { body: JSON.stringify({ ...valid, deviceName: 'x'.repeat(70_000) }) }
    ]
    for (const [index, entry] of cases.entries()) {
      if (index && index % 5 === 0) h.passAttemptWindow()
      const res = await request(target, entry)
      expect([res.status, res.body], `case ${index}`).toEqual([400, { code: 'malformed' }])
    }
    // A key on another curve is refused too.
    h.passAttemptWindow()
    const fresh = h.offer()
    const { generateKeyPairSync } = await import('node:crypto')
    const p384 = generateKeyPairSync('ec', { namedCurve: 'secp384r1' }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64url')
    expect((await request(target, { body: JSON.stringify({ code: fresh.code, deviceName: 'Pixel', publicKey: p384 }) })).body).toEqual({ code: 'malformed' })
    // None of that spent the code on screen.
    expect((await h.pair({ qr: fresh })).res.status).toBe(200)
  })

  test('the phone refuses a gateway whose certificate is not the pinned one', async () => {
    const h = harness()
    const target = await h.enable()
    await expect(connectPinned({ ...target, fp: 'ab'.repeat(32) })).rejects.toThrow('certificate pin mismatch')
    await expect(request({ ...target, fp: 'ab'.repeat(32) })).rejects.toThrow('certificate pin mismatch')
    // A second gateway (another certificate) on the same address cannot pass for the first.
    const other = harness()
    const otherTarget = await other.enable()
    expect(otherTarget.fp).not.toBe(target.fp)
    await expect(connectPinned({ ...otherTarget, fp: target.fp })).rejects.toThrow('certificate pin mismatch')
  })
})

describe('remote gateway: the desktop name phones see', () => {
  test('"OXESpace" by default, the person\'s name once set, back to the default on null; never the host name', async () => {
    const h = harness()
    expect(h.gateway.status().desktopName).toBe('OXESpace')
    const target = await h.enable()
    const named = h.gateway.setDesktopName({ name: '  Office desk  ' })
    expect(named.desktopName).toBe('Office desk')
    expect(h.changes.at(-1)).toEqual({ status: expect.objectContaining({ desktopName: 'Office desk' }) })
    expect(h.offer().name).toBe('Office desk')
    const { TestSocket } = await import('../helpers/remote-client')
    const socket = await TestSocket.connect(target)
    expect(await socket.ask({ type: 'hello', versions: [1] })).toMatchObject({ desktopName: 'Office desk' })
    // Kept with the gateway settings: a new process sees it.
    await h.gateway.stop()
    h.gateway = h.create()
    expect(h.gateway.status().desktopName).toBe('Office desk')
    expect(h.gateway.setDesktopName({ name: null }).desktopName).toBe('OXESpace')
    for (const input of [{ name: 'x'.repeat(33) }, { name: '' }, { name: '   ' }, { name: 'tab\there' }, { name: 5 }, {}, { name: 'ok', more: 1 }, null, 'name']) {
      expect(() => h.gateway.setDesktopName(input), JSON.stringify(input)).toThrow()
    }
    expect(h.gateway.setDesktopName({ name: 'x'.repeat(32) }).desktopName).toHaveLength(32)
  })

  test('the host name appears in no hello, QR or status', async () => {
    const h = harness()
    const host = hostname()
    const target = await h.enable()
    const { TestSocket } = await import('../helpers/remote-client')
    const socket = await TestSocket.connect(target)
    const hello = await socket.ask({ type: 'hello', versions: [1] })
    const uri = h.gateway.startPairing().uri
    const qr = readPairingUri(uri)
    for (const text of [JSON.stringify(hello), uri, decodeURIComponent(uri), JSON.stringify(qr), JSON.stringify(h.gateway.status())]) {
      expect(text.toLowerCase()).not.toContain(host.toLowerCase())
    }
  })
})
