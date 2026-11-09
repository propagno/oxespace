import { expect, test, type Page } from '@playwright/test'
import { generateKeyPairSync } from 'node:crypto'
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchReal, openRepo, quitReal, realProfile } from './real-app'
// From the product tree (acceptance.yml checks out product_ref whole and copies only e2e/acceptance from spec_ref).
import { request, TestSocket, type Target } from '../../tests/helpers/remote-client'
import { readPairingUri } from '../../shared/remote/protocol'

/**
 * HML · 1.5.0 F10 M10 (BE-A46-c5 #706, HML-658-3 and HML-706-1/2): a terminal agent's conversation reaches the phone,
 * black box on the REAL app and its REAL gateway, while the agent is busy. No agent and no account:
 * - the session reaches the desktop the way Claude Code reports it: the pane itself pipes a SessionStart through the app's
 *   own resources/agent-hooks/oxespace-status-hook.cjs (every shell pane carries the hook port and execution token);
 * - the session file is the agent's JSONL under the profile's CLAUDE_CONFIG_DIR, and this spec is the agent writing it:
 *   70 messages, then appends every 200 ms with some lines written in two halves (HML-706-1);
 * - the phone is the R143 stand-in: it pairs with the real gateway on its advertised LAN address and signs in.
 * Checks: the pane is marked conversation; newest page then Load earlier to cursor null, every message once; a secret
 * never reaches the phone; while busy, change events keep coming (no starvation) and carry no content; paging during the
 * appends neither repeats nor skips; a half-written last line is never shown and appears exactly once when completed;
 * a new session gives a higher epoch. Windows runners only (the gateway needs the OS keyring).
 */
const onRunner = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true'
const HOOK = join(process.cwd(), 'resources', 'agent-hooks', 'oxespace-status-hook.cjs')
const ID = '7c2f0e1a-4b5d-4c3e-9f80-1a2b3c4d5e6f'
const ID2 = '9d8e7f60-5a4b-4c3d-8e2f-0a1b2c3d4e5f'
const SECRET = 'sk-ant-api03-HMLF10' + 'x'.repeat(40)
const notes: string[] = []
const note = (line: string) => { notes.push(line); console.log('HML', line) }

type Frame = Record<string, unknown>
type Page_ = { items: Array<{ seq: number; item: { id: string; text?: string } }>; cursor: string | null; epoch: number }
const remote = <T>(page: Page, fn: string, arg?: unknown) => page.evaluate(([f, a]) => (window as unknown as { oxe: { remote: Record<string, (x?: unknown) => Promise<unknown>> } }).oxe.remote[f as string](a), [fn, arg] as const) as Promise<T>

/** Frames that arrived while waiting for a command's answer, kept for the event counts. */
const side: Frame[] = []
let counter = 0
async function command(socket: TestSocket, name: string, args: unknown): Promise<Frame> {
  const id = `c${++counter}`
  socket.send({ type: 'command', id, command: name, args })
  for (let i = 0; i < 200; i++) {
    const frame = await socket.next(10_000)
    if (frame.id === id) return frame
    side.push(frame)
  }
  throw new Error(`no answer to ${name}`)
}
async function drain(socket: TestSocket, ms: number): Promise<Frame[]> {
  const all: Frame[] = [...side.splice(0)]
  const end = Date.now() + ms
  while (Date.now() < end) {
    const frame = await socket.next(Math.max(1, end - Date.now())).catch(() => null)
    if (!frame) break
    all.push(frame)
  }
  return all
}

/** Pairs a stand-in phone with the real desktop and signs it in (the R143 flow). */
async function pairStandInPhone(page: Page): Promise<TestSocket> {
  await page.evaluate(() => {
    const w = window as unknown as { __prompt: unknown; oxe: { remote: { onChanged(l: (c: { pairing?: unknown }) => void): void } } }
    w.__prompt = null
    w.oxe.remote.onChanged(c => { if (c.pairing) w.__prompt = c.pairing })
  })
  const status = await remote<Frame>(page, 'setEnabled', { enabled: true })
  test.skip(JSON.stringify(status.error ?? '').includes('remote.storage.unavailable'), 'no OS keyring on this runner')
  const offer = await remote<{ uri: string }>(page, 'startPairing')
  const parsed = readPairingUri(offer.uri)
  if (!parsed.ok) throw new Error('the pairing URI did not parse')
  const target: Target = { host: parsed.qr.host, port: parsed.qr.port, fp: parsed.qr.fp }
  note(`gateway on ${target.host}:${target.port}`)
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url')
  const answering = (async () => {
    for (let i = 0; i < 60; i++) {
      const prompt = await page.evaluate(() => (window as unknown as { __prompt: { promptId: string } | null }).__prompt)
      if (prompt) { await remote(page, 'answerPairing', { promptId: prompt.promptId, accept: true }); return true }
      await new Promise(r => setTimeout(r, 250))
    }
    return false
  })()
  const res = await request(target, { body: JSON.stringify({ code: parsed.qr.code, deviceName: 'HML F10 stand-in', publicKey }) })
  await answering
  const body = res.body as { accessToken?: string }
  if (!body?.accessToken) throw new Error(`pairing failed: ${res.status}`)
  const socket = await TestSocket.connect(target)
  await socket.ask({ type: 'hello', versions: [1] })
  const auth = await socket.ask({ type: 'auth', id: 'a', accessToken: body.accessToken })
  note(`auth: ${String(auth.type)}`) // never the token
  return socket
}

/** The agent's session file, under every spelling of the repo path main may encode (8.3 short names on Windows). */
function sessionFiles(claudeHome: string, repo: string, id: string): string[] {
  const spellings = [...new Set([repo, realpathSync.native(repo)])]
  return spellings.map(path => {
    const folder = join(claudeHome, 'projects', path.replace(/[^a-zA-Z0-9]/g, '-'))
    mkdirSync(folder, { recursive: true })
    return join(folder, `${id}.jsonl`)
  })
}
const line = (id: string, uuid: string, text: string, cwd: string) => JSON.stringify({ type: 'assistant', uuid, sessionId: id, cwd, message: { content: text } })

/** The pane sends the agent's hook event, through the app's own hook script, as Claude Code does. */
async function hookFromPane(page: Page, dir: string, event: Frame): Promise<void> {
  const file = join(dir, `ev-${Date.now()}.json`)
  writeFileSync(file, JSON.stringify(event))
  const send = join(dir, 'send.cjs')
  writeFileSync(send, `const { spawnSync } = require('node:child_process'); const fs = require('node:fs');\nspawnSync(process.execPath, [${JSON.stringify(HOOK)}, 'claude'], { input: fs.readFileSync(process.argv[2]), stdio: ['pipe', 'ignore', 'ignore'] })\n`)
  await page.locator('.xterm').first().click()
  await page.keyboard.type(`node "${send}" "${file}"`)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1_500)
}

test('F10 M10: a busy terminal agent\'s conversation reaches the phone, paged, redacted, with no repeats or losses', async () => {
  test.skip(!onRunner || process.platform !== 'win32', 'turns the gateway on: Windows CI runners only (the OS keyring)')
  test.setTimeout(300_000)
  const profile = realProfile('hml-f10')
  const claudeHome = profile.env.CLAUDE_CONFIG_DIR
  const events = mkdtempSync(join(tmpdir(), 'hml-f10-ev-'))
  const { app, page } = await launchReal(profile)
  let socket: TestSocket | undefined
  try {
    await openRepo(page, profile.repo)
    const files = sessionFiles(claudeHome, profile.repo, ID)
    const body = Array.from({ length: 70 }, (_, i) => line(ID, `m${i}`, i === 65 ? `the key is ${SECRET}` : `message ${i}`, profile.repo)).join('\n') + '\n'
    for (const f of files) writeFileSync(f, body)
    const append = (text: string) => { for (const f of files) appendFileSync(f, text) }
    await hookFromPane(page, events, { hook_event_name: 'SessionStart', source: 'startup', session_id: ID, cwd: profile.repo, transcript_path: files[0] })

    socket = await pairStandInPhone(page)
    // The pane that has a conversation, as the phone's workspaces topic marks it.
    let paneId: string | undefined
    for (let i = 0; i < 20 && !paneId; i++) {
      socket.send({ type: 'subscribe', id: `w${i}`, topic: 'workspaces' })
      const frames = await drain(socket, 1_500)
      const snap = frames.find(f => f.type === 'snapshot')
      const panes = ((snap?.data as { workspaces?: Array<{ panes: Array<{ id: string; conversation?: boolean }> }> })?.workspaces ?? []).flatMap(w => w.panes)
      paneId = panes.find(p => p.conversation)?.id
      if (!paneId) await page.waitForTimeout(1_000)
    }
    note(`pane with a conversation: ${paneId ?? 'none'}`)
    expect(paneId, 'the workspaces topic marks the pane whose agent has a session').toBeTruthy()

    // Newest page, then Load earlier to the oldest: every message once, and the secret nowhere.
    const first = (await command(socket, 'pane.conversation', { paneId })).result as Page_
    const earlier = (await command(socket, 'pane.conversation', { paneId, cursor: first.cursor })).result as Page_
    const ids = [...earlier.items, ...first.items].map(e => e.item.id)
    note(`pages: ${first.items.length} + ${earlier.items.length}, cursor after: ${earlier.cursor}, unique ${new Set(ids).size}`)
    expect.soft(first.items.length, 'the newest page').toBe(50)
    expect.soft(earlier.cursor, 'Load earlier reaches the oldest').toBeNull()
    expect.soft(new Set(ids).size, 'every message once').toBe(70)
    expect.soft(JSON.stringify([first, earlier]).includes(SECRET), 'the secret never reaches the phone').toBe(false)

    // Busy: the agent appends every 200 ms for 12 s, every 4th line in two halves; the phone subscribes and pages.
    socket.send({ type: 'subscribe', id: 'pc', topic: 'paneConversation', target: paneId })
    const busyStart = Date.now()
    let written = 0
    const writer = (async () => {
      while (Date.now() - busyStart < 12_000) {
        const text = line(ID, `live-${written}`, `live ${written}`, profile.repo) + '\n'
        if (written % 4 === 3) { append(text.slice(0, 20)); await new Promise(r => setTimeout(r, 100)); append(text.slice(20)) } else append(text)
        written++
        await new Promise(r => setTimeout(r, 200))
      }
    })()
    // Paging from a cursor taken before the appends, while they run: no repeats, no conversation-changed.
    await new Promise(r => setTimeout(r, 3_000))
    const midEarlier = await command(socket, 'pane.conversation', { paneId, cursor: first.cursor })
    note(`Load earlier during the appends: ${String(midEarlier.type)} ${String(midEarlier.code ?? '')}`)
    expect.soft(midEarlier.type, 'an append keeps an earlier cursor valid (HML-658-1)').toBe('ack')
    await writer
    const busyFrames = await drain(socket, 3_000)
    // The paneConversation events: data is exactly { changed: true } (the gateway's own subscription id names the stream).
    const conversationEvents = busyFrames.filter(f => f.type === 'event' && typeof f.data === 'object' && f.data !== null && 'changed' in (f.data as object))
    const changes = conversationEvents
    note(`appended ${written} lines in 12 s; change events ${changes.length}`)
    expect.soft(changes.length, 'no starvation: at least one change event per 2 s window').toBeGreaterThanOrEqual(4)
    expect.soft(changes.every(f => JSON.stringify(f.data) === '{"changed":true}'), 'events say only that it changed').toBe(true)
    const after = (await command(socket, 'pane.conversation', { paneId })).result as Page_
    const liveIds = after.items.map(e => e.item.id).filter(id => id.startsWith('live-'))
    note(`newest after the appends: ${after.items.length} items, last ${after.items.at(-1)?.item.id}`)
    expect.soft(new Set(after.items.map(e => e.item.id)).size, 'no repeats in a page').toBe(after.items.length)
    expect.soft(liveIds.length, 'the appended messages are there').toBeGreaterThan(0)

    // A half-written last line is not shown and is not an error; completed, it shows exactly once (HML-706-1).
    const half = line(ID, 'half-1', 'half written', profile.repo)
    append(half.slice(0, 30))
    const whileHalf = await command(socket, 'pane.conversation', { paneId })
    const halfShown = JSON.stringify(whileHalf).includes('half-1')
    note(`with a half line: ${String(whileHalf.type)}, shown ${halfShown}`)
    expect.soft(whileHalf.type, 'a half line is no error').toBe('ack')
    expect.soft(halfShown, 'a half line is not shown').toBe(false)
    append(half.slice(30) + '\n')
    await page.waitForTimeout(2_500)
    const completed = (await command(socket, 'pane.conversation', { paneId })).result as Page_
    const count = completed.items.filter(e => e.item.id === 'half-1' || JSON.stringify(e.item).includes('half written')).length
    expect.soft(count, 'the completed line shows exactly once').toBe(1)

    // A new session in the pane: a higher epoch, and its own messages.
    const files2 = sessionFiles(claudeHome, profile.repo, ID2)
    for (const f of files2) writeFileSync(f, line(ID2, 'n0', 'a new conversation', profile.repo) + '\n')
    await hookFromPane(page, events, { hook_event_name: 'SessionStart', source: 'clear', session_id: ID2, cwd: profile.repo, transcript_path: files2[0] })
    await page.waitForTimeout(1_500)
    const fresh = (await command(socket, 'pane.conversation', { paneId })).result as Page_
    note(`new session: epoch ${first.epoch} → ${fresh?.epoch}, items ${fresh?.items?.length}`)
    expect.soft(fresh?.epoch, 'a new session has a higher epoch').toBeGreaterThan(first.epoch)
    expect.soft(fresh?.items?.map(e => e.item.id), 'the new session\'s messages').toEqual(['n0'])
    await page.screenshot({ path: test.info().outputPath('f10-desktop.png') }).catch(() => undefined)
  } finally {
    socket?.close()
    writeFileSync(test.info().outputPath('f10.txt'), notes.join('\n'))
    test.info().annotations.push({ type: 'f10', description: notes.join('\n') })
    await quitReal(app)
  }
})
