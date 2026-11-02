import { expect, test, type Page } from '@playwright/test'
import { createHash, generateKeyPairSync, X509Certificate } from 'node:crypto'
import https from 'node:https'
import tls from 'node:tls'
import { launchReal, quitReal, realProfile } from './real-app'

/**
 * B9.2 · #458 · A phone that pairs but never signs in is revoked after 2 minutes. REAL app, black box. The gateway on
 * this machine's private address. A stand-in phone in the test process: real TLS with the certificate pinned by the QR's
 * fingerprint and POST /pair, like tests/helpers/remote-client.ts. The person answers the pairing in the window.
 * - The device is listed and holds a slot; after 2 min with no sign-in it leaves the list and the slot.
 * - The window gets remote.pairing.failed {reason: expired}.
 * - Quitting with an unused pairing leaves no device at the next launch.
 * Turning the gateway on shows the OS firewall prompt, so this runs on CI only.
 * The phone's side (`revoked` on its token) needs the device: decision #10.
 */
type Qr = { host: string; port: number; fp: string; code: string }
const readQr = (uri: string): Qr => { const q = new URLSearchParams(uri.slice(uri.indexOf('?') + 1)); return { host: q.get('host')!, port: Number(q.get('port')), fp: q.get('fp')!, code: q.get('code')! } }

function pair(qr: Qr, deviceName: string): Promise<{ status: number; body: unknown }> {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url')
  const body = JSON.stringify({ code: qr.code, deviceName, publicKey })
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: qr.host, port: qr.port, rejectUnauthorized: false }, () => {
      const cert = new X509Certificate(socket.getPeerCertificate(true).raw)
      if (createHash('sha256').update(cert.raw).digest('hex') !== qr.fp) { socket.destroy(); reject(new Error('certificate pin mismatch')); return }
      const req = https.request({ host: qr.host, port: qr.port, method: 'POST', path: '/pair', agent: false, rejectUnauthorized: false,
        headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) }, createConnection: () => socket }, res => {
        let text = ''; res.on('data', d => { text += d }); res.on('end', () => { let parsed: unknown = text; try { parsed = JSON.parse(text) } catch { /* text */ } resolve({ status: res.statusCode ?? 0, body: parsed }) })
      })
      req.on('error', reject); req.end(body)
    })
    socket.once('error', reject)
  })
}

const oxe = <T>(page: Page, expression: string) => page.evaluate(expression) as Promise<T>

/** The person accepts in the window; the prompt the window shows is read from main's change event. */
async function acceptInWindow(page: Page): Promise<string> {
  const via = await page.getByRole('button', { name: /^(Pair|Parear|Accept|Aceitar)/ }).first().click({ timeout: 8_000 }).then(() => 'button', () => '')
  if (via) return via
  const promptId = await oxe<string | null>(page, 'window.__pairPrompt ? window.__pairPrompt.promptId : null')
  if (!promptId) return 'no prompt'
  await oxe(page, `window.oxe.remote.answerPairing({ promptId: ${JSON.stringify(promptId)}, accept: true })`)
  return 'answerPairing'
}

test('B9.2/#458: a pairing never signed in is revoked after 2 min; quitting drops one too', async () => {
  test.skip(process.env.GITHUB_ACTIONS !== 'true', 'the gateway shows the OS firewall prompt; CI only')
  test.setTimeout(600_000)
  const profile = realProfile('b92', { OXESPACE_LOCALE: 'en-US' })
  let { app, page } = await launchReal(profile)
  const out: Record<string, unknown> = {}
  try {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (() => new Promise(() => undefined)) as typeof dialog.showMessageBox
      dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync
    })
    await oxe(page, `(() => { window.__fails = []; window.__pairPrompt = null
      window.oxe.remote.onPairingFailed(m => window.__fails.push(m))
      window.oxe.remote.onChanged(c => { if (c.pairing !== undefined) window.__pairPrompt = c.pairing }) })()`)
    out.enabled = await oxe(page, 'window.oxe.remote.setEnabled({ enabled: true }).then(s => JSON.stringify(s).slice(0, 200))')
    // Settings › Devices open, so the pairing question shows where the person answers it.
    await page.keyboard.press('Control+,')
    await page.getByRole('button', { name: /^Devices/ }).first().click().catch(() => undefined)
    const offer = await oxe<{ uri: string }>(page, 'window.oxe.remote.startPairing()')
    const qr = readQr(offer.uri)
    out.host = qr.host
    const answered = pair(qr, 'HML Phone')
    await page.waitForTimeout(1_500)
    out.acceptedVia = await acceptInWindow(page)
    const paired = await answered
    out.paired = { status: paired.status, keys: Object.keys(paired.body as object) }
    expect(paired.status, 'the phone is paired').toBe(200)
    const pairedAt = Date.now()
    out.devicesAfterPair = await oxe(page, 'window.oxe.remote.devices().then(l => l.map(d => d.name))')
    out.slotsAfterPair = await oxe(page, 'window.oxe.remote.status().then(s => s.devices)')
    expect.soft(out.devicesAfterPair, 'listed while waiting for its first sign-in').toEqual(['HML Phone'])

    // No sign-in: past 2 minutes the gateway revokes it on its own.
    while (Date.now() < pairedAt + 125_000) await page.waitForTimeout(5_000)
    out.devicesAfter = await oxe(page, 'window.oxe.remote.devices().then(l => l.map(d => d.name))')
    out.slotsAfter = await oxe(page, 'window.oxe.remote.status().then(s => s.devices)')
    out.fails = await oxe(page, 'window.__fails')
    out.devicesScreen = (await page.locator('body').innerText()).match(/HML Phone/) ? 'still shown' : 'not shown'
    expect.soft(out.devicesAfter, 'it left the list').toEqual([])
    expect.soft(out.slotsAfter, 'and freed its slot').toBe(0)
    expect.soft(JSON.stringify(out.fails), 'the window is told it expired').toMatch(/remote\.pairing\.failed[\s\S]*expired/)
    expect.soft(out.devicesScreen, 'Settings › Devices no longer shows it').toBe('not shown')

    // Quitting with an unused pairing: nothing is left at the next launch.
    const offer2 = await oxe<{ uri: string }>(page, 'window.oxe.remote.startPairing()')
    const answered2 = pair(readQr(offer2.uri), 'HML Phone 2')
    await page.waitForTimeout(1_500)
    out.acceptedVia2 = await acceptInWindow(page)
    out.paired2 = (await answered2).status
    out.devicesBeforeQuit = await oxe(page, 'window.oxe.remote.devices().then(l => l.map(d => d.name))')
    // A person's quit (app.quit, so before-quit and will-quit run), not app.exit.
    const proc = app.process()
    await app.evaluate(({ app }) => { setTimeout(() => app.quit(), 50) }).catch(() => undefined)
    const quitStart = Date.now()
    while (proc.exitCode === null && Date.now() - quitStart < 20_000) await new Promise(r => setTimeout(r, 250))
    out.quitMs = proc.exitCode === null ? 'did not exit' : Date.now() - quitStart
    await quitReal(app)
    ;({ app, page } = await launchReal(profile))
    out.devicesAfterRelaunch = await oxe(page, 'window.oxe.remote.devices().then(l => l.map(d => d.name))')
    expect.soft(out.devicesBeforeQuit, 'the second phone was paired').toEqual(['HML Phone 2'])
    expect.soft(out.devicesAfterRelaunch, 'quitting dropped the unused pairing').toEqual([])

    // #476: an abrupt end (a crash or a kill: app.exit, no quit handlers). Relaunched past the 2 min, the device that
    // never signed in is revoked at launch.
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (() => new Promise(() => undefined)) as typeof dialog.showMessageBox
      dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync
    })
    await oxe(page, 'window.oxe.remote.setEnabled({ enabled: true })')
    await page.keyboard.press('Control+,')
    await page.getByRole('button', { name: /^Devices/ }).first().click().catch(() => undefined)
    const offer3 = await oxe<{ uri: string }>(page, 'window.oxe.remote.startPairing()')
    const answered3 = pair(readQr(offer3.uri), 'HML Phone 3')
    await page.waitForTimeout(1_500)
    out.acceptedVia3 = await acceptInWindow(page)
    out.paired3 = (await answered3).status
    const paired3At = Date.now()
    out.devicesBeforeCrash = await oxe(page, 'window.oxe.remote.devices().then(l => l.map(d => d.name))')
    await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
    await quitReal(app)
    while (Date.now() < paired3At + 125_000) await new Promise(r => setTimeout(r, 5_000))
    ;({ app, page } = await launchReal(profile))
    await page.waitForTimeout(3_000)
    out.devicesAfterCrash = await oxe(page, 'window.oxe.remote.devices().then(l => l.map(d => d.name))')
    out.slotsAfterCrash = await oxe(page, 'window.oxe.remote.status().then(s => s.devices)')
    expect.soft(out.devicesBeforeCrash, 'the third phone was paired').toEqual(['HML Phone 3'])
    expect.soft(out.devicesAfterCrash, 'after a crash, the unused pairing past 2 min is revoked at launch').toEqual([])
    expect.soft(out.slotsAfterCrash, 'and its slot is free').toBe(0)
  } finally {
    console.log('B92', JSON.stringify(out).slice(0, 3000))
    await quitReal(app)
  }
})
