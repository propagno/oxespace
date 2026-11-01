import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { launchReal, quitReal, realProfile } from './real-app'

/**
 * S2 exit check (B17 + F32 + F19) · Closing OXESpace never loses the agents or the work.
 * Roadmap acceptance: close with 6 agent panes, started both ways, and reopen → each pane is back on its own session
 * or says why not; a split past the capacity closes without error.
 *
 * REAL app, no paid run. `claude` and `codex` on PATH are stand-ins that behave as the real CLIs do where B17 looks:
 * - Claude uses the id main hands it (`--session-id`), else a new UUID, and keeps the transcript at
 *   <CLAUDE_CONFIG_DIR>/projects/<encoded cwd>/<id>.jsonl;
 * - Codex keeps a rollout at <CODEX_HOME>/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl;
 * - each records its arguments, reports a SessionStart to the app's real hook server with the pane's own execution
 *   credentials (as the real CLIs' hooks do), and stays alive.
 * The app records the sessions itself (pane_agent_sessions, read from the profile's own database); nothing is seeded.
 * "Both ways": 3 panes started by OXESpace (wizard agents), 3 started by the person typing the command in a shell.
 * Before reopening, one transcript is deleted: that pane must say why it started fresh.
 * What each pane did is read twice: from main (terminal.status(paneId).agentResume, B17) and on screen (F32).
 */
const STANDIN = String.raw`
const fs = require('fs'), path = require('path'), crypto = require('crypto')
const [agent, log] = [process.env.ACC_AGENT, process.env.ACC_LOG]
const args = process.argv.slice(2)
// The app probes the CLIs (--version, --help, mcp …): answer and exit, as the real ones do; that is not a session.
if (['--version', '-v', '--help', '-h', 'mcp', 'doctor', 'login', 'logout', 'auth'].includes(args[0])) { console.log('9.9.9 (stand-in)'); process.exit(0) }
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const resumed = agent === 'claude' ? flag('--resume') : flag('resume')
const id = resumed || (agent === 'claude' && flag('--session-id')) || crypto.randomUUID()
fs.appendFileSync(log, JSON.stringify({ agent, args, id, resumed: Boolean(resumed) }) + '\n')
if (!resumed) {
  if (agent === 'claude') {
    const dir = path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', process.cwd().replace(/[^a-zA-Z0-9]/g, '-'))
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, id + '.jsonl'), JSON.stringify({ type: 'summary', sessionId: id, cwd: process.cwd() }) + '\n')
  } else {
    const d = new Date(), p = n => String(n).padStart(2, '0')
    const dir = path.join(process.env.CODEX_HOME, 'sessions', String(d.getFullYear()), p(d.getMonth() + 1), p(d.getDate()))
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'rollout-' + d.toISOString().replace(/[:.]/g, '-') + '-' + id + '.jsonl'), JSON.stringify({ type: 'session_meta', payload: { id, cwd: process.cwd() } }) + '\n')
  }
}
fetch('http://127.0.0.1:' + process.env.OXESPACE_AGENT_HOOK_PORT + '/hook', { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ executionId: process.env.OXESPACE_EXECUTION_ID, token: process.env.OXESPACE_EXECUTION_TOKEN, workspaceId: process.env.OXESPACE_WORKSPACE_ID,
    agent: agent === 'claude' ? 'claude-code' : 'codex', payload: { hook_event_name: 'SessionStart', source: resumed ? 'resume' : 'startup', session_id: id, cwd: process.cwd() } }) }).catch(() => undefined)
setInterval(() => undefined, 1e9)
`

function standins(root: string) {
  const bin = join(root, 'bin'); mkdirSync(bin)
  const js = join(root, 'standin.js'); writeFileSync(js, STANDIN)
  const log = join(root, 'launches.jsonl')
  for (const agent of ['claude', 'codex']) {
    writeFileSync(join(bin, `${agent}.cmd`), `@echo off\r\nset ACC_AGENT=${agent}\r\nnode "${js}" %*\r\n`)
    writeFileSync(join(bin, agent), `#!/bin/sh\nACC_AGENT=${agent} exec node "${js}" "$@"\n`, { mode: 0o755 })
  }
  return { bin, log }
}
type Launch = { agent: string; args: string[]; id: string; resumed: boolean }
const launches = (log: string): Launch[] => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l) as Launch) : []
const paneIds = (page: Page) => page.evaluate(() => (window as unknown as { oxe: { workspace: { list: () => Promise<Array<{ panes: Array<{ id: string }> }>> } } }).oxe.workspace.list().then(l => l[0]?.panes.map(p => p.id) ?? []))
const panes = (page: Page) => page.locator('[data-testid="pane-container"]')
type Resume = { outcome: 'resumed' | 'notResumed' | 'nothingRecorded'; agent?: string; sessionId?: string; message?: { code: string } }
const agentResume = (page: Page, paneId: string) => page.evaluate(id => (window as unknown as { oxe: { terminal: { status: (id: string) => Promise<{ agentResume?: Resume } | null> } } }).oxe.terminal.status(id).then(s => s?.agentResume ?? null), paneId)
/** The sessions main recorded per pane, read from the profile's own database (read-only, the app may be running). */
function recorded(db: string): Map<string, { agent: string; sessionId: string }> {
  const handle = new DatabaseSync(db, { readOnly: true })
  try {
    const rows = handle.prepare('SELECT pane_id, agent, session_id FROM pane_agent_sessions').all() as Array<{ pane_id: string; agent: string; session_id: string }>
    return new Map(rows.map(r => [r.pane_id, { agent: r.agent, sessionId: r.session_id }]))
  } finally { handle.close() }
}
/** Two arguments next to each other, anywhere in the command line. */
const hasPair = (args: string[], a: string, b: string) => args.some((x, i) => x === a && args[i + 1] === b)

test('S2: six agent panes, started both ways, come back on their own sessions or say why', async () => {
  test.setTimeout(300_000)
  const base = realProfile('s2', { OXESPACE_LOCALE: 'pt-BR' })
  const { bin, log } = standins(base.root)
  const pathKey = Object.keys(base.env).find(k => k.toUpperCase() === 'PATH') ?? 'PATH'
  const env: Record<string, string> = { ...base.env, ACC_LOG: log }
  for (const k of Object.keys(env)) if (k.toUpperCase() === 'PATH') delete env[k]
  env[pathKey] = `${bin}${delimiter}${base.env[pathKey] ?? ''}`
  const profile = { ...base, env }
  let { app, page } = await launchReal(profile)
  let ids: string[]
  try {
    await page.getByTestId('btn-new-workspace').first().click()
    await page.getByTestId('wizard-dir-input').fill(profile.repo)
    await page.getByTestId('wizard-layout-card-6').click()
    // Started by OXESpace: two Claude panes and one Codex pane from the wizard.
    const dialog = page.getByRole('dialog')
    for (const [name, n] of [['Claude', 2], ['Codex', 1]] as const) {
      const row = dialog.locator('div', { hasText: new RegExp(`^${name}`) }).filter({ has: page.getByRole('button') }).last()
      for (let i = 0; i < n; i++) await row.getByRole('button').last().click()
    }
    await page.getByTestId('wizard-launch-btn').click()
    await expect(panes(page)).toHaveCount(6, { timeout: 20_000 })
    await expect.poll(() => launches(log).length, { timeout: 20_000, message: 'the three wizard agents started' }).toBe(3)
    ids = await paneIds(page)
    await expect.poll(() => recorded(base.db).size, { timeout: 10_000, message: 'main recorded the three wizard sessions' }).toBe(3)
    // Started by the person: type the command in the three plain shells.
    const wizard = recorded(base.db)
    const plain = ids.map((id, i) => ({ id, i })).filter(p => !wizard.has(p.id))
    expect(plain.length, 'three panes are plain shells').toBe(3)
    for (const [k, p] of plain.entries()) {
      await panes(page).nth(p.i).locator('.xterm').click()
      await page.keyboard.type(k === 2 ? 'codex' : 'claude'); await page.keyboard.press('Enter')
    }
    await expect.poll(() => launches(log).length, { timeout: 20_000 }).toBe(6)
    await expect.poll(() => recorded(base.db).size, { timeout: 10_000, message: 'main recorded all six sessions (the typed ones from their hooks)' }).toBe(6)
  } finally { await quitReal(app) }

  const sessions = recorded(base.db)
  const first = launches(log)
  for (const [pane, s] of sessions) expect(first.some(l => l.id === s.sessionId), `pane ${pane}: the recorded session is the one its CLI used`).toBe(true)
  // One session's transcript is gone when the app comes back (deleted on disk).
  const [gonePane, gone] = [...sessions][1]
  if (gone.agent === 'claude') rmSync(join(base.env.CLAUDE_CONFIG_DIR, 'projects', profile.repo.replace(/[^a-zA-Z0-9]/g, '-'), `${gone.sessionId}.jsonl`))
  else {
    const all = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? all(join(dir, e.name)) : [join(dir, e.name)])
    for (const file of all(join(base.env.CODEX_HOME, 'sessions')).filter(f => f.endsWith(`${gone.sessionId}.jsonl`))) rmSync(file)
  }
  writeFileSync(log, '')

  ;({ app, page } = await launchReal(profile))
  try {
    const offer = page.getByRole('button', { name: /Retomar|Resume/ }).first()
    if (await offer.isVisible({ timeout: 5_000 }).catch(() => false)) await offer.click()
    await expect(panes(page)).toHaveCount(6, { timeout: 20_000 })
    await expect.poll(() => launches(log).filter(l => l.resumed).length, { timeout: 30_000, message: 'five CLIs were started on their earlier session' }).toBe(5)
    const second = launches(log)
    for (const [pane, before] of sessions) {
      const want = before.agent === 'claude' ? ['--resume', before.sessionId] : ['resume', before.sessionId]
      const status = await agentResume(page, pane)
      if (pane === gonePane) {
        expect.soft(second.some(l => l.args.includes(before.sessionId)), `${before.agent} pane: the deleted session is not resumed`).toBe(false)
        expect.soft(status?.outcome, `${before.agent} pane whose transcript is gone: main says it did not resume`).toBe('notResumed')
        expect.soft(status?.message?.code, '… and why').toBe('agents.resume.sessionMissing')
        continue
      }
      expect.soft(second.some(l => hasPair(l.args, want[0], want[1])), `${before.agent} pane is back on its own session (${want.join(' ')})`).toBe(true)
      expect.soft(status, `${before.agent} pane: main reports the resume`).toMatchObject({ outcome: 'resumed', sessionId: before.sessionId })
    }
    expect.soft(second.filter(l => l.args.includes('--resume') || l.args.includes('resume')).length, 'no pane resumes another pane\'s session twice').toBe(5)
    // F32: each pane says it on screen, in its own header; the one that started fresh says why (name and tooltip).
    const order = await paneIds(page)
    for (const [pane, before] of sessions) {
      const marker = panes(page).nth(order.indexOf(pane)).getByTestId('pane-resume-marker')
      if (pane === gonePane) {
        await expect.soft(marker, `${before.agent} pane whose transcript is gone shows "not resumed"`).toHaveAttribute('data-outcome', 'notResumed')
        await expect.soft(marker, '… and why, in its accessible name').toHaveAccessibleName(/não está mais no disco|no longer on disk/i)
        await expect.soft(marker, '… and in its tooltip').toHaveAttribute('title', /não está mais no disco|no longer on disk/i)
      } else {
        await expect.soft(marker, `${before.agent} pane shows "resumed"`).toHaveAttribute('data-outcome', 'resumed')
        await expect.soft(marker, '… with its own session in the tooltip').toHaveAttribute('title', new RegExp(before.sessionId))
      }
    }
    await expect.soft(page.getByText(/a sessão anterior não foi retomada|earlier session was not resumed/i).first(), 'a notice names the pane that did not resume').toBeVisible({ timeout: 5_000 })
  } finally { await quitReal(app) }

  // A third start: no id drifts. All six come back, the fresh one now on the session it started last time.
  const third = recorded(base.db)
  expect.soft(third.get(gonePane)?.sessionId, 'the pane that started fresh recorded its new session').not.toBe(gone.sessionId)
  writeFileSync(log, '')
  ;({ app, page } = await launchReal(profile))
  try {
    await expect(panes(page)).toHaveCount(6, { timeout: 20_000 })
    await expect.poll(() => launches(log).filter(l => l.resumed).length, { timeout: 30_000, message: 'all six CLIs resume on the third start' }).toBe(6)
    for (const [pane, s] of third) {
      expect.soft(await agentResume(page, pane), `${s.agent} pane resumes the same session again`).toMatchObject({ outcome: 'resumed', sessionId: s.sessionId })
      if (pane !== gonePane) expect.soft(s.sessionId, `${s.agent} pane kept its first session id`).toBe(sessions.get(pane)?.sessionId)
    }
  } finally { await quitReal(app) }
})

test('S2: a split past the capacity closes cleanly', async () => {
  test.setTimeout(240_000)
  const profile = realProfile('s2-split', { OXESPACE_LOCALE: 'pt-BR' })
  const out: string[] = []
  const { app, page } = await launchReal(profile)
  app.process().stdout?.on('data', d => out.push(String(d))); app.process().stderr?.on('data', d => out.push(String(d)))
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 1000))
    await page.getByTestId('btn-new-workspace').first().click()
    await page.getByTestId('wizard-dir-input').fill(profile.repo)
    await page.getByTestId('wizard-layout-card-4').click()
    await page.getByTestId('wizard-launch-btn').click()
    await expect(panes(page)).toHaveCount(4, { timeout: 20_000 })
    for (let i = 0; i < 4; i++) { await panes(page).nth(i).locator('.xterm').click(); await page.keyboard.press('Control+Shift+Backslash'); await page.waitForTimeout(2_000) }
    // Past the room the window has, the app either splits or says why (F19), never errors.
    const count = await panes(page).count()
    for (let n = count; n > 0; n--) {
      await panes(page).last().getByRole('button', { name: 'Mais ações do painel' }).click()
      const close = page.getByRole('menuitem', { name: /^Fechar/ }).first()
      await close.click()
      const confirm = page.getByRole('dialog').getByRole('button', { name: /^Fechar|Encerrar/ })
      if (await confirm.isVisible({ timeout: 1_000 }).catch(() => false)) await confirm.click()
      await expect(panes(page), `closing at ${n} panes removes one ${(out.join('').match(/UNIQUE constraint[^\n]*/) ?? [''])[0]}`).toHaveCount(n - 1, { timeout: 5_000 })
    }
    expect(out.join('').match(/UNIQUE constraint[^\n]*/g) ?? [], 'no database error in main').toEqual([])
  } finally { await quitReal(app) }
})
