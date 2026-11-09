import { expect, test, type Page } from '@playwright/test'
import { launchReal, quitReal, realProfile } from './real-app'

/**
 * T44 · #425 · The updater loads after the first window. Black box on the REAL app: nothing changed for the person.
 * - Cold boot to the first screen, twice (a fresh profile, then the same profile again).
 * - Settings › Updates: "Check for updates" answers; the beta channel can be turned on and is still on after a restart.
 * Scheduled automations left the app in 1.5.0 (R8; /loop, scheduled routines and cron replace them), so nothing here
 * drives one any more.
 */
async function openUpdates(page: Page) {
  await page.keyboard.press('Control+k'); await page.keyboard.insertText('Settings')
  await page.locator('[cmdk-item]', { hasText: 'Settings' }).first().click()
  const settings = page.getByRole('dialog').filter({ has: page.getByRole('navigation', { name: 'Settings categories' }) }).first()
  await settings.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: /^Updates/ }).click()
  await page.waitForTimeout(800)
  return settings
}

test('T44: boot and updates behave as before, across a restart', async () => {
  test.setTimeout(180_000)
  const profile = realProfile('t44', { OXESPACE_LOCALE: 'en-US' })
  const out: Record<string, unknown> = {}
  const t0 = Date.now()
  let { app, page } = await launchReal(profile)
  out.bootFresh = Date.now() - t0
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message.slice(0, 200)))
  try {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (() => new Promise(() => undefined)) as typeof dialog.showMessageBox
      dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync
    })
    // Updates: the manual check answers, and beta can be chosen.
    let settings = await openUpdates(page)
    const check = settings.getByRole('button', { name: /Check for updates|Check now/i }).first()
    out.checkButton = await check.count()
    if (out.checkButton) {
      await check.click()
      await page.waitForTimeout(4_000)
    }
    out.updatesAfterCheck = (await settings.innerText()).replace(/\s+/g, ' ').match(/Updates.{0,500}/)?.[0]
    const beta = settings.getByRole('switch', { name: /beta/i }).or(settings.getByRole('checkbox', { name: /beta/i })).first()
    out.betaFound = await beta.count()
    if (out.betaFound) {
      out.betaBefore = await beta.isChecked()
      if (!out.betaBefore) await beta.click()
      await page.waitForTimeout(800)
      out.betaAfterClick = await beta.isChecked()
    }
    await page.keyboard.press('Escape')

    // The same profile again: the second boot goes through the deferred path.
    await quitReal(app)
    const restartedAt = Date.now()
    ;({ app, page } = await launchReal(profile))
    out.bootAgain = Date.now() - restartedAt
    page.on('pageerror', e => errors.push(e.message.slice(0, 200)))
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (() => new Promise(() => undefined)) as typeof dialog.showMessageBox
      dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync
    })
    settings = await openUpdates(page)
    const betaAgain = settings.getByRole('switch', { name: /beta/i }).or(settings.getByRole('checkbox', { name: /beta/i })).first()
    out.betaAfterRestart = await betaAgain.count() ? await betaAgain.isChecked() : 'not found'
  } finally {
    console.log('T44', JSON.stringify(out))
    await quitReal(app)
  }
  expect.soft(out.bootFresh as number, 'cold boot').toBeLessThan(15_000)
  expect.soft(out.checkButton, 'a manual check is offered').toBeGreaterThan(0)
  expect.soft(out.betaAfterClick, 'beta can be turned on').toBe(true)
  expect.soft(out.betaAfterRestart, 'beta stays on after a restart').toBe(true)
  expect.soft(errors, 'no page error').toEqual([])
})
