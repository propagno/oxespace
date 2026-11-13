import type { Page } from '@playwright/test'

/**
 * Opens Settings the way a person would on this screen. Since 1.5.2 the title bar has no Settings button (the user's
 * call, 13/11): it is in every sidebar's footer ("Open settings"), in the menu bar and on Mod+,. A screen with no
 * sidebar (first run) opens it with the shortcut.
 */
export async function openSettings(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: 'Open settings', exact: true }).first()
  if (await button.isVisible()) {
    await button.click()
    return
  }
  await page.locator('button[data-app-mode]').first().waitFor()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Comma' : 'Control+Comma')
}
