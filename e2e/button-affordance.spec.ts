import { expect, test, type Page } from '@playwright/test'
import { launchApp } from './helpers/launch'
import { openView } from './helpers/oxepod'
import type { AppMode } from './helpers/modes'

/**
 * A design-system Button reads as a button at rest, not only on hover. Legacy region resets such as
 * `.thread-navigation button { background: transparent; border: 0 }` out-ranked the variant's class and left secondary
 * Buttons as bare text in every sidebar built on .thread-navigation (OxeQuery, OxePod, OxePost, OxeChat) and in the
 * conversation. The audit reads the computed style of every visible secondary Button in each view, light and dark.
 */
const AUDIT = `(() => {
  const transparent = (value) => value === 'transparent' || /rgba?\\([^)]*,\\s*0\\)$/.test(value) || /\\/\\s*0\\)$/.test(value)
  const out = []
  for (const element of document.querySelectorAll('button[class*="_button_"][class*="_secondary_"]')) {
    const box = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    if (box.width === 0 || box.height === 0 || style.visibility === 'hidden' || style.display === 'none') continue
    if (element.closest('[aria-hidden="true"], [inert]')) continue
    const border = parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== 'none' && !transparent(style.borderTopColor)
    const fill = !transparent(style.backgroundColor)
    if (!border || !fill) out.push({ text: (element.textContent || element.getAttribute('aria-label') || '').trim().slice(0, 40), border: style.borderTopWidth + ' ' + style.borderTopColor, background: style.backgroundColor, region: element.closest('[class]')?.parentElement?.className?.toString().slice(0, 60) })
  }
  return out
})()`

const count = (page: Page) => page.evaluate(() => document.querySelectorAll('button[class*="_button_"][class*="_secondary_"]').length)

test('secondary Buttons keep their border and fill at rest in every view, light and dark', async () => {
  test.setTimeout(240_000)
  // The views switch on timers, which a frozen clock would hold on the first one.
  const { app, page, workspaceRoot } = await launchApp({ locale: 'en-US', realClock: true })
  try {
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1280, 820) })
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(workspaceRoot)
    await page.getByTestId('wizard-layout-card-1').click()
    await page.getByTestId('wizard-launch-btn').click()

    // The reported case: OxeQuery with no connection offers "Add connection" in its sidebar.
    await openView(page, 'data')
    const add = page.getByRole('button', { name: 'Add connection', exact: true })
    await expect(add).toBeVisible()

    const report: Record<string, unknown[]> = {}
    let audited = 0
    for (const mode of ['light', 'dark'] as const) {
      await page.evaluate(value => { document.documentElement.dataset.mode = value }, mode)
      for (const view of ['data', 'pods', 'post', 'thread', 'code'] as AppMode[]) {
        await openView(page, view)
        await page.waitForTimeout(400)
        audited += await count(page)
        report[`${mode} ${view}`] = await page.evaluate(AUDIT) as unknown[]
      }
      await openView(page, 'data')
      await expect(add).toBeVisible()
      await page.screenshot({ path: `test-results/button-affordance-oxequery-${mode}.png` })
    }
    expect(audited, 'the views rendered secondary Buttons to audit').toBeGreaterThan(0)
    const failing = Object.fromEntries(Object.entries(report).filter(([, list]) => list.length > 0))
    expect(failing, JSON.stringify(failing, null, 1)).toEqual({})
    const addStyle = await add.evaluate(element => { const style = getComputedStyle(element); return { border: style.borderTopWidth, background: style.backgroundColor } })
    expect(addStyle.border).not.toBe('0px')
    expect(addStyle.background).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/)
  } finally { await app.close() }
})
