import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { rmSync, writeFileSync } from 'node:fs'
import { launchReal, openRepo, quitReal, realProfile } from './real-app'
// From the product tree (acceptance.yml checks out product_ref whole and copies only e2e/acceptance from spec_ref).
import { request, TestSocket, type Target } from '../../tests/helpers/remote-client'
import { readPairingUri } from '../../shared/remote/protocol'

/**
 * HML · 1.4.3 gate (study #628, decisions P1 and P4), black box on the REAL app, on disposable CI runners only.
 *
 * - P4: a phone that subscribes to a BUSY terminal gets the screen at once (an optional `snapshot: { ansi, cols, rows }`
 *   on subscribe), not a replay it has to wait through. The phone is a stand-in in this file: it pairs with the real
 *   gateway (pinned TLS, the real pairing POST, the desktop answers through its own IPC) and signs in over WebSocket.
 * - P1 (Windows only): with the network set to Public and no inbound rule, Settings › Devices says so and shows the
 *   exact rule; on consent the rule is added, scoped to OXESpace (the program), TCP 47321 and the Private profile;
 *   Undo removes it. The runner is admin with UAC off: this proves the scope and the undo, NOT the consent prompt.
 *
 * Nothing here runs on a person's machine: the runner's firewall and network profile are changed (disposable VM).
 */
const onRunner = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true'
const notes: string[] = []
const note = (line: string) => { notes.push(line); console.log('HML', line) }
const flush = (info: TestInfo, name: string) => { writeFileSync(info.outputPath(`${name}.txt`), notes.join('\n')); info.annotations.push({ type: name, description: notes.join('\n') }); notes.length = 0 }

type Remote = {
  setEnabled(i: { enabled: boolean }): Promise<Record<string, unknown>>
  startPairing(): Promise<{ uri: string; expiresAt: number }>
  answerPairing(i: { promptId: string; accept: boolean }): Promise<void>
  status(): Promise<Record<string, unknown>>
}
const remote = <T>(page: Page, fn: keyof Remote, arg?: unknown) => page.evaluate(([f, a]) => (window as unknown as { oxe: { remote: Record<string, (x?: unknown) => Promise<unknown>> } }).oxe.remote[f as string](a), [fn, arg] as const) as Promise<T>

/** Pairs a stand-in phone with the real desktop and signs it in. */
async function pairStandInPhone(page: Page): Promise<{ socket: TestSocket; target: Target }> {
  await page.evaluate(() => {
    const w = window as unknown as { __prompt: unknown; oxe: { remote: { onChanged(l: (c: { pairing?: unknown }) => void): void } } }
    w.__prompt = null
    w.oxe.remote.onChanged(c => { if (c.pairing) w.__prompt = c.pairing })
  })
  const status = await remote<Record<string, unknown>>(page, 'setEnabled', { enabled: true })
  note(`gateway: ${JSON.stringify(status).slice(0, 400)}`)
  // A Linux runner has no keyring: the gateway can't store its keys (remote.storage.unavailable). Not a product bug.
  test.skip(JSON.stringify(status.error ?? '').includes('remote.storage.unavailable'), 'no OS keyring on this runner: the gateway cannot store its keys')
  const offer = await remote<{ uri: string }>(page, 'startPairing')
  const parsed = readPairingUri(offer.uri)
  if (!parsed.ok) throw new Error('the pairing URI did not parse: ' + offer.uri.slice(0, 80))
  const qr = parsed.qr
  // The gateway listens on the address it advertises (the LAN one), as a real phone would reach it.
  const target: Target = { host: qr.host, port: qr.port, fp: qr.fp }
  note(`offer: host=${qr.host} port=${qr.port}`)
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url')
  // The person answers on the desktop when the prompt shows (accept: same device, codes compared by the person).
  let stop = false
  const answering = (async () => {
    for (let i = 0; i < 60 && !stop; i++) {
      const prompt = await page.evaluate(() => (window as unknown as { __prompt: { promptId: string } | null }).__prompt)
      if (prompt) { await remote(page, 'answerPairing', { promptId: prompt.promptId, accept: true }); return true }
      await new Promise(r => setTimeout(r, 250))
    }
    return false
  })().catch(e => `answer failed: ${(e as Error).message.split('\n')[0]}`)
  const res = await request({ host: target.host, port: target.port, fp: target.fp }, { body: JSON.stringify({ code: qr.code, deviceName: 'HML stand-in', publicKey }) })
    .catch(e => { stop = true; throw new Error(`pair POST to ${target.host}:${target.port} failed: ${(e as Error).message}`) })
  const answered = await answering
  note(`pair POST: ${res.status} (desktop answered: ${answered})`)
  const body = res.body as { accessToken?: string; deviceId?: string }
  if (!body?.accessToken) throw new Error(`pairing failed: ${res.status} ${res.text.slice(0, 200)}`)
  const socket = await TestSocket.connect(target)
  await socket.ask({ type: 'hello', versions: [1] })
  const auth = await socket.ask({ type: 'auth', id: 'a', accessToken: body.accessToken })
  // Never log the token itself.
  note(`auth: ${String(auth.type)}`)
  return { socket, target }
}

/** Frames until `done`, with a deadline. */
async function framesUntil(socket: TestSocket, done: (frame: Record<string, unknown>, all: Record<string, unknown>[]) => boolean, ms: number): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = []
  const end = Date.now() + ms
  while (Date.now() < end) {
    const frame = await socket.next(Math.max(1, end - Date.now())).catch(() => null)
    if (!frame) break
    all.push(frame)
    if (done(frame, all)) break
  }
  return all
}

test.describe('1.4.3 gate', () => {
  test('P4: a phone subscribing to a busy terminal gets its screen at once', async ({}, info) => {
    test.skip(!onRunner && process.env.OXESPACE_ACCEPT_FIREWALL !== '1', 'turns the gateway on: CI runners only (or OXESPACE_ACCEPT_FIREWALL=1)')
    test.setTimeout(240_000)
    const profile = realProfile('hml-p4')
    const { app, page } = await launchReal(profile)
    let socket: TestSocket | undefined
    try {
      await openRepo(page, profile.repo)
      const paneId = await page.evaluate(() => (window as unknown as { oxe: { workspace: { list(): Promise<Array<{ panes: Array<{ id: string }> }>> } } }).oxe.workspace.list().then(l => l[0].panes[0].id))
      // A busy terminal: a fast loop with colour and cursor moves, far more than one screen.
      const loop = process.platform === 'win32'
        ? '1..4000 | % { Write-Host ("`e[32mline $_`e[0m " + ("x" * 50)) }\r'
        : 'for i in $(seq 1 4000); do printf "\\033[32mline %s\\033[0m %s\\n" $i xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx; done\r'
      await page.waitForTimeout(2_000)
      await page.evaluate(([id, data]) => (window as unknown as { oxe: { terminal: { write(i: { paneId: string; data: string }): Promise<void> } } }).oxe.terminal.write({ paneId: id, data }), [paneId, loop] as const)
      await page.waitForTimeout(6_000)
      ;({ socket } = await pairStandInPhone(page))
      const asked = Date.now()
      const ack = await socket.ask({ type: 'subscribe', id: 's1', topic: 'terminal', target: paneId })
      note(`subscribe ack: ${JSON.stringify(ack).slice(0, 160)}`)
      const ended = (f: Record<string, unknown>) => f.type === 'snapshot' && (!(f.page as { last?: boolean } | undefined) || (f.page as { last: boolean }).last)
      // `ask` returns the first frame after the subscribe: the ack, or already the snapshot.
      const frames = [ack, ...(ended(ack) ? [] : await framesUntil(socket, f => ended(f), 15_000))]
      const first = frames[0]
      const withScreen = frames.find(f => (f as { snapshot?: unknown }).snapshot || ((f.data as { snapshot?: unknown } | undefined)?.snapshot))
      const bytes = frames.reduce((n, f) => n + JSON.stringify(f).length, 0)
      note(`first frame after ${first ? Date.now() - asked : -1} ms: ${first ? JSON.stringify(first).slice(0, 200) : 'none'}`)
      note(`frames until the snapshot ended: ${frames.length}, ${bytes} bytes`)
      const screen = withScreen ? ((withScreen as { snapshot?: unknown }).snapshot ?? (withScreen.data as { snapshot?: unknown }).snapshot) as { ansi?: string; cols?: number; rows?: number } : undefined
      note(`P4 snapshot: ${screen ? `cols=${screen.cols} rows=${screen.rows} ansi=${(screen.ansi ?? '').length} chars` : 'NONE'}`)
      expect.soft(screen, 'P4: the subscribe answer carries a screen snapshot { ansi, cols, rows }').toBeTruthy()
      if (screen) {
        expect.soft(typeof screen.ansi === 'string' && screen.ansi.length > 0, 'the snapshot has the screen\'s ANSI').toBe(true)
        expect.soft((screen.cols ?? 0) > 0 && (screen.rows ?? 0) > 0, 'the snapshot has the grid size').toBe(true)
        // BACKEND: the last line written is in `ansi` as plain text, maybe wrapped in SGR; match with escapes stripped.
        const plain = (screen.ansi ?? '').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\u001b[\]P^_][^\u0007\u001b]*(\u0007|\u001b\\)/g, '')
        const latest = Math.max(0, ...[...plain.matchAll(/line (\d+)/g)].map(m => Number(m[1])))
        note(`P4 snapshot shows up to "line ${latest}"`)
        expect.soft(latest, 'the snapshot shows the last line of the busy output').toBe(4000)
        const first = frames.find(f => f.type === 'snapshot')
        expect.soft(Boolean((first?.data as { snapshot?: unknown } | undefined)?.snapshot), 'the screen sits on the FIRST snapshot frame, under data').toBe(true)
      }
      await page.screenshot({ path: info.outputPath('p4-desktop.png') })
    } finally {
      socket?.close()
      flush(info, 'p4-report')
      await quitReal(app)
      rmSync(profile.root, { recursive: true, force: true })
    }
  })

  test('P4 compatibility: a 1.4.2 phone (no snapshot reading) still gets the terminal from the replay, then live', async ({}, info) => {
    test.skip(!onRunner && process.env.OXESPACE_ACCEPT_FIREWALL !== '1', 'turns the gateway on: CI runners only (or OXESPACE_ACCEPT_FIREWALL=1)')
    test.setTimeout(240_000)
    const profile = realProfile('hml-p4-compat')
    const { app, page } = await launchReal(profile)
    let socket: TestSocket | undefined
    try {
      await openRepo(page, profile.repo)
      const paneId = await page.evaluate(() => (window as unknown as { oxe: { workspace: { list(): Promise<Array<{ panes: Array<{ id: string }> }>> } } }).oxe.workspace.list().then(l => l[0].panes[0].id))
      const write = (data: string) => page.evaluate(([id, d]) => (window as unknown as { oxe: { terminal: { write(i: { paneId: string; data: string }): Promise<void> } } }).oxe.terminal.write({ paneId: id, data: d }), [paneId, data] as const)
      const loop = process.platform === 'win32' ? '1..1500 | % { "compat line $_" }\r' : 'for i in $(seq 1 1500); do echo "compat line $i"; done\r'
      // The phone connection is on BEFORE the output, as for a person who keeps it on. (On 1.4.2, output written while
      // it was off never reached a phone: the replay came back empty, run 41915926840.)
      await remote(page, 'setEnabled', { enabled: true })
      await page.waitForTimeout(2_000); await write(loop); await page.waitForTimeout(5_000)
      ;({ socket } = await pairStandInPhone(page))
      // Exactly what a 1.4.2 phone does: subscribe, then read only `data.data` of each frame. Any extra field is ignored.
      const ack = await socket.ask({ type: 'subscribe', id: 'old', topic: 'terminal', target: paneId })
      note(`subscribe: ${JSON.stringify(ack).slice(0, 120)}`)
      let text = typeof (ack.data as { data?: unknown } | undefined)?.data === 'string' ? (ack.data as { data: string }).data : ''
      const ended = (f: Record<string, unknown>) => f.type === 'snapshot' && (!(f.page as { last?: boolean } | undefined) || (f.page as { last: boolean }).last)
      const frames = ended(ack) ? [] : await framesUntil(socket, f => ended(f), 15_000)
      for (const f of frames) { const d = (f.data as { data?: unknown } | undefined)?.data; if (typeof d === 'string') text += d }
      for (const f of frames.slice(0, 3)) note(`frame shape: ${JSON.stringify(f, (k, v) => typeof v === 'string' && v.length > 80 ? `${v.slice(0, 80)}…(${v.length})` : v).slice(0, 300)}`)
      const desk = await page.evaluate((id) => (window as unknown as { oxe: { terminal: { attach(i: { paneId: string }): Promise<{ replay?: string }> } } }).oxe.terminal.attach({ paneId: id }).then(r => (r.replay ?? '').slice(-200)), paneId).catch(e => `attach failed: ${String(e)}`)
      note(`desktop pane tail: ${JSON.stringify(desk)}`)
      const latest = Math.max(0, ...[...text.matchAll(/compat line (\d+)/g)].map(m => Number(m[1])))
      note(`replay: ${frames.length + 1} frames, ${text.length} chars of terminal text, latest "compat line ${latest}"`)
      expect.soft(latest, 'the replay alone reaches the end of the busy output').toBe(1500)
      // Then live output reaches the old phone as events.
      await write(process.platform === 'win32' ? 'Write-Host HML-COMPAT-LIVE\r' : 'echo HML-COMPAT-LIVE\r')
      const live = await framesUntil(socket, f => typeof (f.data as { data?: unknown } | undefined)?.data === 'string' && ((f.data as { data: string }).data).includes('HML-COMPAT-LIVE'), 10_000)
      const got = live.some(f => typeof (f.data as { data?: unknown } | undefined)?.data === 'string' && ((f.data as { data: string }).data).includes('HML-COMPAT-LIVE'))
      note(`live after the replay: ${got ? 'received' : 'NOT received'} (${live.length} frames)`)
      expect.soft(got, 'live output reaches a phone that reads only data.data').toBe(true)
    } finally {
      socket?.close()
      flush(info, 'p4-compat-report')
      await quitReal(app)
      rmSync(profile.root, { recursive: true, force: true })
    }
  })

  test('P1: Public is explained, then on Private the rule is shown, added on consent, scoped, verified, removed', async ({}, info) => {
    test.skip(process.platform !== 'win32', 'Windows firewall only')
    test.skip(!onRunner, 'changes the machine\'s firewall and network profile: CI runners only, never a person\'s machine')
    test.setTimeout(300_000)
    const ps = (cmd: string) => { try { return execFileSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim() } catch (e) { return `ERROR ${(e as Error).message.split('\n')[0]}` } }
    const category = (c: 'Public' | 'Private') => ps(`Get-NetConnectionProfile | Set-NetConnectionProfile -NetworkCategory ${c}; Get-NetConnectionProfile | ForEach-Object { $_.InterfaceAlias + '=' + $_.NetworkCategory }`)
    const rules = () => ps("Get-NetFirewallRule -Direction Inbound -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match 'OXESpace' } | ForEach-Object { $r=$_; $p=($r | Get-NetFirewallPortFilter); $a=($r | Get-NetFirewallApplicationFilter); '{0} | enabled={1} | action={2} | profile={3} | {4} {5} | program={6}' -f $r.DisplayName,$r.Enabled,$r.Action,$r.Profile,$p.Protocol,$p.LocalPort,$a.Program }")
    note(`rules at start: ${rules() || '(none)'}`)
    note(`set Public → ${category('Public')}`)
    // FRONTEND (#632): the check is hidden in a dev build; the e2e build needs a test switch honoured only unpackaged.
    const profile = realProfile('hml-p1', process.env.HML_P1_SWITCH ? { [process.env.HML_P1_SWITCH]: '1' } : {})
    const { app, page } = await launchReal(profile)
    try {
      await app.evaluate(({ dialog }) => { dialog.showMessageBox = (() => Promise.resolve({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox })
      await remote(page, 'setEnabled', { enabled: true })
      await page.keyboard.press('Control+,'); await page.waitForTimeout(800)
      await page.getByRole('button', { name: /^(Devices|Dispositivos)/ }).locator('visible=true').first().click()
      // The check re-reads each time a pairing code shows.
      await remote(page, 'startPairing').catch(() => undefined)
      const check = page.getByTestId('devices-firewall-check')
      const shown = await check.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false)
      note(`devices-firewall-check visible: ${shown}`)
      expect(shown, 'P1: the firewall check is on Settings › Devices (dev builds hide it unless the test switch is set)').toBe(true)

      // 1. Public: explained, no repair.
      const pub = check.getByRole('alert').first()
      await expect.soft(pub, 'Public title').toContainText('This network is Public, so Windows blocks phones', { timeout: 10_000 })
      await expect.soft(pub, 'Public text says to set it to Private').toContainText('set it to Private')
      await expect.soft(pub).toContainText("OXESpace doesn't change it for you")
      await expect.soft(check.getByRole('button', { name: 'Allow on private networks' }), 'no repair on Public').toHaveCount(0)
      await page.screenshot({ path: info.outputPath('p1-1-public.png') })

      // 2. Private, no rule: the exact rule before consent.
      note(`set Private → ${category('Private')}`)
      const again = check.getByRole('button', { name: 'Check again' })
      if (await again.count()) await again.first().click(); else await remote(page, 'startPairing').catch(() => undefined)
      await expect.soft(check, 'no-rule title').toContainText("Windows Firewall doesn't let phones in yet", { timeout: 15_000 })
      await expect.soft(check, 'the exact rule is shown before consent').toContainText('Adds one rule: OXESpace.exe, TCP 47321, Private networks only.')
      await expect.soft(check, 'the UAC line').toContainText('Windows will ask for permission. Nothing changes if you say No.')
      await page.screenshot({ path: info.outputPath('p1-2-private-no-rule.png') })

      // 3. Consent: the dialog with the exact command, then Allow.
      await check.getByRole('button', { name: 'Allow on private networks' }).click()
      const dlg = page.getByRole('dialog', { name: 'Allow phones on private networks?' })
      await expect.soft(dlg, 'confirm dialog').toBeVisible({ timeout: 5_000 })
      const command = await page.getByTestId('devices-firewall-command').innerText().catch(() => '(no command shown)')
      note(`command shown: ${command}`)
      expect.soft(command, 'the exact PowerShell line is shown').toMatch(/New-NetFirewallRule/)
      await page.screenshot({ path: info.outputPath('p1-3-consent.png') })
      await dlg.getByRole('button', { name: 'Allow', exact: true }).click()
      await page.waitForTimeout(5_000)
      const added = rules(); note(`rules after Allow: ${added || '(none)'}`)
      expect.soft(added, 'the rule exists').toMatch(/OXESpace/)
      expect.soft(added, 'it allows').toMatch(/action=Allow/)
      expect.soft(added, 'TCP 47321 only').toMatch(/TCP 47321/)
      expect.soft(added, 'Private profile only').toMatch(/profile=Private(\s|\||$)/)
      expect.soft(added, 'scoped to the program').toMatch(/program=.+\.exe/i)
      const verified = await page.getByText('Verified: phones can now reach this computer on private networks').first().waitFor({ timeout: 15_000 }).then(() => 'verified', async () => (await page.getByTestId('devices-firewall-outcome').innerText().catch(() => 'no outcome')))
      note(`re-check after repair: ${verified}`)
      expect.soft(verified, 'the re-check verifies the rule').toBe('verified')
      await page.screenshot({ path: info.outputPath('p1-4-repaired.png') })

      // 4. Undo.
      await page.getByRole('button', { name: 'Remove the rule' }).first().click()
      const rm = page.getByRole('dialog', { name: 'Remove the firewall rule?' })
      await expect.soft(rm, 'remove dialog').toBeVisible({ timeout: 5_000 })
      await rm.getByRole('button', { name: 'Remove', exact: true }).click()
      await page.waitForTimeout(4_000)
      const after = rules(); note(`rules after Remove: ${after || '(none)'}`)
      expect.soft(after, 'Remove takes the rule away').not.toMatch(/TCP 47321/)
      const removed = await page.getByText('Verified: the firewall rule is removed').first().waitFor({ timeout: 10_000 }).then(() => true, () => false)
      note(`removal verified message: ${removed}`)
      expect.soft(removed, 'the removal is verified').toBe(true)
      await page.screenshot({ path: info.outputPath('p1-5-removed.png') })
    } finally {
      flush(info, 'p1-report')
      await quitReal(app)
      rmSync(profile.root, { recursive: true, force: true })
    }
  })
})
