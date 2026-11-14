// Scratch (OXE-157, never committed): CPU profile of the main process during `/resume <uuid>` of a 200 MB transcript.
import { test, type ElectronApplication } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { launchForPerf } from './helpers/perf-launch'

function writeTranscript(file: string, sessionId: string, cwd: string, megabytes: number): void {
  writeFileSync(file, '')
  const filler = 'x'.repeat(8_000)
  let parent: string | null = null
  let written = 0, turn = 0, batch: string[] = [], batchBytes = 0
  const push = (value: Record<string, unknown>): void => {
    const line = JSON.stringify(value) + '\n'
    batch.push(line); batchBytes += line.length; written += line.length
    if (batchBytes > 4 * 1024 * 1024) { appendFileSync(file, batch.join('')); batch = []; batchBytes = 0 }
  }
  push({ type: 'custom-title', customTitle: 'Big perf transcript', sessionId })
  while (written < megabytes * 1024 * 1024) {
    const user = randomUUID(), assistant = randomUUID()
    push({ type: 'user', sessionId, cwd, uuid: user, parentUuid: parent, timestamp: new Date(Date.now() - 1e6 + turn).toISOString(),
      message: { role: 'user', content: turn === 0 ? `Review the change, turn ${turn}` : [{ type: 'tool_result', tool_use_id: `t${turn}`, content: `${turn} ${filler}` }] } })
    push({ type: 'assistant', sessionId, cwd, uuid: assistant, parentUuid: user, timestamp: new Date(Date.now() - 1e6 + turn).toISOString(),
      message: { role: 'assistant', model: 'claude-sonnet-4-5', content: [{ type: 'text', text: `Answer ${turn}. ${'detail '.repeat(40)}` }],
        usage: { input_tokens: 1200, cache_creation_input_tokens: 300, cache_read_input_tokens: 90_000, output_tokens: 400 } } })
    parent = assistant; turn++
  }
  if (batch.length) appendFileSync(file, batch.join(''))
}

async function profile(app: ElectronApplication, run: () => Promise<unknown>): Promise<void> {
  await app.evaluate(async () => {
    const inspector = process.getBuiltinModule('node:inspector') as typeof import('node:inspector')
    const session = new inspector.Session(); session.connect()
    const post = (method: string, params?: object) => new Promise((resolve, reject) => session.post(method, params ?? {}, (e: Error | null, r: unknown) => e ? reject(e) : resolve(r)))
    await post('Profiler.enable'); await post('Profiler.setSamplingInterval', { interval: 200 }); await post('Profiler.start')
    const g = globalThis as unknown as { __prof: unknown; __stall: { max: number; last: number; gaps: number[] } }
    g.__prof = { session, post }
    const stall = { max: 0, last: performance.now(), gaps: [] as number[] }
    g.__stall = stall
    setInterval(() => { const now = performance.now(); const gap = now - stall.last - 10; if (gap > 5) stall.gaps.push(Math.round(gap)); stall.max = Math.max(stall.max, gap); stall.last = now }, 10)
  })
  await run()
  await new Promise(r => setTimeout(r, 300))
  const report = await app.evaluate(async () => {
    const g = globalThis as unknown as { __prof: { session: { disconnect(): void }; post: (m: string) => Promise<{ profile: { nodes: Array<{ id: number; callFrame: { functionName: string; url: string; lineNumber: number }; children?: number[] }>; samples: number[]; timeDeltas: number[] } }> }; __stall: { max: number; gaps: number[] } }
    const { profile } = await g.__prof.post('Profiler.stop')
    g.__prof.session.disconnect()
    const byId = new Map(profile.nodes.map(n => [n.id, n]))
    const parent = new Map<number, number>()
    for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id)
    const self = new Map<string, number>(), total = new Map<string, number>()
    const key = (n: { callFrame: { functionName: string; url: string; lineNumber: number } }) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-2).join('/')}:${n.callFrame.lineNumber}`
    profile.samples.forEach((id, i) => {
      const ms = (profile.timeDeltas[i + 1] ?? 0) / 1000
      const node = byId.get(id)!
      if (node.callFrame.functionName === '(idle)' || node.callFrame.functionName === '(program)') return
      self.set(key(node), (self.get(key(node)) ?? 0) + ms)
      const seen = new Set<string>()
      for (let cur: number | undefined = id; cur !== undefined; cur = parent.get(cur)) { const k = key(byId.get(cur)!); if (!seen.has(k)) { seen.add(k); total.set(k, (total.get(k) ?? 0) + ms) } }
    })
    const top = (m: Map<string, number>, n: number) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${v.toFixed(1)} ms  ${k}`)
    return { stall: g.__stall.max, gaps: g.__stall.gaps, self: top(self, 30), total: top(total, 40) }
  })
  console.log(`[PROF] stall max ${report.stall.toFixed(1)} ms, gaps ${report.gaps.join(',')}`)
  console.log('[PROF] self:\n' + report.self.join('\n'))
  console.log('[PROF] total:\n' + report.total.join('\n'))
}

test('profile /resume import', async () => {
  test.setTimeout(300_000)
  const root = mkdtempSync(join(tmpdir(), 'oxe-prof-'))
  const repo = join(root, 'repo'), home = join(root, 'home'), claudeHome = join(home, '.claude')
  mkdirSync(repo, { recursive: true }); mkdirSync(claudeHome, { recursive: true }); mkdirSync(join(root, 'data'), { recursive: true })
  const app = await launchForPerf({ ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '0', OXESPACE_DB_PATH: join(root, 'data', 'oxespace.sqlite3'),
    CLAUDE_CONFIG_DIR: claudeHome, HOME: home, USERPROFILE: home, CODEX_HOME: join(home, '.codex') })
  try {
    const page = await app.firstWindow()
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-layout-card-1').click()
    await page.getByTestId('wizard-launch-btn').click()
    await page.waitForSelector('[data-testid="workspace-grid"], [data-testid="workspace-split-grid"]', { state: 'visible' })
    const summary = await page.evaluate(async (rootPath) => window.oxe.thread!.addProject!(rootPath), repo)
    const context = { projectId: summary.projectId, rootPath: summary.contexts[0]?.rootPath ?? repo }
    const workspaceId = await page.evaluate(async () => (await window.oxe.workspace.list())[0].id)
    const projectDir = join(claudeHome, 'projects', context.rootPath.replace(/[^a-zA-Z0-9]/g, '-'))
    mkdirSync(projectDir, { recursive: true })
    const bigId = randomUUID()
    writeTranscript(join(projectDir, `${bigId}.jsonl`), bigId, context.rootPath, 200)
    await page.waitForTimeout(1_000)
    await page.evaluate(async (value) => window.oxe.session!.list(value), { workspaceId, workspaceRootPath: context.rootPath, provider: 'claude' as const })
    const from = await page.evaluate(async ({ projectId, rootPath }) => {
      const created = await window.oxe.thread!.create({ provider: 'claude', projectId, rootPath }) as unknown as { thread?: { id: string }; id?: string }
      return created.thread?.id ?? created.id
    }, context)
    await page.waitForTimeout(1_500)
    await profile(app, () => page.evaluate(async ({ from, id }) => window.oxe.thread!.command!(from!, `/resume ${id}`), { from, id: bigId }))
  } finally {
    const pid = app.process().pid
    await Promise.race([app.close().catch(() => undefined), new Promise(resolve => setTimeout(resolve, 5000))])
    try { if (pid) { process.kill(pid, 0); if (process.platform === 'win32') execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); else process.kill(pid, 'SIGKILL') } } catch { /* gone */ }
    try { rmSync(root, { recursive: true, force: true }) } catch { /* runner temp */ }
  }
})
