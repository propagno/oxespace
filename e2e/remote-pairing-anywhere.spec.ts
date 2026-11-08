import { expect, test } from '@playwright/test'
import { launchApp, openDemoWorkspace } from './helpers/launch'

/**
 * T86, from the user (1.4.1, a real phone): a phone asking to pair got no answer unless Settings › Devices happened to
 * be open, so "nothing happens". The question now reaches the person wherever they are: here it comes in while they
 * work in OxeCode, with Settings closed, and is answered there.
 */
test('a phone asking to pair is answered with Settings closed', async () => {
  test.setTimeout(90_000)
  const { app, page, workspaceRoot, consoleErrors } = await launchApp()
  try {
    await openDemoWorkspace(page, workspaceRoot)
    await expect(page.locator('.settings-center')).toHaveCount(0)
    // The app follows the gateway at idle after the first paint; ask until the window is listening.
    const dialog = page.getByRole('dialog', { name: 'Pair Galaxy S25?' })
    await expect.poll(async () => {
      await app.evaluate(() => (globalThis as { __oxeRemoteAskToPair?: (name: string) => void }).__oxeRemoteAskToPair?.('Galaxy S25'))
      return dialog.isVisible()
    }, { intervals: [500], timeout: 15_000 }).toBe(true)
    await expect(dialog.getByTestId('devices-pairing-verification')).toHaveText('28T5CY')
    // Refuse is where focus starts: Enter by mistake never pairs a phone.
    await expect(dialog.getByRole('button', { name: 'Refuse' })).toBeFocused()
    await dialog.getByRole('button', { name: 'Pair', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('[data-toast]').filter({ hasText: 'Galaxy S25' })).toBeVisible()
    expect(consoleErrors.filter(line => line.startsWith('pageerror:'))).toEqual([])
  } finally {
    await app.close()
  }
})
