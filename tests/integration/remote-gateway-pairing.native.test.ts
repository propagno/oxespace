// @vitest-environment node
import { X509Certificate } from 'node:crypto'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { hostname, networkInterfaces } from 'node:os'
import { afterEach, describe, expect, test } from 'vitest'
import { isPrivateAddress } from '../../electron/main/services/remote/network'
import { RemoteStore } from '../../electron/main/services/remote/store'
import { MainMessageError } from '../../electron/main/ipc/main-message-error'
import { messageFromError } from '../../shared/messages'
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

describe('remote gateway: what the window is told (CCR F9)', () => {
  const failed = (reason: string) => ({ code: 'remote.pairing.failed', params: { reason } })
  /** The failures told to the window since `from`, each checked to carry the reason and nothing about the phone. */
  const toldSince = (h: Harness, from: number, phone?: { publicKey: string; name?: string }) => {
    const told = h.pairingFailures.slice(from)
    for (const message of told) {
      expect(Object.keys(message.params)).toEqual(['reason'])
      const text = JSON.stringify(message)
      for (const secret of ['127.0.0.1', '::1', 'Pixel', phone?.publicKey, phone?.name].filter(Boolean)) expect(text).not.toContain(secret)
    }
    return told
  }

  test('every failed pairing reaches the window once, with its reason only; a paired phone sends nothing', async () => {
    const h = harness({ promptTimeoutMs: 300 })
    const target = await h.enable()
    const phone = newPhone()
    let mark = h.pairingFailures.length

    // invalid: a wrong code, a malformed request, a code used twice.
    const real = h.offer()
    await h.pair({ qr: { ...real, code: 'A'.repeat(22) }, phone })
    expect(toldSince(h, mark, phone)).toEqual([failed('invalid')])
    mark = h.pairingFailures.length
    await request(target, { body: 'not json' })
    expect(toldSince(h, mark)).toEqual([failed('invalid')])
    mark = h.pairingFailures.length
    // refused: the person said no.
    const declined = await h.pair({ qr: real, accept: false, phone, name: 'Galaxy of Ana' })
    expect(declined.res.body).toEqual({ code: 'pairing-refused' })
    expect(toldSince(h, mark, { publicKey: phone.publicKey, name: 'Galaxy of Ana' })).toEqual([failed('refused')])
    mark = h.pairingFailures.length
    expect((await h.pair({ qr: real, phone })).res.body).toEqual({ code: 'pairing-used' })
    expect(toldSince(h, mark, phone)).toEqual([failed('invalid')])

    // expired: the code ran out, and the question went unanswered.
    h.passAttemptWindow()
    mark = h.pairingFailures.length
    const old = h.offer()
    h.clock += REMOTE_LIMITS.pairingCodeTtlMs + 1
    expect((await h.pair({ qr: old, phone })).res.body).toEqual({ code: 'pairing-expired' })
    expect(toldSince(h, mark, phone)).toEqual([failed('expired')])
    mark = h.pairingFailures.length
    expect((await h.pair({ accept: null, phone })).res.body).toEqual({ code: 'pairing-refused' })
    expect(toldSince(h, mark, phone)).toEqual([failed('expired')])

    // refused: cancelled from the window while the question is on screen.
    mark = h.pairingFailures.length
    const qr = h.offer()
    const prompt = h.nextPrompt()
    const pending = request(qr, { body: JSON.stringify({ code: qr.code, deviceName: 'Pixel', publicKey: phone.publicKey }) })
    await prompt
    h.gateway.cancelPairing()
    expect((await pending).body).toEqual({ code: 'pairing-refused' })
    expect(toldSince(h, mark, phone)).toEqual([failed('refused')])

    // invalid: two more wrong codes use up the address's five attempts, and then it is locked out.
    mark = h.pairingFailures.length
    const spare = h.offer()
    for (let attempt = 0; attempt < 2; attempt += 1) expect((await h.pair({ qr: { ...spare, code: 'B'.repeat(22) }, phone })).res.body).toEqual({ code: 'pairing-invalid' })
    expect((await h.pair({ qr: spare, phone })).res.body).toEqual({ code: 'pairing-locked' })
    expect(toldSince(h, mark, phone)).toEqual([failed('invalid'), failed('invalid'), failed('invalid')])

    // A phone that pairs tells the window nothing here.
    h.passAttemptWindow()
    mark = h.pairingFailures.length
    expect((await h.pair()).res.status).toBe(200)
    expect(h.pairingFailures.length).toBe(mark)

    // limit: the list filled up while the code was on screen.
    h.passAttemptWindow()
    const last = h.offer()
    const store = new RemoteStore(h.db)
    while (store.activeCount() < REMOTE_LIMITS.maxDevices) store.addDevice('Racer', newPhone().spki)
    expect((await h.pair({ qr: last, phone })).res.body).toEqual({ code: 'too-many-devices' })
    expect(toldSince(h, mark, phone)).toEqual([failed('limit')])
  })

  test('a phone that hangs up while the question is on screen: peer-closed, once, inside the same cap', async () => {
    const h = harness()
    const target = await h.enable()
    const phone = newPhone()
    const qr = h.offer()
    const prompt = h.nextPrompt()
    const socket = await connectPinned(target)
    const body = JSON.stringify({ code: qr.code, deviceName: 'Pixel', publicKey: phone.publicKey })
    const req = https.request({
      host: target.host, port: target.port, method: 'POST', path: '/pair', agent: false, rejectUnauthorized: false,
      headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) }, createConnection: () => socket
    })
    req.on('error', () => { /* hung up on purpose */ })
    req.end(body)
    await prompt
    const shownBefore = (h.gateway as unknown as { pairingFailuresShown: { count: number } }).pairingFailuresShown.count
    req.destroy()
    const deadline = Date.now() + 3000
    while (!h.pairingFailures.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
    expect(toldSince(h, 0, phone)).toEqual([failed('peer-closed')])
    expect((h.gateway as unknown as { pairingFailuresShown: { count: number } }).pairingFailuresShown.count).toBe(shownBefore + 1)
    // The question is off the screen, and nothing else follows.
    expect(h.changes.at(-1)).toEqual({ pairing: null })
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(h.pairingFailures).toHaveLength(1)
    expect(new RemoteStore(h.db).auditEntries().some(entry => entry.action === 'pairing' && entry.outcome === 'abandoned')).toBe(true)
  })

  test('a flood of bad requests reaches the window at most twenty times a minute', async () => {
    const h = harness()
    const target = await h.enable()
    for (let index = 0; index < 24; index += 1) await request(target, { body: 'not json' })
    expect(h.pairingFailures).toHaveLength(20)
    h.clock += 60_000
    await request(target, { body: 'not json' })
    expect(h.pairingFailures).toHaveLength(21)
  })

  test('refusals the person can act on carry their C3 code, also as the text Electron passes across invoke', async () => {
    const thrown = (run: () => unknown): unknown => {
      try { run() } catch (error) { return error }
      throw new Error('did not throw')
    }
    const coded = (run: () => unknown) => {
      const error = thrown(run)
      const crossed = messageFromError(new Error(`Error invoking remote method 'remote:x': ${String(error)}`))
      expect(crossed).toEqual(messageFromError(error))
      return messageFromError(error)
    }
    const h = harness()
    const unknown = '00000000-0000-4000-8000-000000000000'
    expect(coded(() => h.gateway.startPairing())).toEqual({ code: 'remote.gateway.offline', params: {} })
    expect(coded(() => h.gateway.revoke({ deviceId: unknown }))).toEqual({ code: 'remote.device.notFound', params: {} })
    expect(coded(() => h.gateway.revoke({ deviceId: 'not-a-device' }))).toEqual({ code: 'remote.device.notFound', params: {} })
    expect(coded(() => h.gateway.rename({ deviceId: unknown, name: 'Phone' }))).toEqual({ code: 'remote.device.notFound', params: {} })
    for (const name of ['', '   ', 'x'.repeat(65), 'a\nb']) {
      expect(coded(() => h.gateway.rename({ deviceId: unknown, name }))).toEqual({ code: 'remote.device.invalidName', params: { max: 64 } })
    }
    for (const name of ['', 'x'.repeat(33), 'tab\there']) {
      expect(coded(() => h.gateway.setDesktopName({ name }))).toEqual({ code: 'remote.desktop.invalidName', params: { max: 32 } })
    }
    for (const paneId of ['', 'has space', 'x'.repeat(201)]) {
      expect(coded(() => h.gateway.setPhoneWrite({ paneId, allowed: true }))).toEqual({ code: 'remote.pane.invalid', params: {} })
    }
    await h.enable()
    const store = new RemoteStore(h.db)
    while (store.activeCount() < REMOTE_LIMITS.maxDevices) store.addDevice('Phone', newPhone().spki)
    expect(coded(() => h.gateway.startPairing())).toEqual({ code: 'remote.pairing.limit', params: { max: 5 } })
  })

  test('malformed input stays a plain error, with no code', async () => {
    const h = harness()
    const unknown = '00000000-0000-4000-8000-000000000000'
    const malformed: Array<() => unknown> = [
      () => h.gateway.revoke({ deviceId: 5 }), () => h.gateway.revoke({ deviceId: unknown, extra: 1 }), () => h.gateway.revoke(null),
      () => h.gateway.rename({ deviceId: unknown, name: 5 }), () => h.gateway.rename({ deviceId: 5, name: 'Phone' }), () => h.gateway.rename({ deviceId: unknown }),
      () => h.gateway.setDesktopName({ name: 5 }), () => h.gateway.setDesktopName({}), () => h.gateway.setDesktopName({ name: 'ok', more: 1 }), () => h.gateway.setDesktopName('name'),
      () => h.gateway.setPhoneWrite({ paneId: 5, allowed: true }), () => h.gateway.setPhoneWrite({ paneId: 'p1', allowed: 'yes' }), () => h.gateway.setPhoneWrite({ paneId: 'p1' }),
      () => h.gateway.answerPairing({ promptId: unknown, accept: 'yes' })
    ]
    for (const [index, run] of malformed.entries()) {
      let caught: unknown
      try { run() } catch (error) { caught = error }
      expect(caught, `case ${index}`).toBeInstanceOf(Error)
      expect(caught, `case ${index}`).not.toBeInstanceOf(MainMessageError)
      expect(messageFromError(caught), `case ${index}`).toBeNull()
    }
    for (const input of [{ enabled: 'yes' }, { enabled: true, extra: 1 }]) {
      const error = await h.gateway.setEnabled(input).catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(Error)
      expect(messageFromError(error)).toBeNull()
    }
  })

  test('listenedBefore turns true the first time it really listens, never goes back, and survives a restart', async () => {
    const h = harness()
    expect(h.gateway.status().listenedBefore).toBe(false)
    // A start that fails is not a listen.
    expect(await h.gateway.setEnabled({ enabled: true, port: 80 })).toMatchObject({ enabled: false, listenedBefore: false })
    const noStorage = harness({ storage: fakeSafeStorage(false) })
    expect(await noStorage.gateway.setEnabled({ enabled: true, port: await freePort() })).toMatchObject({ enabled: false, listenedBefore: false })

    await h.enable()
    expect(h.gateway.status().listenedBefore).toBe(true)
    expect(h.changes.at(-1)).toMatchObject({ status: { enabled: true, listenedBefore: true } })
    expect(await h.gateway.setEnabled({ enabled: false })).toMatchObject({ enabled: false, listenedBefore: true })
    // A failed start afterwards does not take it back.
    expect(await h.gateway.setEnabled({ enabled: true, port: 80 })).toMatchObject({ enabled: false, listenedBefore: true })
    expect((h.db.prepare('SELECT listened_before FROM remote_gateway WHERE id = 1').get() as { listened_before: number }).listened_before).toBe(1)

    // The gateway service starts again on the same profile: still true, before it listens.
    await h.gateway.stop()
    h.gateway = h.create()
    expect(h.gateway.status()).toMatchObject({ enabled: false, listenedBefore: true })
    expect(await h.gateway.setEnabled({ enabled: true, port: 80 })).toMatchObject({ enabled: false, listenedBefore: true })
  })
})
