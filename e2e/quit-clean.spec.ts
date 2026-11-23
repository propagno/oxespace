// OXE-392: an ordinary quit exits cleanly, every time. node-pty 1.1.0 hands a terminal's exit to JS from its waitpid
// thread; an exit that arrived while the JS environment was going away threw an uncaught C++ Napi::Error out of
// SetupExitCallback/CallJS and the app died with SIGABRT (1 of 15 quits in ag06's probe; the abort itself was not
// reproduced in 104 later rounds). The fix drains every terminal's exit before teardown, so these cases prove the
// ordering: at will-quit no terminal process is left to report. The repeated quit also counts any
// "terminate called after throwing" in stderr, and times each quit (median and max are printed for the PR).
// Real shells (OXESPACE_E2E_MOCK_NATIVE=0), four panes, a fresh profile per spec.
import { mkdirSync, mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { withoutLiveApp } from './helpers/live-app-env'

// 60 rounds per OS for the proof (OXE_QUIT_ROUNDS=60); a few in the smoke run, where every spec shares the shard.
const ROUNDS = Number(process.env.OXE_QUIT_ROUNDS ?? 5)
const TERMINATE = 'terminate called after throwing'

function profile(): { root: string; repo: string; marks: string } {
  const root = mkdtempSync(join(tmpdir(), 'oxe-quit-clean-'))
  const repo = join(root, 'repo'), marks = join(root, 'marks')
  mkdirSync(repo, { recursive: true }); mkdirSync(marks, { recursive: true })
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
  execFileSync('git', ['-c', 'user.email=e2e@example.invalid', '-c', 'user.name=e2e', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: repo })
  return { root, repo, marks }
}

interface Launched { app: ElectronApplication; page: Page; stderr: () => string }
async function launch(p: { root: string }): Promise<Launched> {
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e', 'electron-main.cjs')], env: {
    ...withoutLiveApp(process.env), TZ: 'UTC', OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '0', OXESPACE_LOCALE: 'en-US',
    OXESPACE_DB_PATH: join(p.root, 'oxespace.sqlite3'), CLAUDE_CONFIG_DIR: join(p.root, 'claude-config'), CODEX_HOME: join(p.root, 'codex-home'),
    ANTHROPIC_API_KEY: '', OPENAI_API_KEY: ''
  } })
  let stderr = ''
  app.process().stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
  const page = await app.firstWindow()
  await page.waitForLoadState('load')
  await page.setViewportSize({ width: 1500, height: 900 })
  return { app, page, stderr: () => stderr }
}

const paneIds = (page: Page) => page.evaluate(() => (window as unknown as { oxe: { workspace: { list: () => Promise<Array<{ panes: Array<{ id: string; type: string }> }>> } } })
  .oxe.workspace.list().then(list => (list[0]?.panes ?? []).filter(pane => pane.type === 'terminal').map(pane => pane.id)))
const running = (page: Page, id: string) => page.evaluate(paneId => (window as unknown as { oxe: { terminal: { status: (id: string) => Promise<{ running: boolean }> } } })
  .oxe.terminal.status(paneId).then(status => status.running), id)
const write = (page: Page, paneId: string, data: string) => page.evaluate(([id, text]) => (window as unknown as { oxe: { terminal: { write: (input: { paneId: string; data: string }) => Promise<void> } } })
  .oxe.terminal.write({ paneId: id, data: text }), [paneId, data] as const)

/** Four live shells: the workspace is made on the first launch and comes back on the next ones. */
async function liveShells(page: Page, repo: string): Promise<string[]> {
  await page.getByTestId('btn-new-workspace').first().waitFor({ timeout: 30_000 })
  if ((await paneIds(page)).length === 0) {
    await page.getByTestId('btn-new-workspace').first().click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-layout-card-4').click()
    await page.getByTestId('wizard-launch-btn').click()
  }
  await page.waitForSelector('[data-testid="workspace-grid"], [data-testid="workspace-split-grid"]', { timeout: 30_000 })
  let ids: string[] = []
  await expect.poll(async () => { ids = await paneIds(page); return ids.length }, { timeout: 30_000 }).toBe(4)
  for (const id of ids) await expect.poll(() => running(page, id), { timeout: 30_000, message: `shell ${id} runs` }).toBe(true)
  return ids
}

interface QuitReport { code: number | null; signal: NodeJS.Signals | null; ms: number; stderr: string; clean: boolean; describe: () => string }
/** Quits as a person does (app.quit()) and reports how the process ended: its exit code, signal, time and stderr. */
async function quitAndReport(launched: Launched): Promise<QuitReport> {
  const child = launched.app.process()
  const ended = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) resolve({ code: child.exitCode, signal: child.signalCode })
    else child.once('exit', (code, signal) => resolve({ code, signal }))
  })
  const started = Date.now()
  await launched.app.evaluate(({ app }) => { app.quit() }).catch(() => undefined)
  const { code, signal } = await ended
  const ms = Date.now() - started
  await launched.app.close().catch(() => undefined)
  const stderr = launched.stderr()
  const clean = code === 0 && signal === null && !stderr.includes(TERMINATE)
  return { code, signal, ms, stderr, clean, describe: () => `exit code ${code}, signal ${signal}, ${ms} ms; stderr:\n${stderr.slice(-4000) || '(empty)'}` }
}

const median = (values: number[]): number => { const sorted = [...values].sort((a, b) => a - b); const mid = sorted.length >> 1; return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2) }

test.describe.configure({ mode: 'serial' })

test('an ordinary quit exits cleanly, repeated', async () => {
  test.setTimeout(Math.max(120_000, ROUNDS * 20_000))
  const p = profile()
  const times: number[] = []
  let terminates = 0
  for (let round = 1; round <= ROUNDS; round++) {
    const launched = await launch(p)
    try {
      await liveShells(launched.page, p.repo)
    } catch (error) {
      await launched.app.close().catch(() => undefined)
      throw error
    }
    const report = await quitAndReport(launched)
    times.push(report.ms)
    if (report.stderr.includes(TERMINATE)) terminates++
    expect(report.clean, `round ${round} of ${ROUNDS}: ${report.describe()}`).toBe(true)
  }
  const summary = `[quit-clean] ${process.platform}: ${ROUNDS} rounds, quit median ${median(times)} ms, max ${Math.max(...times)} ms, "${TERMINATE}" ${terminates}`
  console.log(summary)
  test.info().annotations.push({ type: 'quit-time', description: summary })
  expect(terminates).toBe(0)
})

test('an abnormal exit is reported with its exit code and stderr', async () => {
  test.setTimeout(120_000)
  const p = profile()
  const launched = await launch(p)
  await liveShells(launched.page, p.repo)
  // The app dies at will-quit, as the abort did: the report must say how it ended and what it printed.
  await launched.app.evaluate(({ app }) => { app.once('will-quit', () => { process.stderr.write('oxe392 abnormal-exit probe\n'); process.abort() }) })
  const report = await quitAndReport(launched)
  expect(report.clean).toBe(false)
  const text = report.describe()
  expect(text).toContain('oxe392 abnormal-exit probe')
  expect(text).toMatch(process.platform === 'win32' ? /exit code -?[1-9]\d*/ : /signal SIGABRT/)
})

test('at will-quit no terminal process is left to report its exit', async () => {
  test.skip(process.platform === 'win32', 'the shells report their pid with $$ (POSIX shells)')
  test.setTimeout(120_000)
  const p = profile()
  const launched = await launch(p)
  const ids = await liveShells(launched.page, p.repo)
  for (const [index, id] of ids.entries()) await write(launched.page, id, `echo $$ > '${join(p.marks, `shell-${index}.pid`)}'\n`)
  await expect.poll(() => ids.every((_, index) => existsSync(join(p.marks, `shell-${index}.pid`))), { timeout: 15_000 }).toBe(true)
  const pids = ids.map((_, index) => Number(readFileSync(join(p.marks, `shell-${index}.pid`), 'utf8').trim()))
  const out = join(p.marks, 'alive-at-will-quit.json')
  await launched.app.evaluate(({ app }, [shellPids, file]) => {
    app.once('will-quit', () => {
      const alive = (shellPids as number[]).filter(pid => { try { process.kill(pid, 0); return true } catch { return false } })
      const fs = (process as unknown as { getBuiltinModule: (id: string) => typeof import('node:fs') }).getBuiltinModule('node:fs')
      fs.writeFileSync(file as string, JSON.stringify(alive))
    })
  }, [pids, out] as const)
  const report = await quitAndReport(launched)
  expect(report.clean, report.describe()).toBe(true)
  expect(JSON.parse(readFileSync(out, 'utf8')), 'shell processes still alive at will-quit (their exit would reach a dying JS)').toEqual([])
})
