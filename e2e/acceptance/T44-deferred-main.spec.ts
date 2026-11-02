import { expect, test, type Page } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchReal, quitReal, realProfile } from './real-app'

/**
 * T44 · #425 · The updater and automations load after the first window. Black box on the REAL app: nothing changed for
 * the person.
 * - Cold boot to the first screen, twice (a fresh profile, then the same profile again).
 * - Settings › Updates: "Check for updates" answers; the beta channel can be turned on and is still on after a restart.
 * - A scheduled automation (every minute) fires on its own, before and after a restart (the restart is the deferred path).
 *   Its precheck writes a marker and exits 1, so the run is skipped at the precheck: no agent is ever started.
 */
const oxe = <T>(page: Page, expression: string) => page.evaluate(expression) as Promise<T>
type Run = { status: string; scheduledFor: number; startedAt: number | null }

async function openUpdates(page: Page) {
  await page.keyboard.press('Control+k'); await page.keyboard.insertText('Settings')
  await page.locator('[cmdk-item]', { hasText: 'Settings' }).first().click()
  const settings = page.getByRole('dialog').filter({ has: page.getByRole('navigation', { name: 'Settings categories' }) }).first()
  await settings.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: /^Updates/ }).click()
  await page.waitForTimeout(800)
  return settings
}

test('T44: boot, updates and a scheduled automation behave as before, across a restart', async () => {
  test.setTimeout(420_000)
  const profile = realProfile('t44', { OXESPACE_LOCALE: 'en-US' })
  const marker = join(profile.repo, 'precheck-ran.txt')
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

    // A daily automation due two minutes from now (the shortest interval is 5 minutes), whose precheck stops it before
    // any agent. Run now first: the manual path.
    const precheck = `node -e "require('fs').appendFileSync('precheck-ran.txt', Date.now() + '\\n'); process.exit(1)"`
    const due = new Date(Date.now() + 2 * 60_000)
    const created = await oxe<{ id: string; nextRunAt: number | null }>(page, `window.oxe.automations.create(${JSON.stringify({
      name: 'hml-t44', prompt: 'never runs', rootPath: profile.repo, agent: 'claude', schedule: { kind: 'daily', hour: due.getHours(), minute: due.getMinutes() }, precheck, graceMinutes: 10, enabled: true
    })})`)
    out.created = { nextRunAt: created.nextRunAt, inMs: created.nextRunAt ? created.nextRunAt - Date.now() : null }
    const runs = () => oxe<Run[]>(page, `window.oxe.automations.runs(${JSON.stringify(created.id)})`)
    await oxe(page, `window.oxe.automations.runNow(${JSON.stringify(created.id)})`)
    await expect.poll(async () => (await runs()).length, { timeout: 60_000, intervals: [2_000], message: 'run now runs' }).toBeGreaterThan(0)
    out.runsBefore = (await runs()).map(r => r.status)
    out.markerBefore = existsSync(marker) ? readFileSync(marker, 'utf8').trim().split('\n').length : 0

    // Closed across the due time, then the same profile again: the automations load through the deferred path, and the
    // run that came due while the app was closed (within its grace) runs at the wake.
    await quitReal(app)
    const dueAt = created.nextRunAt ?? due.getTime()
    while (Date.now() < dueAt + 20_000) await new Promise(r => setTimeout(r, 5_000))
    const restartedAt = Date.now()
    ;({ app, page } = await launchReal(profile))
    out.bootAgain = Date.now() - restartedAt
    page.on('pageerror', e => errors.push(e.message.slice(0, 200)))
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (() => new Promise(() => undefined)) as typeof dialog.showMessageBox
      dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync
    })
    const listed = await oxe<Array<{ id: string; enabled: boolean; nextRunAt: number | null }>>(page, 'window.oxe.automations.list()')
    out.listedAfterRestart = listed.map(a => ({ enabled: a.enabled, nextInMs: a.nextRunAt ? a.nextRunAt - Date.now() : null }))
    await expect.poll(async () => (await runs()).filter(r => (r.startedAt ?? 0) >= restartedAt || r.scheduledFor >= dueAt - 60_000).length,
      { timeout: 120_000, intervals: [5_000], message: 'the run due while closed runs at the wake' }).toBeGreaterThan(0)
    out.runsAfter = (await runs()).map(r => r.status)
    out.markerAfter = existsSync(marker) ? readFileSync(marker, 'utf8').trim().split('\n').length : 0
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
  expect.soft((out.runsBefore as string[]).every(s => s === 'skipped_precheck'), `runs before: ${JSON.stringify(out.runsBefore)}`).toBe(true)
  expect.soft(out.markerAfter as number, 'the precheck ran again after the restart').toBeGreaterThan(out.markerBefore as number)
  expect.soft(errors, 'no page error').toEqual([])
})
