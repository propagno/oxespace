import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ThreadProvider } from '../shared/types/thread'

// Opt-in only. Real subscription calls and an isolated application database.
const enabled = process.env.OXESPACE_THREAD_ENDURANCE === '1'
const minutes = Number(process.env.OXESPACE_ENDURANCE_MINUTES ?? 60)
const provider = (process.env.OXESPACE_ENDURANCE_PROVIDER ?? 'codex') as ThreadProvider
function bytes(path: string): number {
  try { return readdirSync(path, { withFileTypes: true }).reduce((sum, entry) => {
    if (entry.isSymbolicLink()) return sum
    const file = join(path, entry.name)
    return sum + (entry.isDirectory() ? bytes(file) : statSync(file).size)
  }, 0) } catch { return 0 }
}

test('native Thread remains responsive through a measured session and application restart', async () => {
  test.skip(!enabled, 'Set OXESPACE_THREAD_ENDURANCE=1 for real authenticated endurance')
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 120 || !['codex', 'claude'].includes(provider)) throw Error('Invalid endurance configuration')
  test.setTimeout(minutes * 60000 + 300000)
  const root = mkdtempSync(join(tmpdir(), 'oxe-endurance-'))
  const projectRoot = join(root, 'project'); mkdirSync(projectRoot)
  const samples: Array<{ elapsedMs: number; rssKiB: number; cpuPercent: number; appProcesses: number; dataBytes: number }> = []
  const start = Date.now()
  const report: Record<string, unknown> = { provider, platform: process.platform, minutes, completed: false, samples }
  let app: ElectronApplication | undefined
  const launch = async () => electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '0', OXESPACE_DB_PATH: join(root, 'app.sqlite3')
  } })
  const close = async (instance: ElectronApplication) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([instance.close(), new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          report.completed = false
          report.shutdownTimedOut = true
          instance.process().kill()
          reject(Error('Native application shutdown exceeded 15 seconds'))
        }, 15000)
      })])
    } finally { clearTimeout(timer) }
  }
  try {
    app = await launch()
    let page = await app.firstWindow()
    await page.waitForURL(/index\.html/)
    await page.waitForLoadState('domcontentloaded')
    const id = await page.evaluate(async ({ root, provider }) => {
      const project = await window.oxe.thread!.addProject(root)
      return (await window.oxe.thread!.create({ projectId: project.projectId, provider })).thread.id
    }, { root: projectRoot, provider })
    const account = await page.evaluate(async ({ id, provider }) => {
      const snapshot = await window.oxe.thread!.read(id)
      const status = await window.oxe.agentAccount!.read({ provider, threadId: id, workspaceId: snapshot.thread.workspaceId })
      return { state: status.state, method: status.method, errorCode: status.errorCode }
    }, { id, provider })
    report.account = account
    expect(account).toMatchObject({ state: 'connected', method: 'subscription' })
    const marker = `ENDURANCE_${Date.now()}`
    let nativeId: string | null = null
    let turns = 0
    const turn = async () => {
      const before = await page.evaluate(id => window.oxe.thread!.read(id), id)
      const prompt = turns === 0 ? `Remember ${marker}. Reply only with that marker. Do not use tools.` : 'Repeat the exact ENDURANCE marker from the first message. Do not use tools.'
      await page.evaluate(({ id, prompt }) => window.oxe.thread!.send(id, prompt), { id, prompt })
      await expect.poll(async () => {
        const snapshot = await page.evaluate(id => window.oxe.thread!.read(id), id)
        if (snapshot.thread.status === 'failed') {
          const failure = [...snapshot.events].reverse().find(event => event.type === 'completed' && event.status === 'failed')
          const code = failure?.type === 'completed' ? failure.errorCode ?? 'unknown' : 'unknown'
          report.failureCode = code
          throw Error(`Native endurance turn failed (${code})`)
        }
        return snapshot.thread.status === 'idle' && snapshot.events.length > before.events.length && snapshot.thread.lastTurnStatus === 'completed'
      }, { timeout: 120000, intervals: [500] }).toBe(true)
      const after = await page.evaluate(id => window.oxe.thread!.read(id), id)
      const messages = after.events.filter(event => event.type === 'message' && event.role === 'assistant')
      expect(messages.at(-1)).toMatchObject({ text: expect.stringContaining(marker) })
      expect(after.thread.nativeSessionId).toBeTruthy()
      if (nativeId) expect(after.thread.nativeSessionId).toBe(nativeId)
      nativeId = after.thread.nativeSessionId
      turns++
    }
    await turn()
    let nextTurn = Date.now() + 5 * 60000
    const deadline = start + minutes * 60000
    while (Date.now() < deadline) {
      const metrics = await app.evaluate(({ app }) => app.getAppMetrics().map(value => ({
        rss: value.memory.workingSetSize, cpu: value.cpu.percentCPUUsage
      })))
      samples.push({ elapsedMs: Date.now() - start, rssKiB: metrics.reduce((sum, value) => sum + value.rss, 0),
        cpuPercent: metrics.reduce((sum, value) => sum + value.cpu, 0), appProcesses: metrics.length, dataBytes: bytes(root) })
      expect(await page.evaluate(() => document.readyState)).toBe('complete')
      if (Date.now() >= nextTurn) { await turn(); nextTurn = Date.now() + 5 * 60000 }
      await page.waitForTimeout(Math.min(10000, Math.max(0, deadline - Date.now())))
    }
    await close(app)
    app = await launch()
    page = await app.firstWindow()
    await page.waitForURL(/index\.html/)
    await page.waitForLoadState('domcontentloaded')
    await turn()
    report.completed = true
    report.turns = turns
    report.elapsedMs = Date.now() - start
    // Measurements describe Electron processes only, not all CLI descendants.
    report.measurementScope = 'Electron app metrics and isolated application data; no claim of full descendant accounting or leak freedom'
  } finally {
    const output = join(process.cwd(), 'test-results'); mkdirSync(output, { recursive: true })
    writeFileSync(join(output, `thread-endurance-${provider}-${process.platform}.json`), JSON.stringify(report, null, 2))
    if (app) {
      await close(app).catch(() => { report.completed = false })
      writeFileSync(join(output, `thread-endurance-${provider}-${process.platform}.json`), JSON.stringify(report, null, 2))
    }
  }
  expect(report.completed).toBe(true)
})
