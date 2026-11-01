import { describe, expect, test } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db/index'
import { resolveExecutable, TerminalManager } from '../../electron/main/services/terminal.service'

/*
 * B13 / HML on #374, on the real bundled ConPTY: a pane started with no view attached (IPC start, hidden pane) must
 * show its first prompt at once. ConPTY sends DA1 on start and holds output until it is answered; with nobody to
 * answer it gave up after ~3 s. Main now answers (pty-da1.ts). The "shell" is the system `node` from PATH, a console
 * program, never process.execPath (the Electron binary under test:electron).
 */
const NODE = resolveExecutable('node')
const PROMPT_SCRIPT = String.raw`process.stdout.write('HIDDEN-READY> '); setInterval(() => {}, 1000)`

describe.skipIf(process.platform !== 'win32')('a hidden pane on the bundled ConPTY (B13)', () => {
  test('shows its first prompt within 2 s with no view attached, and main answered DA1 once', async () => {
    const db = openInMemoryDatabase()
    const paneId = 'oxequery-shell:7d1e2f3a-4b5c-4d6e-8f70-112233445566'
    const manager = new TerminalManager(db, { env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('OXESPACE_'))),oxeQueryShell: id => id === paneId ? { file: NODE, args: ['-e', PROMPT_SCRIPT] } : undefined })
    try {
      const startedAt = Date.now()
      await manager.start({ workspaceId: 'oxequery', paneId, disableRtk: true, cols: 80, rows: 24 })
      let elapsed = Infinity
      while (Date.now() - startedAt < 6000) {
        if (manager.peek(paneId)?.data.includes('HIDDEN-READY>')) { elapsed = Date.now() - startedAt; break }
        await new Promise(resolve => setTimeout(resolve, 25))
      }
      expect(elapsed, 'first prompt of a hidden pane (ms)').toBeLessThan(2000)
      expect(manager.peek(paneId)?.data).not.toMatch(/\x1b\[0?c/)
    } finally { manager.stopAll(); db.close() }
  }, 20000)
})
