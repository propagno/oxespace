import type { Page } from '@playwright/test'

/**
 * Opens Settings the way a person would on this screen. Since 1.5.2 the title bar has no Settings button (the user's
 * call, 13/11): it is in every sidebar's footer ("Open settings"), in the menu bar and on Mod+,. A screen with no
 * sidebar (first run) opens it with the shortcut. `name` is the footer button's accessible name in the test's language.
 *
 * The title bar comes first: on a slow CI machine a fresh profile shows the sidebar for a moment before the first-run
 * screen replaces it, and a click aimed at that footer then waited out the whole test (OXE-103, Windows shard 2/3 on
 * main since #790). A footer that goes away before the click hands over to the shortcut.
 */
export async function openSettings(page: Page, name = 'Open settings'): Promise<void> {
  await page.locator('button[data-app-mode]').first().waitFor()
  const button = page.getByRole('button', { name, exact: true }).first()
  if (await button.isVisible()) {
    try {
      await button.click({ timeout: 3000 })
      return
    } catch {
      // The sidebar left meanwhile (first run): the shortcut below.
    }
  }
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Comma' : 'Control+Comma')
}
