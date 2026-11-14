/**
 * Boot A/B probe (ci/perf-ab-* only, never on main): launches the built app AB_LAUNCHES times, the first one as a
 * discarded warm-up, and prints one `[AB]` line per measured launch with the app's own marks:
 *  - process→interactive: main's `oxe:interactive` measure (as e2e/perf-benchmark.spec.ts › boot: window interactive);
 *  - window→first paint: the renderer's first-paint entry since main's `oxe:window-create` (as perceived-perf.spec.ts).
 * Same launch as perceived-perf: mock native, a fresh profile and database per launch, no fake clock.
 */
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const LAUNCHES = Number(process.env.AB_LAUNCHES || 4)
const SIDE = process.env.AB_SIDE || '?'
const ROUND = process.env.AB_ROUND || '?'

async function close(app: ElectronApplication): Promise<void> {
  const pid = app.process().pid
  await Promise.race([app.close().catch(() => {}), new Promise(resolve => setTimeout(resolve, 10_000))])
  try { if (pid) process.kill(pid) } catch { /* already gone */ }
}

test('boot A/B probe', async () => {
  test.setTimeout(LAUNCHES * 60_000)
  for (let i = 0; i < LAUNCHES; i++) {
    const root = mkdtempSync(join(tmpdir(), 'oxespace-ab-'))
    mkdirSync(join(root, 'repo'), { recursive: true })
    const app = await electron.launch({
      args: [join(process.cwd(), 'e2e', 'electron-main.cjs')],
      env: { ...process.env, TZ: 'UTC', OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'oxespace.sqlite3') }
    })
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
      console.log(`[AB] side=${SIDE} round=${ROUND} launch=${i} warmup=${i === 0 ? 1 : 0} interactive=${interactive.toFixed(1)} firstPaint=${firstPaint.toFixed(1)}`)
    } finally {
      await close(app)
    }
  }
})
