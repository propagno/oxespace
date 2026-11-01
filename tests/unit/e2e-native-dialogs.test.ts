// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

type Dialog = Record<string, (...args: unknown[]) => unknown>
const { installNativeDialogStubs } = createRequire(import.meta.url)('../../e2e/helpers/native-dialogs.cjs') as {
  installNativeDialogStubs: (dialog: Dialog, env: Record<string, string | undefined>, store?: Record<string, unknown>) => boolean
}

const METHODS = ['showMessageBox', 'showMessageBoxSync', 'showOpenDialog', 'showOpenDialogSync', 'showSaveDialog', 'showSaveDialogSync', 'showErrorBox', 'showCertificateTrustDialog']
const real = (): Dialog => Object.fromEntries(METHODS.map(m => [m, () => { throw new Error(`real ${m} reached`) }]))
const fakeWindow = { webContents: {} }

describe('no test run shows a native dialog on the runner\'s screen (harness safety)', () => {
  it('replaces every dialog method with a recorder that answers cancel', async () => {
    const dialog = real(), store: Record<string, unknown> = {}
    expect(installNativeDialogStubs(dialog, {}, store)).toBe(true)
    // With a window first, as main calls them, and without.
    expect(await dialog.showMessageBox(fakeWindow, { title: 'Allow?', message: 'Run it', buttons: ['Allow', 'Deny'] })).toEqual({ response: 1, checkboxChecked: false })
    expect(await dialog.showMessageBox({ message: 'x', buttons: ['Allow', 'Cancel'], cancelId: 1 })).toEqual({ response: 1, checkboxChecked: false })
    expect(dialog.showMessageBoxSync({ message: 'x', buttons: ['Permitir', 'Negar'] })).toBe(1)
    expect(dialog.showMessageBoxSync({ message: 'x', buttons: ['Sair', 'Ficar', 'Mais tarde'] }), 'several buttons, none reads as cancel: the last').toBe(2)
    expect(dialog.showMessageBoxSync({ message: 'only ok' })).toBe(0)
    expect(await dialog.showOpenDialog(fakeWindow, { properties: ['openDirectory'] })).toEqual({ canceled: true, filePaths: [] })
    expect(dialog.showOpenDialogSync({})).toBeUndefined()
    expect(await dialog.showSaveDialog({})).toEqual({ canceled: true, filePath: '' })
    expect(dialog.showSaveDialogSync({})).toBeUndefined()
    expect(() => dialog.showErrorBox('Crash', 'details')).not.toThrow()
    await expect(dialog.showCertificateTrustDialog(fakeWindow, {})).resolves.toBeUndefined()
    const calls = store.__oxeNativeDialogs as Array<{ method: string; title: string; message: string }>
    expect(calls.map(c => c.method)).toEqual(['showMessageBox', 'showMessageBox', 'showMessageBoxSync', 'showMessageBoxSync', 'showMessageBoxSync', 'showOpenDialog', 'showOpenDialogSync', 'showSaveDialog', 'showSaveDialogSync', 'showErrorBox', 'showCertificateTrustDialog'])
    expect(calls[0]).toMatchObject({ title: 'Allow?', message: 'Run it' })
    expect(calls[9]).toMatchObject({ title: 'Crash', message: 'details' })
  })

  it('leaves the real dialogs only when a spec opts in', () => {
    const dialog = real()
    expect(installNativeDialogStubs(dialog, { OXESPACE_E2E_NATIVE_DIALOGS: '1' })).toBe(false)
    expect(() => dialog.showMessageBoxSync({})).toThrow('real showMessageBoxSync reached')
  })

  it('can hold the async message box unanswered, as a person who has not clicked yet', async () => {
    const dialog = real(), store: Record<string, unknown> = {}
    installNativeDialogStubs(dialog, { OXESPACE_E2E_NATIVE_DIALOGS: 'hold' }, store)
    const answer = await Promise.race([dialog.showMessageBox({ message: 'x', buttons: ['Allow', 'Deny'] }), new Promise(resolve => setTimeout(() => resolve('still waiting'), 50))])
    expect(answer).toBe('still waiting')
    expect((store.__oxeNativeDialogs as Array<{ answer: unknown }>)[0].answer).toBe('held')
  })

  it('is installed by the e2e entry before main loads, and for packaged launches by the launch patch', () => {
    const entry = readFileSync(join('e2e', 'electron-main.cjs'), 'utf8')
    const install = entry.indexOf('installNativeDialogStubs(dialog, process.env)')
    expect(install, 'electron-main.cjs installs the stubs').toBeGreaterThan(-1)
    expect(install, 'before the app main is imported').toBeLessThan(entry.indexOf("'main', 'index.js'"))
    const patch = readFileSync(join('e2e', 'helpers', 'electron-close.ts'), 'utf8')
    expect(patch).toContain('installNativeDialogStubs.toString()')
    // Every Playwright config loads the patch, so every launch (entry or executable) is covered.
    for (const name of readdirSync('.').filter(n => /^playwright(\.[a-z]+)?\.config\.ts$/.test(n))) expect(readFileSync(name, 'utf8'), name).toContain("import './e2e/helpers/electron-close'")
  })

  it('every e2e launch goes through the entry or an executable the patch covers', () => {
    const files: string[] = []
    const walk = (dir: string): void => { for (const name of readdirSync(dir)) { const p = join(dir, name); if (statSync(p).isDirectory()) walk(p); else if (/\.ts$/.test(name)) files.push(p) } }
    walk('e2e')
    const offenders = files.filter(f => {
      const text = readFileSync(f, 'utf8')
      return /electron\.launch\(/.test(text) && !/electron-main\.cjs|executablePath/.test(text) && !/launchApp|launchReal/.test(text)
    })
    expect(offenders, 'launches that bypass the entry and the packaged path').toEqual([])
  })
})
