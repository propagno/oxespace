import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('native clipboard writes text and saves a PNG through the preload bridge', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oxe-clipboard-'))
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '0', OXESPACE_DB_PATH: join(root, 'db.sqlite3')
  } })
  try {
    const page = await app.firstWindow()
    await page.waitForURL(/index\.html/)
    await page.getByTestId('btn-new-workspace').waitFor()
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.show(); window.focus() })
    await app.evaluate(async ({ clipboard }) => {
      const previous = await clipboard.read()
      ;(globalThis as typeof globalThis & { restoreTestClipboard?: () => Promise<void> }).restoreTestClipboard = async () => {
        await clipboard.write(previous)
      }
    })
    await app.evaluate(async ({ clipboard }) => { await clipboard.writeText('OXESpace native clipboard preflight') })
    expect(await app.evaluate(async ({ clipboard }) => (await clipboard.readText()) === 'OXESpace native clipboard preflight')).toBe(true)
    expect(await page.evaluate(() => window.oxe.clipboard.writeText('OXESpace native clipboard\nsecond line'))).toBe(true)
    expect(await app.evaluate(async ({ clipboard }) => (await clipboard.readText()).replace(/\r\n/g, '\n'))).toBe('OXESpace native clipboard\nsecond line')
    await app.evaluate(async ({ clipboard, ClipboardItem, nativeImage }) => {
      const png = nativeImage.createFromBitmap(Buffer.from([0, 0, 255, 255]), { width: 1, height: 1 }).toPNG()
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])
    })
    const saved = await page.evaluate(() => window.oxe.clipboard.saveImageToTemp())
    expect(saved).toBeTruthy()
    expect(readFileSync(saved!).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(await app.evaluate(({ nativeImage }, path) => nativeImage.createFromPath(path).getSize(), saved!)).toEqual({ width: 1, height: 1 })
  } finally {
    await app.evaluate(async () => {
      const state = globalThis as typeof globalThis & { restoreTestClipboard?: () => Promise<void> }
      await state.restoreTestClipboard?.()
      delete state.restoreTestClipboard
    }).catch(() => {})
    await app.close()
  }
})
