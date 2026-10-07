import { _electron as electron, expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// A bounded retry distinguishes a transient Electron exit on a shared CI runner
// from a reproducible failure of the restart/persistence assertion.
test.describe.configure({ retries: 1 })

test('browser tabs and agent consent are ephemeral across app restart', async () => {
  test.setTimeout(60_000)
  const root = mkdtempSync(join(tmpdir(), 'oxe-preview-restart-'))
  const repo = join(root, 'repo')
  mkdirSync(repo)
  const server = createServer((_request,response) => {response.setHeader('Content-Type','text/html');response.end('<!doctype html><title>Restart preview</title>Ready')})
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve))
  const address = server.address()
  const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/`
  const env = {...process.env,OXESPACE_DISABLE_SINGLE_INSTANCE:'1',OXESPACE_E2E_MOCK_NATIVE:'0',OXESPACE_DB_PATH:join(root,'db.sqlite3')}
  const launch = () => electron.launch({args:[join(process.cwd(),'e2e/electron-main.cjs')],env})
  let app = await launch()
  try {
    let page = await app.firstWindow()
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-launch-btn').click()
    await page.getByTestId('btn-open-tools').click()
    await page.getByText('Web Preview',{exact:true}).click()
    const ownerKey = (await page.locator('.web-preview-panel').getAttribute('data-browser-owner'))!
    await page.locator('.web-preview-address-input').fill(url)
    await page.locator('.web-preview-address-input').press('Enter')
    await expect.poll(() => app.evaluate(({webContents},baseUrl) => webContents.getAllWebContents().some(contents => contents.getURL() === baseUrl),url)).toBe(true)
    page.once('dialog',dialog => dialog.accept())
    await page.getByLabel('Agent documentation access').check()
    const firstSessionId = await page.evaluate(async key => (await window.oxe.browserPreview.session({ownerKey:key,action:'open'})).sessionId,ownerKey)
    await app.close()

    app = await launch()
    page = await app.firstWindow()
    await page.getByTestId('btn-new-workspace').waitFor({state:'visible'})
    await expect(page.getByTestId('sidebar-workspace-item')).toHaveCount(1)
    await page.getByTestId('sidebar-workspace-item').click()
    await page.getByTestId('btn-open-tools').click()
    await page.getByText('Web Preview',{exact:true}).click()
    await expect(page.locator('.web-preview-address-input')).toHaveValue('http://localhost:3000')
    await expect(page.getByTestId('browser-preview-native')).toHaveCount(0)
    await expect(page.getByLabel('Agent documentation access')).not.toBeChecked()
    const secondSessionId = await page.evaluate(async key => (await window.oxe.browserPreview.session({ownerKey:key,action:'open'})).sessionId,ownerKey)
    expect(secondSessionId).not.toBe(firstSessionId)
  } finally {
    await app.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
