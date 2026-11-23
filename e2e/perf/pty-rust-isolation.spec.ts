/**
 * OXE-400 CA-1 · A crash of the PTY host leaves the app running, and the pane shows its terminal ended.
 *
 * Arm B: node-pty in the PTY host utility process (OXESPACE_PTY_HOST=utility), the recommendation of the measured
 * proof (docs/validation/pty-rust-poc.md). The host is killed from outside, the way a native crash in node-pty ends
 * it. Baseline, arm A: node-pty runs in the main process, so the same fault is the app itself ending; the proof
 * measured it (a thrown data listener aborts the app on quit, 5/5 on Windows). Built app, real PTYs, CI only
 * (.github/workflows/pty-host.yml).
 */
import { expect, test } from '@playwright/test'
import { forceKill, launchWithShells, processEnd, ptyHostPid } from '../helpers/pty-host'

test.describe.serial('the PTY host (OXE-400 CA-1)', () => {
  test('a crash in the PTY host leaves the app running', async () => {
    test.setTimeout(5 * 60_000)
    test.info().annotations.push({ type: 'baseline', description: 'arm A: node-pty runs in the main process; a fault there is the app ending (docs/validation/pty-rust-poc.md, CA-1)' })
    const { app, page } = await launchWithShells('B', 2)
    try {
      const pid = await ptyHostPid(app)
      expect(pid, 'the PTY host utility process runs').not.toBeNull()
      process.kill(pid as number, 'SIGKILL')

      const host = page.locator('.workspace-host:not(.workspace-host-hidden)')
      await expect(host.getByTestId('terminal-status-label').filter({ hasText: 'exited' })).toHaveCount(2, { timeout: 15_000 })
      // The main process is still there and the window still answers.
      const ended = await processEnd(app, 2_000)
      expect(ended.hung, 'the app is still running').toBe(true)
      expect(await page.evaluate(() => document.readyState)).toBe('complete')
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(window => !window.isDestroyed()).length)).toBeGreaterThan(0)
    } finally {
      await Promise.race([app.close().catch(() => undefined), new Promise(resolve => setTimeout(resolve, 5_000))])
      forceKill(app)
    }
  })
})
