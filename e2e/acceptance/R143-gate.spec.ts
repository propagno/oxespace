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
      await page.waitForTimeout(2_000); await write(loop); await page.waitForTimeout(5_000)
      ;({ socket } = await pairStandInPhone(page))
      // Exactly what a 1.4.2 phone does: subscribe, then read only `data.data` of each frame. Any extra field is ignored.
      const ack = await socket.ask({ type: 'subscribe', id: 'old', topic: 'terminal', target: paneId })
      note(`subscribe: ${JSON.stringify(ack).slice(0, 120)}`)
      let text = typeof (ack.data as { data?: unknown } | undefined)?.data === 'string' ? (ack.data as { data: string }).data : ''
      const ended = (f: Record<string, unknown>) => f.type === 'snapshot' && (!(f.page as { last?: boolean } | undefined) || (f.page as { last: boolean }).last)
      const frames = ended(ack) ? [] : await framesUntil(socket, f => ended(f), 15_000)
      for (const f of frames) { const d = (f.data as { data?: unknown } | undefined)?.data; if (typeof d === 'string') text += d }
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

  test('P1: Public network and no rule → explained, repaired on consent, scoped, undone', async ({}, info) => {
    test.skip(process.platform !== 'win32', 'Windows firewall only')
    test.skip(!onRunner, 'changes the machine\'s firewall and network profile: CI runners only, never a person\'s machine')
    test.setTimeout(240_000)
    const ps = (cmd: string) => { try { return execFileSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim() } catch (e) { return `ERROR ${(e as Error).message.split('\n')[0]}` } }
    const rules = () => ps("Get-NetFirewallRule -Direction Inbound -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match 'OXESpace' } | ForEach-Object { $r=$_; $p=($r | Get-NetFirewallPortFilter); $a=($r | Get-NetFirewallApplicationFilter); '{0} | enabled={1} | action={2} | profile={3} | {4} {5} | program={6}' -f $r.DisplayName,$r.Enabled,$r.Action,$r.Profile,$p.Protocol,$p.LocalPort,$a.Program }")
    note(`profiles before: ${ps("Get-NetConnectionProfile | ForEach-Object { $_.InterfaceAlias + '=' + $_.NetworkCategory }")}`)
    const made = ps("Get-NetConnectionProfile | Set-NetConnectionProfile -NetworkCategory Public; Get-NetConnectionProfile | ForEach-Object { $_.InterfaceAlias + '=' + $_.NetworkCategory }")
    note(`set Public → ${made}`)
    note(`OXESpace inbound rules before: ${rules() || '(none)'}`)
    const profile = realProfile('hml-p1')
    const { app, page } = await launchReal(profile)
    try {
      await remote(page, 'setEnabled', { enabled: true })
      await page.keyboard.press('Control+,'); await page.waitForTimeout(800)
      await page.getByRole('button', { name: /^(Devices|Dispositivos)/ }).locator('visible=true').first().click()
      await page.waitForTimeout(1_500)
      const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
      const hit = text.match(/[^.]{0,160}(Public|Pública|firewall|regra|rule)[^.]{0,200}/i)?.[0] ?? '(no firewall/Public text on Devices)'
      note(`Devices says: ${hit}`)
      await page.screenshot({ path: info.outputPath('p1-devices-before.png') })
      expect.soft(/Public|Pública/i.test(text), 'P1: Devices says the network is Public').toBe(true)
      // The exact rule is shown before consent.
      expect.soft(/47321/.test(text) && /TCP/i.test(text), 'P1: the exact rule (TCP 47321) is shown').toBe(true)
      const repair = page.getByRole('button', { name: /allow|repair|add the rule|permitir|corrigir|adicionar/i }).first()
      const canRepair = await repair.isVisible().catch(() => false)
      note(`repair button: ${canRepair ? await repair.innerText() : 'none'}`)
      expect.soft(canRepair, 'P1: a repair action is offered').toBe(true)
      if (canRepair) {
        await repair.click(); await page.waitForTimeout(4_000)
        const after = rules()
        note(`rules after repair: ${after || '(none)'}`)
        expect.soft(after, 'the rule exists').toMatch(/OXESpace/)
        expect.soft(after, 'scoped to TCP 47321').toMatch(/TCP 47321/)
        expect.soft(after, 'scoped to the Private profile only').toMatch(/profile=Private\b/)
        expect.soft(after, 'scoped to the program').toMatch(/program=.+\.exe/i)
        await page.screenshot({ path: info.outputPath('p1-devices-after.png') })
        const recheck = (await page.locator('body').innerText()).replace(/\s+/g, ' ').match(/[^.]{0,120}(verified|verificad|could not be verified|não foi possível verificar)[^.]{0,120}/i)?.[0]
        note(`after repair, Devices says: ${recheck ?? '(no verified wording)'}`)
        const undo = page.getByRole('button', { name: /undo|remove the rule|desfazer|remover a regra/i }).first()
        if (await undo.isVisible().catch(() => false)) {
          await undo.click(); await page.waitForTimeout(3_000)
          const gone = rules(); note(`rules after undo: ${gone || '(none)'}`)
          expect.soft(gone, 'Undo removes the rule').not.toMatch(/TCP 47321/)
        } else { note('no Undo control'); expect.soft(false, 'P1: an Undo is offered').toBe(true) }
      }
    } finally {
      flush(info, 'p1-report')
      await quitReal(app)
      rmSync(profile.root, { recursive: true, force: true })
    }
  })
})
