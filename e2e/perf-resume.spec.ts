/**
 * /resume and the context indicator on big Claude transcripts (OXE-105, the release gate). The user's report (13/11):
 * /resume froze everything; the project held 37 sessions, 1.9 GB, the largest 214 MB, and both /resume and the
 * context indicator read them whole on the main process.
 *
 * Fixture, never a live account: CLAUDE_CONFIG_DIR, HOME and USERPROFILE point at a temp folder whose
 * projects/<encoded root>/ holds one big session (GATE_RESUME_BIG_MB, default 200) and GATE_RESUME_SESSIONS more
 * (default 12) of GATE_RESUME_SMALL_MB (default 10), in Claude Code's JSONL shape. No CLI runs: listing, importing
 * and the context figure read the files only.
 *
 * Measured through the app's own IPC, the calls the UI makes (same shape on v1.5.0, v1.5.1 and main), with the main
 * process's longest event-loop stall during each call (a stall is what froze the window):
 *  - /resume: session list (cold) — window.oxe.session.list, what the /resume dialog loads;
 *  - /resume: import big session — thread.command('/resume <uuid>'), command to the resumed conversation saved;
 *  - /resume: open resumed thread — click in the sidebar to its timeline painted (UI);
 *  - context indicator: first read / update — contextUsage.get for the big session (the Code pane chip), the update
 *    read after a new turn is appended (past the service's 3 s cache), and thread.contextUsage on the resumed
 *    conversation (the OxeChat ring).
 * Lines are `[RESULT] <op> n=1 … median=<ms> first=<ms>` as perf-benchmark's report(), read by perf-gate/summarize.mjs.
 */
import { test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { modeButton } from './helpers/modes'
import { launchForPerf } from './helpers/perf-launch'

const BIG_MB = Number(process.env.GATE_RESUME_BIG_MB ?? 200)
const SESSIONS = Number(process.env.GATE_RESUME_SESSIONS ?? 12)
const SMALL_MB = Number(process.env.GATE_RESUME_SMALL_MB ?? 10)
const MODEL = 'claude-sonnet-4-5'
const TITLE = 'Big perf transcript'
const MARKER = 'Final answer of the big perf transcript'

function result(op: string, ms: number): void {
  const v = ms.toFixed(1)
  console.log(`[RESULT] ${op.padEnd(40)} n=1 min=${v} mean=${v} p95=${v} max=${v} ms median=${v} first=${v}`)
}
function notMeasured(op: string, error: unknown): void {
  console.log(`[RESULT] ${op} — not measured: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`)
}

/** Claude Code's transcript lines: user turns with large tool output, assistant turns with usage. */
function writeTranscript(file: string, sessionId: string, cwd: string, megabytes: number, title?: string): void {
  writeFileSync(file, '')
  const filler = 'x'.repeat(8_000)
  let parent: string | null = null
  let written = 0, turn = 0, batch: string[] = [], batchBytes = 0
  const push = (value: Record<string, unknown>): void => {
    const line = JSON.stringify(value) + '\n'
    batch.push(line); batchBytes += line.length; written += line.length
    if (batchBytes > 4 * 1024 * 1024) { appendFileSync(file, batch.join('')); batch = []; batchBytes = 0 }
  }
  if (title) push({ type: 'custom-title', customTitle: title, sessionId })
  const target = megabytes * 1024 * 1024
  while (written < target) {
    const user = randomUUID(), assistant = randomUUID()
    push({ type: 'user', sessionId, cwd, uuid: user, parentUuid: parent, timestamp: new Date(Date.now() - 1e6 + turn).toISOString(),
      message: { role: 'user', content: turn === 0 ? `Review the change, turn ${turn}` : [{ type: 'tool_result', tool_use_id: `t${turn}`, content: `${turn} ${filler}` }] } })
    push({ type: 'assistant', sessionId, cwd, uuid: assistant, parentUuid: user, timestamp: new Date(Date.now() - 1e6 + turn).toISOString(),
      message: { role: 'assistant', model: MODEL, content: [{ type: 'text', text: `Answer ${turn}. ${'detail '.repeat(40)}` }],
        usage: { input_tokens: 1200 + turn % 50, cache_creation_input_tokens: 300, cache_read_input_tokens: 90_000, output_tokens: 400 } } })
    parent = assistant; turn++
  }
  push({ type: 'user', sessionId, cwd, uuid: 'u-final', parentUuid: parent, timestamp: new Date().toISOString(), message: { role: 'user', content: 'One last question' } })
  push({ type: 'assistant', sessionId, cwd, uuid: 'a-final', parentUuid: 'u-final', timestamp: new Date().toISOString(),
    message: { role: 'assistant', model: MODEL, content: [{ type: 'text', text: MARKER }], usage: { input_tokens: 1500, cache_creation_input_tokens: 500, cache_read_input_tokens: 100_000, output_tokens: 600 } } })
  if (batch.length) appendFileSync(file, batch.join(''))
}

async function armStall(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    const g = globalThis as unknown as { __perfStall?: { max: number; last: number } }
    if (!g.__perfStall) {
      const stall = { max: 0, last: performance.now() }
      g.__perfStall = stall
      setInterval(() => { const now = performance.now(); stall.max = Math.max(stall.max, now - stall.last - 20); stall.last = now }, 20)
    }
    g.__perfStall.max = 0; g.__perfStall.last = performance.now()
  })
}
async function readStall(app: ElectronApplication): Promise<number> {
  // One more tick so a stall that ended with the call is counted.
  await new Promise(resolve => setTimeout(resolve, 60))
  return app.evaluate(() => Math.max(0, (globalThis as unknown as { __perfStall: { max: number } }).__perfStall.max))
}
async function timed(app: ElectronApplication, page: Page, op: string, call: () => Promise<number>): Promise<boolean> {
  try {
    await armStall(app)
    const ms = await call()
    const stall = await readStall(app)
    result(op, ms)
    result(`${op}, main stall`, stall)
    return true
  } catch (error) { notMeasured(op, error); return false }
}

async function stop(app: ElectronApplication): Promise<void> {
  const pid = app.process().pid
  await Promise.race([app.close().catch(() => undefined), new Promise(resolve => setTimeout(resolve, 5000))])
  if (!pid) return
  try { process.kill(pid, 0) } catch { return }
  try { if (process.platform === 'win32') execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); else process.kill(pid, 'SIGKILL') } catch { /* gone */ }
}

test('resume and context indicator: big Claude transcripts', async () => {
  test.setTimeout(300_000)
  const root = mkdtempSync(join(tmpdir(), 'oxe-resume-'))
  const repo = join(root, 'repo')
  const home = join(root, 'home')
  const claudeHome = join(home, '.claude')
  mkdirSync(repo, { recursive: true })
  mkdirSync(claudeHome, { recursive: true })
  mkdirSync(join(root, 'data'), { recursive: true })
  const app = await launchForPerf({ ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '0', OXESPACE_DB_PATH: join(root, 'data', 'oxespace.sqlite3'),
    CLAUDE_CONFIG_DIR: claudeHome, HOME: home, USERPROFILE: home, CODEX_HOME: join(home, '.codex') })
  try {
    const page = await app.firstWindow()
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-layout-card-1').click()
    await page.getByTestId('wizard-launch-btn').click()
    await page.waitForSelector('[data-testid="workspace-grid"], [data-testid="workspace-split-grid"]', { state: 'visible' })

    // OxeChat keeps its own project registry (Code workspaces are never consulted): register the folder as the
    // "Add project" button does. The stored root is the real path, the spelling Claude Code encodes.
    const summary = await page.evaluate(async (rootPath) => window.oxe.thread!.addProject!(rootPath), repo)
    const context = { projectId: summary.projectId, rootPath: summary.contexts[0]?.rootPath ?? repo }
    const workspaceId = await page.evaluate(async () => (await window.oxe.workspace.list())[0].id)
    const projectDir = join(claudeHome, 'projects', context.rootPath.replace(/[^a-zA-Z0-9]/g, '-'))
    mkdirSync(projectDir, { recursive: true })
    const bigId = randomUUID()
    const bigFile = join(projectDir, `${bigId}.jsonl`)
    writeTranscript(bigFile, bigId, context.rootPath, BIG_MB, TITLE)
    for (let i = 0; i < SESSIONS; i++) { const id = randomUUID(); writeTranscript(join(projectDir, `${id}.jsonl`), id, context.rootPath, SMALL_MB) }
    console.log(`[RESUME] fixture: 1 × ${BIG_MB} MB + ${SESSIONS} × ${SMALL_MB} MB in ${projectDir}`)
    await page.waitForTimeout(1_000)

    const input = { workspaceId, workspaceRootPath: context.rootPath, provider: 'claude' as const }
    await timed(app, page, '/resume: session list (cold)', () => page.evaluate(async (value) => {
      const started = performance.now(); const sessions = await window.oxe.session!.list(value)
      if (!sessions.length) throw Error('no sessions listed'); return performance.now() - started
    }, input))
    await timed(app, page, '/resume: session list (again)', () => page.evaluate(async (value) => {
      const started = performance.now(); await window.oxe.session!.list(value); return performance.now() - started
    }, input))

    const chip = { workspaceRootPath: context.rootPath, provider: 'claude' as const, sessionId: bigId }
    await page.waitForTimeout(3_200)
    await timed(app, page, 'context indicator: first read', () => page.evaluate(async (value) => {
      const started = performance.now(); const usage = await window.oxe.contextUsage.get(value)
      if (!usage.available) throw Error('no context figure'); return performance.now() - started
    }, chip))
    appendFileSync(bigFile, JSON.stringify({ type: 'assistant', sessionId: bigId, cwd: context.rootPath, uuid: 'a-update', parentUuid: 'a-final', timestamp: new Date().toISOString(),
      message: { role: 'assistant', model: MODEL, content: [{ type: 'text', text: 'Update' }], usage: { input_tokens: 2000, cache_creation_input_tokens: 0, cache_read_input_tokens: 150_000, output_tokens: 700 } } }) + '\n')
    await page.waitForTimeout(3_200)
    await timed(app, page, 'context indicator: update', () => page.evaluate(async (value) => {
      const started = performance.now(); const usage = await window.oxe.contextUsage.get(value)
      if (usage.usedTokens !== 2000 + 150_000 + 700) throw Error(`stale figure ${usage.usedTokens}`); return performance.now() - started
    }, chip))

    // /resume <uuid> from a conversation of the project: the native session is imported into a new conversation.
    const resumed: { id: string | null } = { id: null }
    await timed(app, page, '/resume: import big session', () => page.evaluate(async ({ projectId, rootPath, id }) => {
      const created = await window.oxe.thread!.create({ provider: 'claude', projectId, rootPath }) as unknown as { thread?: { id: string }; id?: string }
      const from = created.thread?.id ?? created.id
      if (!from) throw Error('no conversation created')
      const started = performance.now()
      const outcome = await window.oxe.thread!.command!(from, `/resume ${id}`) as { kind: string; threadId?: string }
      if (outcome.kind !== 'navigate' || !outcome.threadId) throw Error(`unexpected ${outcome.kind}`)
      ;(window as unknown as { __resumed: string }).__resumed = outcome.threadId
      return performance.now() - started
    }, { projectId: context.projectId, rootPath: context.rootPath, id: bigId })).then(async ok => {
      if (ok) resumed.id = await page.evaluate(() => (window as unknown as { __resumed: string }).__resumed)
    })
    const resumedId = resumed.id
    if (resumedId) {
      await timed(app, page, 'context indicator: resumed conversation', () => page.evaluate(async (id) => {
        const started = performance.now(); await window.oxe.thread!.contextUsage!(id); return performance.now() - started
      }, resumedId))
      try {
        await modeButton(page, 'thread').click()
        const entry = page.getByText(TITLE).first()
        await entry.waitFor({ state: 'visible', timeout: 30_000 })
        await armStall(app)
        const started = Date.now()
        await entry.click()
        await page.locator('.thread-virtual-space').getByText(MARKER).first().waitFor({ state: 'visible', timeout: 60_000 })
        const ms = Date.now() - started
        result('/resume: open resumed thread', ms)
        result('/resume: open resumed thread, main stall', await readStall(app))
      } catch (error) { notMeasured('/resume: open resumed thread', error) }
    }
  } finally {
    await stop(app)
    try { rmSync(root, { recursive: true, force: true }) } catch { /* the runner cleans its temp */ }
  }
})
