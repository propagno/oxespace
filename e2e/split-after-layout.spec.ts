import { expect, test } from '@playwright/test'
import { launchApp, openDemoWorkspace } from './helpers/launch'
import { runPaletteCommand } from './helpers/panels'

/**
 * F19 (homologation, P2-5): with the split layout off, the 16-pane preset and then "Split pane right" took the whole
 * window down (TypeError reading 'rows', caught by the root boundary: no panes, and the palette no longer opened).
 * A split in any layout must give a new pane or a refusal with a reason, and the window must stay usable.
 */
test('split after the 16-pane preset with the split layout off: the window stays, and the palette still opens', async () => {
  const { app, page, workspaceRoot, consoleErrors } = await launchApp({ appearance: 'light' })
  try {
    await openDemoWorkspace(page, workspaceRoot)
    await runPaletteCommand(page, 'Toggle split layout')
    await expect(page.getByTestId('workspace-grid')).toBeVisible()
    await runPaletteCommand(page, 'Layout: 16 panes')
    await expect(page.getByTestId('terminal-pane')).toHaveCount(16, { timeout: 20_000 })

    await runPaletteCommand(page, 'Split pane right')
    // A 17th pane, or a refusal that says why; never the window's crash screen.
    await expect(page.getByText('OXESpace could not show this window')).toHaveCount(0)
    const panes = page.getByTestId('terminal-pane')
    await expect.poll(async () => await panes.count() === 17 || await page.getByText('This pane cannot be split here').isVisible(), { timeout: 10_000 }).toBe(true)
    await expect(page.getByTestId('workspace-grid')).toBeVisible()

    // The shortcut takes the same path; and the palette keeps opening afterwards.
    await page.keyboard.press('Control+Shift+Backslash')
    await expect(page.getByText('OXESpace could not show this window')).toHaveCount(0)
    await page.keyboard.press('Control+K')
    await expect(page.getByRole('dialog').getByRole('combobox')).toBeVisible()
    await page.keyboard.press('Escape')

    expect(consoleErrors.filter(line => /reading 'rows'|ErrorBoundary caught/.test(line))).toEqual([])
  } finally {
    await Promise.race([app.close().catch(() => undefined), new Promise(resolve => setTimeout(resolve, 4000))])
  }
})
