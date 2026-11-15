/**
 * Boot probe of the release gate (OXE-105, .github/workflows/perf-gate.yml). Copied into each measured ref's e2e/ as
 * e2e/perf-gate-boot.spec.ts; never run from here. Launches the app GATE_LAUNCHES times (default 4), the first one a
 * discarded warm-up, and prints one `[GATE-BOOT]` line per launch with the app's own marks:
 *  - interactive: main's `oxe:interactive` measure, process start to the first painted screen;
 *  - firstPaint: the renderer's first-paint entry since main's `oxe:window-create`.
 * The launch is helpers/perf-launch.ts's: the packaged binary when OXESPACE_PACKAGED_EXECUTABLE is set, a fresh
 * profile and database per launch. From the brand session's boot A/B probe (ci/perf-ab-m2, ci-ab/ab-boot.spec.ts).
 */
import { expect, test, type ElectronApplication } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchForPerf } from './helpers/perf-launch'

const LAUNCHES = Number(process.env.GATE_LAUNCHES || 4)
const SIDE = process.env.GATE_SIDE || '?'
const ROUND = process.env.GATE_ROUND || '?'

async function close(app: ElectronApplication): Promise<void> {
  const pid = app.process().pid
  await Promise.race([app.close().catch(() => {}), new Promise(resolve => setTimeout(resolve, 10_000))])
  try { if (pid) process.kill(pid) } catch { /* already gone */ }
}

test('release gate: boot probe', async () => {
  test.setTimeout(LAUNCHES * 60_000)
  for (let i = 0; i < LAUNCHES; i++) {
    const root = mkdtempSync(join(tmpdir(), 'oxespace-gate-'))
    mkdirSync(join(root, 'repo'), { recursive: true })
    const app = await launchForPerf({ ...process.env, TZ: 'UTC', OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'oxespace.sqlite3') })
    try {
      const page = await app.firstWindow()
      await page.getByTestId('btn-new-workspace').waitFor({ state: 'visible' })
      const main = (): Promise<{ origin: number; measures: Record<string, { start: number; duration: number }> }> => app.evaluate(() => ({
        origin: performance.timeOrigin,
        measures: Object.fromEntries(performance.getEntriesByType('measure').filter(e => e.name.startsWith('oxe:')).map(e => [e.name, { start: e.startTime, duration: e.duration }]))
      }))
      await expect.poll(async () => Object.keys((await main()).measures)).toContain('oxe:interactive')
      const { origin, measures } = await main()
      const renderer = await page.evaluate(() => {
        const out: Record<string, number> = { origin: performance.timeOrigin }
        for (const entry of performance.getEntriesByType('paint')) out[entry.name] = entry.startTime
        return out
      })
      const windowAt = origin + (measures['oxe:window-create']?.start ?? NaN)
      const interactive = measures['oxe:interactive']?.duration ?? NaN
      const firstPaint = renderer.origin + (renderer['first-paint'] ?? NaN) - windowAt
      console.log(`[GATE-BOOT] side=${SIDE} round=${ROUND} launch=${i} warmup=${i === 0 ? 1 : 0} interactive=${interactive.toFixed(1)} firstPaint=${firstPaint.toFixed(1)}`)
    } finally {
      await close(app)
    }
  }
})
