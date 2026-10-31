import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { launchReal, quitReal, realProfile } from './real-app'

/**
 * S2 exit check (B17 + F32 + F19) · Closing OXESpace never loses the agents or the work.
 * Roadmap acceptance: close with 6 agent panes, started both ways, and reopen → each pane is back on its own session
 * or says why not; a split past the capacity closes without error.
 *
 * REAL app, no paid run. `claude` and `codex` on PATH are stand-ins: each records its arguments, reports a
 * SessionStart to the app's real hook server with the pane's own execution credentials (as the real CLIs' hooks do),
 * and stays alive. The app records the sessions itself (pane_agent_sessions); nothing is seeded.
 * "Both ways": 3 panes started by OXESpace (wizard agents), 3 started by the person typing the command in a shell.
 * Before reopening, one transcript is deleted: that pane must say why it started fresh.
 */
const STANDIN = String.raw`
const fs = require('fs'), path = require('path'), crypto = require('crypto')
const [agent, log] = [process.env.ACC_AGENT, process.env.ACC_LOG]
const args = process.argv.slice(2)
const i = agent === 'claude' ? args.indexOf('--resume') : args.indexOf('resume')
const id = i >= 0 ? args[i + 1] : crypto.randomUUID()
fs.appendFileSync(log, JSON.stringify({ agent, pane: process.env.OXESPACE_EXECUTION_ID, args, id }) + '\n')
const dir = agent === 'claude' ? path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', process.cwd().replace(/[^A-Za-z0-9]/g, '-')) : path.join(process.env.CODEX_HOME, 'sessions')
fs.mkdirSync(dir, { recursive: true })
if (i < 0) fs.writeFileSync(path.join(dir, id + '.jsonl'), JSON.stringify({ type: 'session_meta', sessionId: id, cwd: process.cwd() }) + '\n')
fetch('http://127.0.0.1:' + process.env.OXESPACE_AGENT_HOOK_PORT + '/hook', { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ executionId: process.env.OXESPACE_EXECUTION_ID, token: process.env.OXESPACE_EXECUTION_TOKEN, workspaceId: process.env.OXESPACE_WORKSPACE_ID,
    agent: agent === 'claude' ? 'claude-code' : 'codex', payload: { hook_event_name: 'SessionStart', source: i >= 0 ? 'resume' : 'startup', session_id: id, cwd: process.cwd() } }) }).catch(() => undefined)
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
const launches = (log: string) => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l) as { agent: string; pane: string; args: string[]; id: string }) : []
const paneIds = (page: Page) => page.evaluate(() => (window as unknown as { oxe: { workspace: { list: () => Promise<Array<{ panes: Array<{ id: string }> }>> } } }).oxe.workspace.list().then(l => l[0]?.panes.map(p => p.id) ?? []))
const panes = (page: Page) => page.locator('[data-testid="pane-container"]')

test('S2: six agent panes, started both ways, come back on their own sessions or say why', async () => {
  test.setTimeout(300_000)
  const base = realProfile('s2', { OXESPACE_LOCALE: 'pt-BR' })
  const { bin, log } = standins(base.root)
  const profile = { ...base, env: { ...base.env, PATH: `${bin}${delimiter}${base.env.PATH ?? ''}`, ACC_LOG: log } }
  let { app, page } = await launchReal(profile)
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
    await page.waitForTimeout(5_000)
    // Started by the person: type the command in the three plain shells.
    const started = new Set(launches(log).map(l => l.pane))
    const ids = await paneIds(page)
    const plain = ids.map((id, i) => ({ id, i })).filter(p => !started.has(p.id))
    expect(plain.length, 'three panes are plain shells').toBe(3)
    for (const [k, p] of plain.entries()) {
      await panes(page).nth(p.i).locator('.xterm').click()
      await page.keyboard.type(k === 2 ? 'codex' : 'claude'); await page.keyboard.press('Enter')
    }
    await expect.poll(() => launches(log).length, { timeout: 20_000 }).toBe(6)
  } finally { await quitReal(app) }

  const first = launches(log)
  const sessions = new Map(first.map(l => [l.pane, l]))
  // One session's transcript is gone when the app comes back (deleted on disk).
  const gone = first[1]
  const transcript = gone.agent === 'claude'
    ? join(base.env.CLAUDE_CONFIG_DIR, 'projects', profile.repo.replace(/[^A-Za-z0-9]/g, '-'), `${gone.id}.jsonl`)
    : join(base.env.CODEX_HOME, 'sessions', `${gone.id}.jsonl`)
  rmSync(transcript, { force: true })
  writeFileSync(log, '')

  ;({ app, page } = await launchReal(profile))
  try {
    const offer = page.getByRole('button', { name: /Retomar|Resume/ }).first()
    if (await offer.isVisible({ timeout: 5_000 }).catch(() => false)) await offer.click()
    await expect.poll(() => launches(log).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(5)
    const second = launches(log)
    for (const [pane, before] of sessions) {
      const again = second.find(l => l.pane === pane || l.id === before.id)
      if (before === gone) {
        expect(again?.args.includes(before.id) ?? false, 'the deleted session is not resumed').toBe(false)
        continue
      }
      const want = before.agent === 'claude' ? ['--resume', before.id] : ['resume', before.id]
      expect(again?.args.slice(0, 2), `${before.agent} pane is back on its own session`).toEqual(want)
    }
    const headers = await panes(page).allInnerTexts()
    expect(headers.filter(h => /retomad|retomou/i.test(h)).length, 'five panes say they resumed').toBe(5)
    expect(headers.some(h => /não (foi possível|encontr)|apagad/i.test(h)), 'the sixth says why it is new').toBe(true)
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
      await close.focus(); await page.keyboard.press('Enter')
      const confirm = page.getByRole('dialog').getByRole('button', { name: /^Fechar|Encerrar/ })
      if (await confirm.isVisible({ timeout: 1_000 }).catch(() => false)) await confirm.click()
      await expect(panes(page), `closing at ${n} panes removes one`).toHaveCount(n - 1, { timeout: 5_000 })
    }
    expect(out.join('').match(/UNIQUE constraint[^\n]*/g) ?? [], 'no database error in main').toEqual([])
  } finally { await quitReal(app) }
})
