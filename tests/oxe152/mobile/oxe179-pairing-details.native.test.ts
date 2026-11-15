// @vitest-environment node
/**
 * Frozen acceptance test for 1.5.2 Celular A16 (OXE program oxespace-152-mobile, phase F4, Jira OXE-179 CA-1 to CA-4:
 * the paired computer's details and the pairing code's expiry through the protocol, an additive C5 change; user rule of
 * 15/11 ~05:00Z: the backend follows the design). Written by the planner; the executor must not edit it.
 *
 * Contract (shared/remote/protocol.ts, fields only added, REMOTE_PROTOCOL_VERSION stays 1):
 * - `RemotePairingQr.exp?: number`: epoch ms (the desktop's clock) when the one-time code expires. `pairingUri` writes
 *   `&exp=<integer>`; `readPairingUri` reads it as a non-negative integer and refuses a malformed one; a QR without it
 *   (an older desktop) still reads. The gateway's `startPairing()` puts its offer's `expiresAt` there.
 * - `RemoteAuthResult.desktopOs?: string` and `RemoteAuthResult.pairedAt?: number`: after a sign-in (token or refresh),
 *   the OS this desktop runs on, read from node:os and /etc/os-release (never the `platform` dependency tests fake for
 *   the firewall): `desktopOsName()` of electron/main/services/remote/os-name.ts ("Windows 11", "macOS 15", the
 *   os-release PRETTY_NAME such as "Ubuntu 24.04", or "Linux"; its branches are oxe179-os-name.test.ts), at most 64
 *   characters, never a "·", never the host name or the user; and when this phone paired, the device record's
 *   `pairedAt`. Only after sign-in: `hello` stays as it is (it reaches anyone on the network).
 * - `exp` only tells the phone; it never changes validation: PairingDesk stays the source of truth, and an expired code
 *   is refused by the desktop whatever `exp` a QR says (the guard at the end, green on main and kept).
 * - npm run android:generate brings the fields to the phone; PairingDetailsProtocolTest.kt is the phone's side.
 * CA-4 runs the phone's real protocol code (PairsWithTheRealGatewayTest.kt: PairingQrs, PairingClient over pinned TLS,
 * RemoteConnection over WSS) through Gradle against this real gateway (real TLS, real SQLite store; nothing mocked).
 * It needs Java: run with remote-verify's --java.
 *
 * Red at F4 @ origin/main 4fabc30f5: the QR has no exp (and a malformed one is accepted), the sign-in result has only
 * the token, and the phone's session carries neither detail.
 */
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { hostname, tmpdir, userInfo } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { pairingUri, readPairingUri, REMOTE_LIMITS, REMOTE_PROTOCOL_VERSION } from '../../../shared/remote/protocol'
import { Harness, signRefresh } from '../../helpers/remote-gateway-harness'

const harnesses: Harness[] = []
const harness = (...args: ConstructorParameters<typeof Harness>) => { const value = new Harness(...args); harnesses.push(value); return value }
afterEach(async () => { await Promise.all(harnesses.splice(0).map(value => value.close())) })

/** What the OS name must be on the machine the test runs on: Windows 10 or 11, macOS n, os-release's PRETTY_NAME or Linux. */
function expectedOs(): RegExp | string | null {
  if (process.platform === 'win32') return /^Windows 1[01]$/
  if (process.platform === 'darwin') return /^macOS \d+$/
  if (process.platform !== 'linux') return null
  let text: string
  try { text = readFileSync('/etc/os-release', 'utf8') } catch { return 'Linux' }
  const pretty = /^PRETTY_NAME=(.*)$/m.exec(text)?.[1]?.trim().replace(/^(["'])(.*)\1$/, '$2').trim()
  return pretty ? pretty.slice(0, 64) : 'Linux'
}

const valueOf = (uri: string, key: string) => new URLSearchParams(uri.slice(uri.indexOf('?') + 1)).get(key)

describe('OXE-179 the paired computer and the pairing code, through the protocol', () => {
  test('OXE-179 CA-2 the QR carries when the code expires', async () => {
    const h = harness({ offerWatchMs: 3_600_000 })
    await h.enable()
    const offer = h.gateway.startPairing()
    expect(offer.expiresAt).toBe(h.clock + REMOTE_LIMITS.pairingCodeTtlMs)
    expect(valueOf(offer.uri, 'exp'), `the QR: ${offer.uri}`).toBe(String(offer.expiresAt))
    const read = readPairingUri(offer.uri)
    expect(read.ok).toBe(true)
    expect((read as { qr: { exp?: number } }).qr.exp).toBe(offer.expiresAt)
  })

  test('OXE-179 CA-3 a QR without exp still reads, a malformed exp does not', () => {
    const base = pairingUri({ v: REMOTE_PROTOCOL_VERSION, host: '192.168.0.12', port: 7443, fp: 'b'.repeat(64), code: 'AbCdEfGhIjKlMnOpQrSt_-', name: 'Studio' })
    const old = readPairingUri(base)
    expect(old.ok).toBe(true)
    expect((old as { qr: { exp?: number } }).qr.exp).toBeUndefined()
    for (const bad of ['abc', '-5', '1.5', '']) expect(readPairingUri(`${base}&exp=${bad}`).ok, `exp=${bad}`).toBe(false)
    expect(readPairingUri(`${base}&exp=1&exp=2`).ok, 'a repeated exp').toBe(false)
  })

  test('OXE-179 CA-1 the sign-in result carries the OS and the pairing date', async () => {
    const h = harness()
    const target = await h.enable()
    const { res, phone } = await h.pair()
    expect(res.status).toBe(200)
    const { deviceId, accessToken } = res.body as { deviceId: string; accessToken: string }
    const device = h.gateway.devices().find(entry => entry.deviceId === deviceId)
    expect(device).toBeDefined()
    const challenge = randomBytes(32).toString('base64url')
    const refresh = h.gateway.authenticate({ type: 'auth', id: 'a-1', refresh: { deviceId, nonce: challenge, signature: signRefresh(phone, target.fp, deviceId, challenge) } }, challenge, '127.0.0.1')
    const token = h.gateway.authenticate({ type: 'auth', id: 'a-2', accessToken }, randomBytes(32).toString('base64url'), '127.0.0.1')
    for (const [how, outcome] of [['refresh', refresh], ['token', token]] as const) {
      expect(outcome.ok, how).toBe(true)
      const result = (outcome as { result: Record<string, unknown> }).result
      expect(result.pairedAt, `${how}: the pairing date is the device record's`).toBe(device!.pairedAt)
      expect(typeof result.desktopOs, `${how}: ${JSON.stringify(result)}`).toBe('string')
      const os = String(result.desktopOs)
      const expected = expectedOs()
      if (typeof expected === 'string') expect(os, `${how}: the OS this desktop runs on`).toBe(expected)
      else if (expected) expect(os, `${how}: the OS this desktop runs on`).toMatch(expected)
      expect(os.length).toBeLessThanOrEqual(64)
      expect(os).not.toContain('·')
      expect(os).not.toContain(hostname())
      expect(os).not.toContain(userInfo().username)
    }
  })

  // Gradle and the Android toolchain: opt-in (OXE_GRADLE_TESTS=1) where they are set up, the Android job or remote-verify --java.
  test.skipIf(process.env.OXE_GRADLE_TESTS !== '1')('OXE-179 CA-4 the phone\'s protocol code pairs with the real gateway and sees both details (OXE_GRADLE_TESTS=1, Android toolchain)', async () => {
    const h = harness({ offerWatchMs: 3_600_000, promptTimeoutMs: 900_000 })
    await h.enable()
    const offer = h.gateway.startPairing()
    const prompt = h.nextPrompt(900_000)
    void prompt.then(value => h.gateway.answerPairing({ promptId: value.promptId, accept: true }), () => undefined)
    const out = path.join(mkdtempSync(path.join(tmpdir(), 'oxe179-')), 'phone.txt')
    const android = path.resolve('mobile/android')
    const windows = process.platform === 'win32'
    try {
      // Asynchronous: the gateway answers on this same event loop while Gradle runs the phone's side.
      const code = await new Promise<number | null>(resolve => {
        const child = spawn(windows ? 'gradlew.bat' : './gradlew', ['--no-daemon', ':protocol:test', '--rerun', '--tests', '*PairsWithTheRealGatewayTest*'], {
          cwd: android, shell: windows, stdio: 'inherit', env: { ...process.env, OXE_E2E_PAIR_URI: offer.uri, OXE_E2E_OUT: out }
        })
        child.on('exit', resolve)
        child.on('error', () => resolve(-1))
      })
      const phone = existsSync(out) ? readFileSync(out, 'utf8') : '(the phone wrote nothing)'
      expect(code, `Gradle exit; the phone wrote:\n${phone}`).toBe(0)
      const line = (key: string) => phone.split('\n').find(entry => entry.startsWith(`${key}=`)) ?? ''
      expect(line('qr'), 'the phone read the code\'s expiry from the QR').toContain(`expiresAt=${offer.expiresAt}`)
      expect(line('pair'), 'the real gateway paired the phone').toMatch(/^pair=Paired\(/)
      const device = h.gateway.devices().find(entry => entry.name === 'Pixel e2e')
      expect(device, 'the desktop lists the phone').toBeDefined()
      const session = line('session')
      expect(session, 'the phone signed in').toMatch(/^session=Ready\(/)
      expect(session, 'the phone has the pairing date').toContain(`pairedAt=${device!.pairedAt}`)
      expect(session, 'the phone has the OS').toMatch(/desktopOs=(?!null[,)])[^,)]+/)
    } finally {
      prompt.stop()
    }
  }, 1_200_000)

  test('OXE-179 guard: the desktop refuses an expired code whatever exp the QR says', async () => {
    const h = harness({ offerWatchMs: 3_600_000 })
    await h.enable()
    const offer = h.offer()
    h.clock += REMOTE_LIMITS.pairingCodeTtlMs + 1
    const tampered = { ...offer, exp: h.clock + 3_600_000 } as typeof offer
    const { res } = await h.pair({ qr: tampered })
    expect(res.status, 'PairingDesk, not the QR, decides: an expired code is refused').toBe(410)
    expect(h.gateway.devices()).toHaveLength(0)
  })
})
