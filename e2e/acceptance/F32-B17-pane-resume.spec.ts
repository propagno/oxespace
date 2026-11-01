import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * B17 + F32 (S2) · Agent panes come back on their own sessions after the app closes, or say why not.
 * Roadmap acceptance (F32): close with 4 Claude/Codex panes on distinct sessions → reopen → each pane is back on its
 * own session; a pane with no session opens normally; a session deleted on disk → a notice and a fresh pane.
 * B17: the resume command is built by main, never by the renderer.
 *
 * No paid run: `claude` on PATH is a stand-in that only records its arguments and stays alive; CLAUDE_CONFIG_DIR points
 * at a temp folder, so even the real CLI would find no account. The sessions are recorded in the profile's
 * pane_agent_sessions table as the agent hooks would, and the transcripts are planted where Claude keeps them.
 */
const SESSIONS = ['11111111-aaaa-4aaa-8aaa-000000000001', '11111111-aaaa-4aaa-8aaa-000000000002', '11111111-aaaa-4aaa-8aaa-000000000003', '11111111-aaaa-4aaa-8aaa-000000000004']

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'oxe-acc-f32-'))
  const repo = join(root, 'repo'); mkdirSync(repo); execFileSync('git', ['init', '-q'], { cwd: repo })
  const bin = join(root, 'bin'); mkdirSync(bin)
  const args = join(root, 'claude-args.txt')
  writeFileSync(join(bin, 'claude.cmd'), `@echo off\r\necho %*>>"${args}"\r\nnode -e "setInterval(function(){},1e9)"\r\n`)
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\necho "$@" >> "${args}"\nexec node -e "setInterval(function(){},1e9)"\n`, { mode: 0o755 })
  const claudeDir = join(root, 'claude-config')
  return { root, repo, bin, args, claudeDir }
}
const launch = (s: ReturnType<typeof setup>) => electron.launch({ args: [join(process.cwd(), 'e2e', 'electron-main.cjs')], env: { ...process.env, PATH: `${s.bin}${delimiter}${process.env.PATH}`, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_DB_PATH: join(s.root, 'oxespace.sqlite3'), CLAUDE_CONFIG_DIR: s.claudeDir, OXESPACE_LOCALE: 'pt-BR' } })
const panes = (page: Page) => page.evaluate(() => (window as unknown as { oxe: { workspace: { list: () => Promise<Array<{ panes: Array<{ id: string }> }>> } } }).oxe.workspace.list().then(l => l[0]?.panes.map(p => p.id) ?? []))
const quit = (app: ElectronApplication) => app.evaluate(({ app }) => app.exit(0)).catch(() => undefined)

test('F32/B17: four Claude panes come back on their own sessions; a deleted one says why', async () => {
  const s = setup()
  let app = await launch(s)
  let ids: string[]
  try {
    const page = await app.firstWindow()
    await page.getByTestId('btn-new-workspace').first().waitFor({ timeout: 30_000 })
    await page.getByTestId('btn-new-workspace').first().click()
    await page.getByTestId('wizard-dir-input').fill(s.repo)
    await page.getByTestId('wizard-layout-card-4').click()
    const claudeRow = page.getByRole('dialog').locator('div', { hasText: /^Claude/ }).filter({ has: page.getByRole('button') }).last()
    for (let i = 0; i < 4; i++) await claudeRow.getByRole('button').last().click()
    await page.getByTestId('wizard-launch-btn').click()
    await page.waitForTimeout(6_000)
    ids = await panes(page)
    expect(ids, 'four panes').toHaveLength(4)
  } finally { await quit(app) }

  // What the hooks would have recorded: one session per pane; three transcripts exist, the fourth was deleted.
  const db = new DatabaseSync(join(s.root, 'oxespace.sqlite3'))
  ids.forEach((pane, i) => db.prepare('INSERT OR REPLACE INTO pane_agent_sessions (pane_id, agent, session_id, updated_at) VALUES (?, ?, ?, ?)').run(pane, 'claude', SESSIONS[i], Date.now()))
  db.close()
  const project = join(s.claudeDir, 'projects', s.repo.replace(/[^A-Za-z0-9]/g, '-')); mkdirSync(project, { recursive: true })
  SESSIONS.slice(0, 3).forEach(id => writeFileSync(join(project, `${id}.jsonl`), JSON.stringify({ type: 'user', sessionId: id, cwd: s.repo, message: { role: 'user', content: 'oi' } }) + '\n'))
  writeFileSync(s.args, '')

  app = await launch(s)
  try {
    const page = await app.firstWindow()
    await page.getByTestId('btn-new-workspace').first().waitFor({ timeout: 30_000 })
    // Either the app resumes on its own, or it offers one action ("Retomar 4" / "Resume 4"); both are acceptable.
    const offer = page.getByRole('button', { name: /Retomar|Resume/ }).first()
    if (await offer.isVisible({ timeout: 5_000 }).catch(() => false)) await offer.click()
    await page.waitForTimeout(6_000)
    const launched = existsSync(s.args) ? readFileSync(s.args, 'utf8') : ''
    for (const id of SESSIONS.slice(0, 3)) expect(launched, `a pane resumed ${id}`).toContain(`--resume ${id}`)
    expect(launched, 'the deleted session is not resumed').not.toContain(SESSIONS[3])
    // Each resumed pane says so; the fourth says why it started fresh.
    const headers = await page.locator('[data-testid="pane-container"]').allInnerTexts()
    expect(headers.filter(h => /retomad|retomou|resumed/i.test(h)).length, 'three panes show they resumed').toBe(3)
    expect(headers.some(h => /não (foi possível|encontr)|apagad|not found|deleted/i.test(h)), 'the fourth explains why it is new').toBe(true)
  } finally { await quit(app) }
})
