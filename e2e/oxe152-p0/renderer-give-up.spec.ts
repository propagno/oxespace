// Frozen end-to-end acceptance test for 1.5.2 P0 (Jira OXE-366; A3), in the built app. Written by the planner; the
// executor must not edit it. When the window's renderer dies for the 4th time within a minute main gives up reloading.
// The dialog then has to offer a way back that works: Restart OXESpace (app.relaunch, then app.quit), Try reloading
// (webContents.reload) and Close. The crash is main's own event, emitted on the real window; the native dialog, the
// relaunch, the quit and the reload are recorded instead of performed, so nothing restarts under the test.
import { expect, test, type ElectronApplication } from '@playwright/test'
import { launchApp } from '../helpers/launch'

type Shown = { buttons: string[]; relaunched: number; quit: number; reloaded: number }

/** Crashes the window past the reload limit, answers the dialog with `answer`, and returns what happened. */
async function crashUntilGiveUp(app: ElectronApplication, answer: string): Promise<Shown> {
  await app.evaluate(({ app: electronApp, dialog, BrowserWindow }, label) => {
    const state = { buttons: [] as string[], relaunched: 0, quit: 0, reloaded: 0 }
    const held = globalThis as unknown as { __p0GiveUp: typeof state; __p0Quit: () => void }
    held.__p0GiveUp = state
    held.__p0Quit = electronApp.quit.bind(electronApp)
    const window = BrowserWindow.getAllWindows()[0]
    electronApp.relaunch = () => { state.relaunched++ }
    electronApp.quit = () => { state.quit++ }
    window.webContents.reload = () => { if (state.buttons.length) state.reloaded++ }
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const options = args[args.length - 1] as Electron.MessageBoxOptions
      const buttons = options.buttons ?? []
      // The three reloads that came before are already scheduled; they run before this answer and are not counted.
      await new Promise(resolve => setTimeout(resolve, 700))
      state.buttons = buttons
      const picked = buttons.indexOf(label)
      return { response: picked < 0 ? (options.cancelId ?? buttons.length - 1) : picked, checkboxChecked: false }
    }) as typeof dialog.showMessageBox
    for (let i = 0; i < 4; i++) window.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })
  }, answer)
  const read = (): Promise<Shown> => app.evaluate(() => (globalThis as unknown as { __p0GiveUp: Shown }).__p0GiveUp)
  await expect.poll(async () => (await read()).buttons.length, { message: 'the give-up dialog is shown', timeout: 15_000 }).toBeGreaterThan(0)
  await new Promise(resolve => setTimeout(resolve, 500))
  return read()
}

async function finish(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ app: electronApp }) => { electronApp.quit = (globalThis as unknown as { __p0Quit: () => void }).__p0Quit }).catch(() => undefined)
  await app.close()
}

test('OXE-366: after repeated renderer crashes the dialog restarts OXESpace', async () => {
  test.setTimeout(90_000)
  const { app } = await launchApp()
  try {
    const shown = await crashUntilGiveUp(app, 'Restart OXESpace')
    expect(shown.buttons).toEqual(['Restart OXESpace', 'Try reloading', 'Close'])
    expect(shown.relaunched, 'Restart relaunches the app').toBe(1)
    expect(shown.quit, 'and quits this one').toBe(1)
  } finally { await finish(app) }
})

test('OXE-366: after repeated renderer crashes the dialog can reload the window without quitting', async () => {
  test.setTimeout(90_000)
  const { app } = await launchApp()
  try {
    const shown = await crashUntilGiveUp(app, 'Try reloading')
    expect(shown.buttons).toEqual(['Restart OXESpace', 'Try reloading', 'Close'])
    expect(shown.reloaded, 'Try reloading reloads the window').toBe(1)
    expect(shown.quit, 'and the app keeps running').toBe(0)
  } finally { await finish(app) }
})
