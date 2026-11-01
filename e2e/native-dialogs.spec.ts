import { expect, test } from '@playwright/test'
import { launchApp } from './helpers/launch'

/**
 * Harness safety: in every E2E launch, Electron's native dialogs are recorders that answer cancel
 * (e2e/helpers/native-dialogs.cjs, installed by e2e/electron-main.cjs before main loads), so a test never shows a
 * system dialog on the runner's screen. This checks it inside a real launch, from main.
 */
test('native dialogs are recorded and answered cancel, never shown', async () => {
  const { app } = await launchApp()
  try {
    const seen = await app.evaluate(async ({ dialog }) => {
      const box = await dialog.showMessageBox({ title: 'Allow this?', message: 'probe', buttons: ['Allow', 'Deny'] })
      const open = await dialog.showOpenDialog({ properties: ['openDirectory'] })
      const calls = (globalThis as unknown as { __oxeNativeDialogs?: Array<{ method: string; title: string }> }).__oxeNativeDialogs ?? []
      return { response: box.response, canceled: open.canceled, calls: calls.filter(c => c.title === 'Allow this?' || c.method === 'showOpenDialog').map(c => c.method) }
    })
    expect(seen.response, 'the deny button').toBe(1)
    expect(seen.canceled).toBe(true)
    expect(seen.calls).toEqual(expect.arrayContaining(['showMessageBox', 'showOpenDialog']))
  } finally { await app.close() }
})
