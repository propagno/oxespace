import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication } from '@playwright/test'
import { launchApp, openDemoWorkspace, resizeWindow } from './helpers/launch'

/**
 * F26, nothing lost on close. Main asks the window before a close or a quit (app:close-requested); in E2E runs the
 * double in electron/main/e2e/close-guard-mock.ts asks the same way and records the answers and outcomes. With nothing
 * unsaved the window lets it close at once; with an edited file it holds, lists the file with Cancel focused, and
 * Cancel, "Close without saving" and "Save all and close" each give main the matching answer.
 */
type Answer = { requestId: string; answer: string }
type Outcome = { requestId: string; reason: string; outcome: string }
const requestClose = (app: ElectronApplication, reason: 'close' | 'quit'): Promise<string> =>
  app.evaluate((_electron, why) => (globalThis as unknown as { __oxeRequestClose: (reason: string) => string }).__oxeRequestClose(why), reason)
const answersFor = (app: ElectronApplication, requestId: string): Promise<string[]> => app.evaluate((_electron, id) =>
  ((globalThis as unknown as { __oxeCloseAnswers?: Answer[] }).__oxeCloseAnswers ?? []).filter(item => item.requestId === id).map(item => item.answer), requestId)
const outcomeOf = (app: ElectronApplication, requestId: string): Promise<string | undefined> => app.evaluate((_electron, id) =>
  ((globalThis as unknown as { __oxeCloseOutcomes?: Outcome[] }).__oxeCloseOutcomes ?? []).find(item => item.requestId === id)?.outcome, requestId)

test('closing asks only when something is unsaved, and each answer does what it says', async () => {
  test.setTimeout(150_000)
  const { app, page, workspaceRoot, consoleErrors } = await launchApp()
  try {
    await resizeWindow(app, 1280, 800)
    writeFileSync(join(workspaceRoot, 'notes.txt'), '# notes\n')
    await openDemoWorkspace(page, workspaceRoot)

    // Nothing unsaved: the window answers "proceed" straight away and no dialog shows.
    const clean = await requestClose(app, 'close')
    await expect.poll(() => answersFor(app, clean)).toEqual(['proceed'])
    await expect(page.getByTestId('unsaved-work-dialog')).toHaveCount(0)

    // Edit a file without saving it.
    await page.keyboard.press('Control+k')
    await page.locator('[cmdk-item][data-value="cmd-tool-editor"]').click()
    await page.locator('.editor-browser-file', { hasText: 'notes.txt' }).click()
    const editor = page.locator('.editor-monaco-host .monaco-editor').first()
    await editor.waitFor({ state: 'visible' })
    await editor.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('unsaved line')

    // Held, listed, Cancel focused; Cancel keeps the window and the edit.
    const cancelled = await requestClose(app, 'close')
    const dialog = page.getByTestId('unsaved-work-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Save your changes before closing?')
    await expect(dialog).toContainText('notes.txt')
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await page.waitForTimeout(300)
    await page.screenshot({ path: 'test-results/close-guard-dialog.png' })
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect.poll(() => answersFor(app, cancelled)).toEqual(['hold', 'cancel'])
    await expect.poll(() => outcomeOf(app, cancelled)).toBe('cancel')
    expect(readFileSync(join(workspaceRoot, 'notes.txt'), 'utf8')).toBe('# notes\n')

    // A quit says so; "Save all and quit" writes the file, then lets it go.
    const saved = await requestClose(app, 'quit')
    await expect(dialog).toContainText('Save your changes before quitting?')
    await dialog.getByRole('button', { name: 'Save all and quit' }).click()
    await expect(dialog).toHaveCount(0)
    await expect.poll(() => answersFor(app, saved)).toEqual(['hold', 'proceed'])
    expect(readFileSync(join(workspaceRoot, 'notes.txt'), 'utf8')).toContain('unsaved line')

    // Saved now: the next close goes through without asking.
    const after = await requestClose(app, 'close')
    await expect.poll(() => answersFor(app, after)).toEqual(['proceed'])
    await expect(dialog).toHaveCount(0)

    expect(consoleErrors.filter(line => line.startsWith('pageerror'))).toEqual([])
  } finally {
    await app.close()
  }
})
