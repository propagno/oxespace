import { expect, test } from '@playwright/test'
import { launchApp } from './helpers/launch'

/**
 * F26 canary on the real Electron: the close guard holds a quit by wrapping `app.emit`, which works only while
 * Electron routes its native `before-quit` through the JS `emit`. If an Electron upgrade changes that, the quit here
 * is no longer held, the app goes away mid-test, and this fails before anyone ships an unguarded close.
 * (The guard itself fails open in that case: quitting works as it did before F26.)
 */
test('Electron still routes before-quit through app.emit, so the close guard can hold a quit', async () => {
  test.setTimeout(120_000)
  const { app, page } = await launchApp()
  try {
    const result = await app.evaluate(() => (globalThis as unknown as { __oxeCloseGateCanary?: () => Promise<{ asked: number; listenerRan: boolean }> }).__oxeCloseGateCanary?.())
    expect(result).toEqual({ asked: 1, listenerRan: false })
    // Still running after the held quit: the window answers.
    expect(await page.evaluate(() => document.readyState)).toBe('complete')
  } finally {
    await app.close()
  }
})
