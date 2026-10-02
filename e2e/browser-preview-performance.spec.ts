import { _electron as electron, expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('Web Preview startup, tab count and memory baseline', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oxe-preview-bench-'))
  const repo = join(root, 'repo')
  mkdirSync(repo)
  const server = createServer((_req, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Preview budget</title><main>Ready</main>') })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/`
  const started = performance.now()
  const app = await electron.launch({args:[join(process.cwd(),'e2e/electron-main.cjs')],env:{...process.env,OXESPACE_DISABLE_SINGLE_INSTANCE:'1',OXESPACE_E2E_MOCK_NATIVE:'1',OXESPACE_DB_PATH:join(root,'db.sqlite3')}})
  try {
    const page = await app.firstWindow()
    await page.getByTestId('btn-new-workspace').waitFor({state:'visible'})
    const bootMs = Math.round(performance.now() - started)
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-launch-btn').click()
    const panelStarted = performance.now()
    await page.getByTestId('btn-open-tools').click()
    await page.getByText('Web Preview',{exact:true}).click()
    await page.locator('.web-preview-address-input').waitFor({state:'visible'})
    const panelMs = Math.round(performance.now() - panelStarted)
    const snapshot = () => app.evaluate(({app,webContents},baseUrl) => {
      const processes = app.getAppMetrics()
      const guests = webContents.getAllWebContents().filter(contents => contents.getURL().startsWith(baseUrl))
      return {
        processCount:processes.length,
        workingSetMb:Math.round(processes.reduce((sum,item) => sum + item.memory.workingSetSize,0) / 1024),
        guestCount:guests.length,
        guestRendererPids:[...new Set(guests.map(guest => guest.getOSProcessId()))]
      }
    },url)
    const before = await snapshot()
    const loadMs: number[] = []
    for (let count = 1; count <= 4; count++) {
      if (count > 1) await page.getByRole('button',{name:'New browser tab'}).click()
      const began = performance.now()
      await page.locator('.web-preview-address-input').fill(`${url}?tab=${count}`)
      await page.locator('.web-preview-address-input').press('Enter')
      await expect.poll(async () => (await snapshot()).guestCount).toBe(count)
      await expect(page.locator('.web-preview-tab[data-active="true"]')).toHaveAttribute('data-loading','false')
      loadMs.push(Math.round(performance.now() - began))
    }
    const withFour = await snapshot()
    for (let count = 4; count > 0; count--) await page.getByRole('button',{name:'Close tab 1'}).click()
    await expect.poll(async () => (await snapshot()).guestCount).toBe(0)
    await expect.poll(async () => (await snapshot()).processCount).toBe(before.processCount)
    const afterClose = await snapshot()
    const sorted = [...loadMs].sort((a,b) => a-b)
    const result = {platform:process.platform,bootMs,panelMs,tabLoadMs:loadMs,tabLoadP95Ms:sorted[Math.ceil(sorted.length*0.95)-1],before,withFour,afterClose}
    writeFileSync(test.info().outputPath('browser-preview-performance.json'),JSON.stringify(result,null,2))
    console.log('[browser-preview-performance]',JSON.stringify(result))
    expect(afterClose.guestCount).toBe(0)
    expect(afterClose.processCount).toBe(before.processCount)
    expect(afterClose.workingSetMb - before.workingSetMb).toBeLessThan(128)
    expect(withFour.workingSetMb - before.workingSetMb).toBeLessThan(600)
    expect(panelMs).toBeLessThan(5000)
    expect(result.tabLoadP95Ms).toBeLessThan(3000)
  } finally {
    await app.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
