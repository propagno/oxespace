import { expect, test, type Page } from '@playwright/test'
import { launchApp, openDemoWorkspace } from '../helpers/launch'
import { runPaletteCommand } from '../helpers/panels'

// Temporary diagnostic (OXE-145, never merged): where focus is and what happens to the keys around Ctrl+K.
async function focusInfo(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el) return 'none'
    const pane = el.closest<HTMLElement>('[data-terminal-pane]')?.dataset.terminalPane ?? null
    return `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ').slice(0, 2).join('.') : ''}${el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : ''}${pane ? ` pane=${pane}` : ''}${el.closest('.xterm') ? ' xterm' : ''}`
  })
}

for (let run = 1; run <= 20; run++) test(`diag split palette #${run}`, async () => {
  const { app, page, workspaceRoot } = await launchApp({ appearance: 'light' })
  const log: string[] = []
  try {
    await openDemoWorkspace(page, workspaceRoot)
    await page.evaluate(() => {
      const w = window as unknown as { __keys: string[] }
      w.__keys = []
      const d = (t: EventTarget | null): string => t instanceof HTMLElement ? `${t.tagName.toLowerCase()}${t.closest('.xterm') ? '(xterm)' : ''}` : String(t)
      document.addEventListener('keydown', e => { if (e.ctrlKey) w.__keys.push(`doc ${e.key} target=${d(e.target)} prevented=${e.defaultPrevented}`) })
      window.addEventListener('keydown', e => { if (e.ctrlKey) w.__keys.push(`win-after-app ${e.key} prevented=${e.defaultPrevented}`) })
      document.addEventListener('focusin', e => w.__keys.push(`focusin ${d(e.target)} t=${Math.round(performance.now())}`))
    })
    await runPaletteCommand(page, 'Toggle split layout')
    await expect(page.getByTestId('workspace-grid')).toBeVisible()
    await runPaletteCommand(page, 'Layout: 16 panes')
    await expect(page.getByTestId('terminal-pane')).toHaveCount(16, { timeout: 20_000 })
    await runPaletteCommand(page, 'Split pane right')
    const panes = page.getByTestId('terminal-pane')
    await expect.poll(async () => await panes.count() === 17 || await page.getByText('This pane cannot be split here').isVisible(), { timeout: 10_000 }).toBe(true)
    log.push(`before shortcut: ${await focusInfo(page)}`)
    await page.keyboard.press('Control+Shift+Backslash')
    log.push(`before Ctrl+K: ${await focusInfo(page)}`)
    await page.keyboard.press('Control+K')
    const opened = await page.getByRole('dialog').getByRole('combobox').waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false)
    log.push(`opened=${opened} focus after: ${await focusInfo(page)} dialogs=${await page.getByRole('dialog').count()}`)
    const keys = await page.evaluate(() => (window as unknown as { __keys: string[] }).__keys.slice(-14))
    console.log(`DIAG #${run} ${opened ? 'OK' : 'MISS'} | ${log.join(' | ')} | ${keys.join(' ; ')}`)
    expect(opened).toBe(true)
  } finally {
    await Promise.race([app.close().catch(() => undefined), new Promise(resolve => setTimeout(resolve, 4000))])
  }
})
