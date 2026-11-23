import { expect, type ElectronApplication, type Page } from '@playwright/test'
import type { ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchForPerf } from './perf-launch'

/**
 * OXE-400 · The built app with real PTYs, node-pty where it runs today (arm A, the baseline) or in the PTY host
 * utility process (arm B, OXESPACE_PTY_HOST=utility). Used by e2e/perf/pty-rust-*.spec.ts, which run in
 * .github/workflows/pty-host.yml, never in the smoke run.
 */
export type PtyArm = 'A' | 'B'

/** Variables of the live app that a run must never inherit; the launcher sets its own few. */
const INHERITED = /^(OXESPACE_|AI_MEMORY_)/i

export function armEnv(arm: PtyArm, root: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !INHERITED.test(key)) env[key] = value
  return {
    ...env,
    OXESPACE_DISABLE_SINGLE_INSTANCE: '1',
    OXESPACE_E2E_MOCK_NATIVE: '0',
    OXESPACE_DB_PATH: join(root, 'db.sqlite3'),
    ...(arm === 'B' ? { OXESPACE_PTY_HOST: 'utility' } : {})
  }
}

export interface ArmApp {
  app: ElectronApplication
  page: Page
  root: string
  /** The app's process, kept at launch: Playwright stops answering app.process() once the app has gone. */
  child: ChildProcess
}

/** Launches the app for one arm and opens a workspace of `panes` running shells. */
export async function launchWithShells(arm: PtyArm, panes: number): Promise<ArmApp> {
  const link = join(process.cwd(), 'e2e', 'out')
  if (!existsSync(link)) { try { symlinkSync(join(process.cwd(), 'out'), link, 'junction') } catch { /* exists */ } }
  const root = mkdtempSync(join(tmpdir(), `oxe-pty-${arm}-`))
  const app = await launchForPerf(armEnv(arm, root))
  const child = app.process()
  const page = await app.firstWindow()
  const repo = join(root, 'repo')
  mkdirSync(repo, { recursive: true })
  await page.getByTestId('btn-new-workspace').click()
  await page.getByTestId('wizard-dir-input').fill(repo)
  await page.getByTestId(`wizard-layout-card-${panes}`).click()
  await page.getByTestId('wizard-launch-btn').click()
  const host = page.locator('.workspace-host:not(.workspace-host-hidden)')
  await expect(host.getByTestId('terminal-pane')).toHaveCount(panes, { timeout: 60_000 })
  await expect(host.getByTestId('terminal-status-label').filter({ hasText: 'running' })).toHaveCount(panes, { timeout: 90_000 })
  return { app, page, root, child }
}

/**
 * The PTY host utility process (arm B), from the app's own process list: the utility process forked with
 * serviceName 'oxespace-pty-host', which getAppMetrics reports as its `name`. `processes` lists every utility
 * process the app runs, for the failure message when there is no host.
 */
export async function ptyHost(app: ElectronApplication): Promise<{ pid: number | null; processes: string[] }> {
  return await app.evaluate(({ app: electronApp }) => {
    const utilities = electronApp.getAppMetrics().filter(metric => metric.type === 'Utility')
    const host = utilities.find(metric => metric.name === 'oxespace-pty-host' || metric.serviceName === 'oxespace-pty-host')
    return { pid: host?.pid ?? null, processes: utilities.map(metric => `${metric.pid}:${metric.name ?? ''}:${metric.serviceName ?? ''}`) }
  })
}

/** How the app's process ended: its exit code and signal, or `hung` when it was still running after `ms`. */
export function processEnd(child: ChildProcess, ms: number): Promise<{ code: number | null; signal: string | null; hung: boolean }> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve({ code: child.exitCode, signal: child.signalCode, hung: false })
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve({ code: null, signal: null, hung: true }), ms)
    child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal, hung: false }) })
  })
}

/** Ends a process that is still there after a test (a hung quit). */
export function forceKill(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return
  try { process.kill(child.pid, 'SIGKILL') } catch { /* gone */ }
}
