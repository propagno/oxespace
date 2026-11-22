import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withoutLiveApp } from './helpers/live-app-env'

/**
 * OXE-272 (CA-4) · Real built app (OXESPACE_E2E_MOCK_NATIVE=0) running a plain shell pane:
 *   - before any OSC 633/133 marker, no time/outcome indicator is shown;
 *   - when a ~2s command emits OSC 633;C and finishes with OSC 633;D;0, the header shows running elapsed time then success;
 *   - when a ~2s command emits OSC 133;C and finishes with OSC 133;D;1, the header shows running elapsed time then failure with exit code 1.
 */

const OSC_CMD_SCRIPT = String.raw`
const [mode, delayMs, exitCode] = process.argv.slice(2)
const esc = '\u001b'
const bel = '\u0007'
const st = esc + '\\'
if (mode === '633') process.stdout.write(esc + ']633;C' + bel + 'running 633\n')
else process.stdout.write(esc + ']133;C' + st + 'running 133\n')
setTimeout(() => {
  if (mode === '633') process.stdout.write(esc + ']633;D;' + exitCode + bel + 'done 633\n')
  else process.stdout.write(esc + ']133;D;' + exitCode + st + 'done 133\n')
}, Number(delayMs))
`

test('OXE-272 in the app: shows command duration and exit outcome from OSC 633/133', async () => {
  test.setTimeout(90_000)
  const root = mkdtempSync(join(tmpdir(), 'oxe-272-osc-'))
  const repo = join(root, 'repo')
  mkdirSync(repo, { recursive: true })
  const git = (...args: string[]): void => { execFileSync('git', ['-c', 'user.email=e2e@example.com', '-c', 'user.name=E2E', ...args], { cwd: repo }) }
  git('init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'README.md'), '# oxe-272\n')
  git('add', '.')
  git('commit', '-qm', 'init')

  const scriptPath = join(root, 'emit-osc.cjs')
  writeFileSync(scriptPath, OSC_CMD_SCRIPT)

  const app = await electron.launch({
    args: [join(process.cwd(), 'e2e/electron-main.cjs')],
    env: {
      ...withoutLiveApp(process.env),
      OXESPACE_DISABLE_SINGLE_INSTANCE: '1',
      OXESPACE_E2E_MOCK_NATIVE: '0',
      OXESPACE_LOCALE: 'en-US',
      OXESPACE_DB_PATH: join(root, 'db.sqlite3')
    }
  })

  try {
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1400, height: 900 })
    await page.getByTestId('btn-new-workspace').first().click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-layout-card-1').click()
    await page.getByTestId('wizard-launch-btn').click()
    await expect(page.getByTestId('terminal-pane')).toHaveCount(1, { timeout: 20_000 })

    const paneId = await page.evaluate(async () => {
      const [ws] = await window.oxe.workspace.list()
      return ws.panes[0].id
    })

    // Wait for the real shell prompt to appear.
    await expect.poll(async () => page.evaluate(async id => {
      const [st, at] = await Promise.all([window.oxe.terminal.status(id), window.oxe.terminal.attach({ paneId: id })])
      const esc = String.fromCharCode(27)
      const bel = String.fromCharCode(7)
      const csi = new RegExp(`${esc}\\[[0-9;?]*[A-Za-z]`, 'g')
      const osc = new RegExp(`${esc}\\][^${bel}]*${bel}`, 'g')
      return st.running && /[>$#%]\s*$/.test(at.replay.replace(csi, '').replace(osc, '').trimEnd())
    }, paneId), { timeout: 25_000 }).toBe(true)

    // CA-3 / RN-1: plain shell without OSC 633/133 renders 0 time/outcome elements.
    await expect(page.locator('[data-ui="pane-running-time"]')).toHaveCount(0)

    const posix = (value: string) => value.replace(/\\/g, '/')
    const sendLine = async (line: string): Promise<void> => {
      await page.evaluate(async ({ id, text }) => {
        await window.oxe.terminal.write({ paneId: id, data: text })
        await new Promise(resolve => setTimeout(resolve, 100))
        await window.oxe.terminal.write({ paneId: id, data: '\r' })
      }, { id: paneId, text: line })
    }

    const badge = page.getByTestId('pane-command-status')

    // 1. 2s command emitting OSC 633;C → OSC 633;D;0 (success).
    await sendLine(`node "${posix(scriptPath)}" 633 2200 0`)
    await expect(badge).toBeVisible({ timeout: 10_000 })
    await expect(badge).toHaveAttribute('data-state', 'running')
    await expect(badge).toHaveAttribute('data-state', 'success', { timeout: 10_000 })
    await expect(badge).toHaveAttribute('data-exit-code', '0')
    await expect(badge).toHaveText(/[1-9]\d*s/)

    // 2. 2s command emitting OSC 133;C → OSC 133;D;1 (failure).
    await sendLine(`node "${posix(scriptPath)}" 133 2200 1`)
    await expect(badge).toHaveAttribute('data-state', 'running', { timeout: 10_000 })
    await expect(badge).toHaveAttribute('data-state', 'failure', { timeout: 10_000 })
    await expect(badge).toHaveAttribute('data-exit-code', '1')
    await expect(badge).toHaveAttribute('title', /1/)
    await expect(badge).toHaveText(/[1-9]\d*s/)
  } finally {
    await app.close()
    rmSync(root, { recursive: true, force: true })
  }
})
