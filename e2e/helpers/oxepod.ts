import { expect, type Page } from '@playwright/test'

/** The views of the title bar, by their product names. */
export async function openView(page: Page, name: 'Code' | 'Thread' | 'OxeQuery' | 'OxePod' | 'OxePost'): Promise<void> {
  const navigation = page.locator('nav[aria-label="Application view"], nav[aria-label="Visão do aplicativo"]')
  await navigation.getByRole('button', { name, exact: true }).click()
  await expect(navigation.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true')
}

/** A container row in the OxePod sidebar; its name also carries the state dot and the port. */
export function containerRow(page: Page, name: string) {
  return page.getByRole('complementary', { name: /OxePod/ }).getByRole('button', { name: new RegExp(`(^|\\s)${name}(\\s|$)`) })
}

/**
 * The way a database container becomes a connection now (roadmap P5): OxePod, the container, "Connect in OxeQuery",
 * and the connection form filled in from it. The mock needs no password, so the form is saved as it comes. When a
 * connection to the container already exists, the same button opens it instead.
 */
export async function connectFromContainer(page: Page, name: string, labels = { connect: /in OxeQuery$/, save: 'Save and open' }): Promise<void> {
  await openView(page, 'OxePod')
  await containerRow(page, name).click()
  await page.getByRole('button', { name: labels.connect }).click()
  const form = page.getByRole('dialog').filter({ has: page.locator('input[type="password"]') })
  if (await form.waitFor({ timeout: 3_000 }).then(() => true, () => false)) await form.getByRole('button', { name: labels.save }).click()
  await expect(page.getByRole('tab', { name, exact: true })).toBeVisible()
}
