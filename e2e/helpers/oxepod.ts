import { modeButton, type AppMode } from './modes'
import { expect, type Page } from '@playwright/test'

/** A view of the title bar, by its mode id (e2e/helpers/modes.ts), so a renamed mode never breaks a spec. */
export async function openView(page: Page, mode: AppMode): Promise<void> {
  await modeButton(page, mode).click()
  await expect(modeButton(page, mode)).toHaveAttribute('aria-pressed', 'true')
}

/** A container row in the sidebar; its name also carries the state dot and the port. */
export function containerRow(page: Page, name: string) {
  return page.getByRole('complementary').getByRole('button', { name: new RegExp(`(^|\\s)${name}(\\s|$)`) })
}

/**
 * The way a database container becomes a connection: OxeQuery › New connection › From a running container › Container.
 * The mock needs no password, so the form is saved as it comes.
 */
export async function connectFromContainer(page: Page, name: string, labels = { newConnection: 'New connection', fromContainer: 'From a running container', container: 'Container', save: 'Save and open' }): Promise<void> {
  await openView(page, 'data')
  await page.getByRole('button', { name: labels.newConnection }).first().click()
  await page.getByRole('radio', { name: labels.fromContainer }).click()
  const select = page.getByLabel(labels.container)
  const option = select.locator('option', { hasText: new RegExp(`^${name}\\b`) })
  await option.waitFor({ state: 'attached' })
  await select.selectOption(await option.evaluate((el: HTMLOptionElement) => el.value))
  const form = page.getByRole('dialog')
  if (await form.waitFor({ timeout: 3_000 }).then(() => true, () => false)) await form.getByRole('button', { name: labels.save }).click()
  await expect(page.getByRole('tab', { name, exact: true })).toBeVisible()
}
