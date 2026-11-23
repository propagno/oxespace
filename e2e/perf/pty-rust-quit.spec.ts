/**
 * OXE-400 CA-4 · Quitting with live shells never aborts.
 *
 * The built app with 4 running shells quits by the three ways a person does it: the menu's Quit (the role:'quit' item
 * of the application menu), closing the window, and app.quit(). Each way runs OXESPACE_PTY_QUIT_ROUNDS times (30 in
 * .github/workflows/pty-host.yml) for each arm:
 *  - A, node-pty in the main process (today): the baseline of OXE-392, reported and never asserted. The isolated proof
 *    measured 7 to 10 unclean quits in 90 on Windows (access violations and hangs).
 *  - B, node-pty in the PTY host utility process (OXESPACE_PTY_HOST=utility): every quit must be clean, exit code 0
 *    and no signal, within 30 s.
 * Lines: `[PTY-QUIT] <arm> <way> clean=<n>/<total> unclean=<codes>`. Built app, real PTYs, CI only.
 */
import { expect, test, type ElectronApplication } from '@playwright/test'
import { forceKill, launchWithShells, processEnd, ptyHost, type PtyArm } from '../helpers/pty-host'

const ROUNDS = Number(process.env.OXESPACE_PTY_QUIT_ROUNDS ?? 3)
const ARMS = (process.env.OXESPACE_PTY_QUIT_ARMS ?? 'A,B').split(',') as PtyArm[]
const WAYS = ['menu', 'window', 'app.quit()'] as const
type Way = typeof WAYS[number]

/** Starts the quit; false when this build has no menu Quit item (then that way is reported as not measured). */
async function quit(app: ElectronApplication, way: Way): Promise<boolean> {
  if (way === 'menu') {
    return await app.evaluate(({ Menu }) => {
      type Item = { role?: string; submenu?: { items: Item[] } | null; click: () => void }
      const find = (items: Item[]): Item | undefined => {
        for (const item of items) {
          if (item.role?.toLowerCase() === 'quit') return item
          const inner = item.submenu ? find(item.submenu.items) : undefined
          if (inner) return inner
        }
        return undefined
      }
      const item = find((Menu.getApplicationMenu()?.items ?? []) as unknown as Item[])
      if (!item) return false
      setTimeout(() => item.click(), 0)
      return true
    })
  }
  if (way === 'window') {
    await app.evaluate(({ BrowserWindow }) => { setTimeout(() => BrowserWindow.getAllWindows()[0]?.close(), 0) })
    return true
  }
  await app.evaluate(({ app: electronApp }) => { setTimeout(() => electronApp.quit(), 0) })
  return true
}

test.describe.serial('the PTY host (OXE-400 CA-4)', () => {
  test('quitting with live shells never aborts', async () => {
    test.setTimeout(ROUNDS * ARMS.length * WAYS.length * 90_000 + 60_000)
    const results = new Map<string, { clean: number; total: number; unclean: string[]; unmeasured: number }>()
    for (let round = 1; round <= ROUNDS; round++) {
      // Arms alternate first place each round, on the same runner.
      const order = round % 2 ? ARMS : [...ARMS].reverse()
      for (const arm of order) {
        for (const way of WAYS) {
          const key = `${arm} ${way}`
          const entry = results.get(key) ?? { clean: 0, total: 0, unclean: [], unmeasured: 0 }
          results.set(key, entry)
          const { app, page, child } = await launchWithShells(arm, 4)
          try {
            // Each arm runs where it says: the host exists in B only.
            const { pid, processes } = await ptyHost(app)
            expect(pid !== null, `arm ${arm}: PTY host ${pid === null ? 'absent' : 'present'} (utility processes: ${processes.join(', ') || 'none'})`).toBe(arm === 'B')
            if (!(await quit(app, way))) { entry.unmeasured++; continue }
            // If the app asks before quitting (F26 close guard), the person goes ahead.
            void page.getByTestId('running-turns-proceed').or(page.getByTestId('unsaved-work-discard')).click({ timeout: 5_000 }).catch(() => undefined)
            const end = await processEnd(child, 30_000)
            entry.total++
            if (!end.hung && end.code === 0 && !end.signal) entry.clean++
            else entry.unclean.push(end.hung ? 'hung' : end.signal ?? String(end.code))
          } finally {
            forceKill(child)
          }
        }
      }
    }
    for (const [key, entry] of results) {
      console.log(`[PTY-QUIT] ${key} clean=${entry.clean}/${entry.total} unclean=${entry.unclean.join(',') || '—'}${entry.unmeasured ? ` not-measured=${entry.unmeasured} (no menu Quit item)` : ''}`)
    }
    for (const way of WAYS) {
      const b = results.get(`B ${way}`)
      if (!b || b.total === 0) continue
      expect(b.unclean, `arm B, ${way}: every quit with live shells exits 0`).toEqual([])
    }
  })
})
