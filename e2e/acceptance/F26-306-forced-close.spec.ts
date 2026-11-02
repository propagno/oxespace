import { expect, test, type ElectronApplication } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchReal, openRepo, quitReal, realProfile } from './real-app'

/**
 * F26 · #306 (S1) · A close the window does not answer really closes it. REAL app (the real close guard, no e2e double),
 * black box: the window is asked to close as the OS would (BrowserWindow.close()).
 * - Nothing unsaved: the window closes at once.
 * - A renderer busy for 20 s with an unsaved file: after ~3 s without an answer the window is gone, and the journal
 *   records incident.app.closeUnanswered. Before #306 the window stayed open while the page was busy.
 */
const windows = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length).catch(() => 0)
const askClose = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.close() }).catch(() => undefined)
async function closedWithin(app: ElectronApplication, ms: number): Promise<number | null> {
  const start = Date.now()
  while (Date.now() - start < ms) { if ((await windows(app)) === 0) return Date.now() - start; await new Promise(r => setTimeout(r, 100)) }
  return null
}

test('F26/#306 real app: nothing unsaved closes at once', async () => {
  test.setTimeout(120_000)
  const profile = realProfile('f26calm', { OXESPACE_LOCALE: 'en-US' })
  const { app, page } = await launchReal(profile)
  try {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = (() => new Promise(() => undefined)) as typeof dialog.showMessageBox; dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync })
    await openRepo(page, profile.repo)
    await askClose(app)
    const closed = await closedWithin(app, 5_000)
    console.log('F26-CALM', closed)
    expect(closed, 'the window closes with nothing to save').not.toBeNull()
  } finally { await quitReal(app) }
})

test('F26/#306 real app: a renderer that never answers is closed after ~3 s and journalled', async () => {
  test.setTimeout(150_000)
  const profile = realProfile('f26hung', { OXESPACE_LOCALE: 'en-US' })
  const { app, page } = await launchReal(profile)
  try {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = (() => new Promise(() => undefined)) as typeof dialog.showMessageBox; dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync })
    await openRepo(page, profile.repo)
    // An unsaved file, so the guard has something to ask about.
    writeFileSync(join(profile.repo, 'note.txt'), 'original\n')
    await page.keyboard.press('Control+k'); await page.locator('[cmdk-item][data-value="cmd-tool-editor"]').click()
    await page.locator('.editor-browser-file', { hasText: 'note.txt' }).first().click({ timeout: 10_000 })
    await page.locator('.monaco-editor').first().click({ timeout: 10_000 })
    await page.keyboard.press('Control+End'); await page.keyboard.insertText('changed, not saved\n')
    await page.waitForTimeout(500)
    const userData = await app.evaluate(({ app }) => app.getPath('userData'))
    void page.evaluate(() => { const end = Date.now() + 20_000; while (Date.now() < end) { /* busy */ } }).catch(() => undefined)
    await new Promise(r => setTimeout(r, 300))
    await askClose(app)
    const closed = await closedWithin(app, 10_000)
    await new Promise(r => setTimeout(r, 800))
    const journal = join(userData, 'diagnostics', 'incidents.json')
    const text = existsSync(journal) ? readFileSync(journal, 'utf8') : ''
    console.log('F26-HUNG', JSON.stringify({ closed, journal: text.slice(0, 600) }))
    expect.soft(closed, 'the window is gone while the page is still busy').not.toBeNull()
    expect.soft(closed ?? Infinity, 'within ~3 s plus margin').toBeLessThan(7_000)
    expect.soft(text, 'the unanswered close is journalled').toContain('closeUnanswered')
  } finally { await quitReal(app) }
})
