// CR-03 (Celular F2, 14/11, coordination decision): the OXE-52 restart code lives in its own module.
//
// T3 (OXE-52) made a pane restarted while a phone holds it start at the desktop's size. It did so with two pieces
// written inside electron/main/services/terminal.service.ts, which took that file from 1000 to 1005 lines (lint limit
// 1000, PR #808). The first redo (CR-02) got under the limit by squeezing unrelated loops onto one line each; the
// coordination refused it: it was churn outside the scope plus a behaviour change with no criterion.
//
// Contract for the redo of T3:
// - New module electron/main/services/terminal/restart-size.ts, with:
//     desktopStartSize(sizes: Pick<SizeLeases, 'desktopSize'>, paneId: string, last: { cols: number; rows: number })
//       → the desktop's own size while a phone holds the pane, else `last`.
//     keepDesktopSize(sizes: Pick<SizeLeases, 'desktopSize'>, paneId: string, session: { cols: number; rows: number } | undefined)
//       → on exit, writes the desktop's size onto the session while a phone holds the pane; else leaves it as is.
// - terminal.service.ts calls these two at the restart and exit sites of OXE-52 and no other line of it changes:
//   stopWorkspace, stopAll and countDetached stay exactly as on main.
// - terminal.service.ts has no net line over main (1000).
//
// CA-1 and CA-2 run the real module against the real SizeLeases. CA-3 is a marked source check (import and size).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SizeLeases } from '../../../electron/main/services/terminal/size-lease'
import { desktopStartSize, keepDesktopSize } from '../../../electron/main/services/terminal/restart-size'

const DESKTOP = { cols: 120, rows: 40 }
const PHONE = { cols: 46, rows: 28 }

function leases() {
  const sizes = new Map<string, { cols: number; rows: number }>([['pane-1', { ...DESKTOP }]])
  return new SizeLeases({
    size: (paneId) => sizes.get(paneId) ?? null,
    apply: (paneId, cols, rows) => { sizes.set(paneId, { cols, rows }) },
    emit: () => {},
  })
}

describe('CR-03 · the OXE-52 restart size lives in terminal/restart-size.ts', () => {
  it('CR-03 CA-1 · a pane a phone holds restarts at the desktop size; one nobody holds restarts as it last started', () => {
    const sizes = leases()
    expect(sizes.lease('pane-1', 'phone-a', PHONE.cols, PHONE.rows)).toBe('held')
    expect(desktopStartSize(sizes, 'pane-1', PHONE)).toEqual(DESKTOP)
    expect(desktopStartSize(sizes, 'pane-2', { cols: 80, rows: 24 })).toEqual({ cols: 80, rows: 24 })
    sizes.release('pane-1')
    expect(desktopStartSize(sizes, 'pane-1', { cols: 100, rows: 30 })).toEqual({ cols: 100, rows: 30 })
  })

  it('CR-03 CA-2 · on exit, a held pane keeps the desktop size for its next start; an unheld one is left as it is', () => {
    const sizes = leases()
    sizes.lease('pane-1', 'phone-a', PHONE.cols, PHONE.rows)
    const held = { ...PHONE }
    keepDesktopSize(sizes, 'pane-1', held)
    expect(held).toEqual(DESKTOP)
    const unheld = { cols: 90, rows: 25 }
    keepDesktopSize(sizes, 'pane-2', unheld)
    expect(unheld).toEqual({ cols: 90, rows: 25 })
    expect(() => keepDesktopSize(sizes, 'pane-1', undefined)).not.toThrow()
  })

  it('CR-03 CA-3 · terminal.service.ts imports the module, reads no desktop size itself and stays within 1000 lines', () => {
    // Marked source check: structure and size only, no behaviour is read from the text.
    const text = readFileSync(join(process.cwd(), 'electron', 'main', 'services', 'terminal.service.ts'), 'utf8')
    expect(text).toMatch(/from '\.\/terminal\/restart-size'/)
    expect(text).not.toMatch(/this\.sizes\.desktopSize\(/)
    const lines = text.length === 0 ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
    expect(lines).toBeLessThanOrEqual(1000)
  })
})
