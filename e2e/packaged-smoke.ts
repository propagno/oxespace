import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

/**
 * Shared body of the packaged-artifact smoke tests.
 *
 * This is the only check that runs the REAL shipped binary — asar-packed, with
 * the native modules and extraResources laid out as the user gets them. The
 * unpackaged E2E suite cannot catch a broken asarUnpack entry, a missing
 * extraResource or a native module built for the wrong ABI, because in dev
 * those all resolve from node_modules.
 *
 * Kept in one place so the Windows and Linux specs cannot drift: the whole
 * point is that both platforms are held to the same bar.
 */
export interface PackagedSmokeOptions {
  /** Host this spec is meaningful on; skipped everywhere else. */
  platform: NodeJS.Platform
  /** Human label for the test title. */
  label: string
  /**
   * Boot-to-interactive budget. Windows runners are slower off cold start
   * (Defender scans the freshly written binary), so the two differ on purpose.
   */
  bootBudgetMs: number
}

export function registerPackagedSmoke({ platform, label, bootBudgetMs }: PackagedSmokeOptions): void {
  test(`packaged ${label} build boots with a native terminal and Web Preview`, async () => {
    test.setTimeout(60_000)
    test.skip(process.platform !== platform, `${label} packaged artifact check`)

    const executablePath = process.env.OXESPACE_PACKAGED_EXECUTABLE
    expect(executablePath, 'OXESPACE_PACKAGED_EXECUTABLE').toBeTruthy()
    expect(existsSync(executablePath!), `packaged executable ${executablePath}`).toBe(true)

    const root = join(tmpdir(), `oxe-packaged-${platform}-${Date.now()}`)
    const workspaceRoot = join(root, 'workspace')
    mkdirSync(workspaceRoot, { recursive: true })

    const started = performance.now()
    const app = await electron.launch({
      executablePath,
      env: {
        ...process.env,
        OXESPACE_DISABLE_SINGLE_INSTANCE: '1',
        OXESPACE_DB_PATH: join(root, 'db.sqlite3')
      }
    })

    const server = createServer((_request,response) => {response.setHeader('Content-Type','text/html');response.end('<!doctype html><title>Packaged preview</title><h1>Preview ready</h1>')})
    await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve))
    const address = server.address()
    const previewUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/`

    try {
      const page = await app.firstWindow()
      await page.getByTestId('btn-new-workspace').waitFor({ state: 'visible' })
      const bootMs = Math.round(performance.now() - started)
      expect(bootMs, `packaged ${label} boot to interactive`).toBeLessThan(bootBudgetMs)
      expect(await page.evaluate(() => window.oxe.app.platform)).toBe(platform)
      expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)

      // Creating a workspace exercises the parts that only exist in a packaged
      // build: better-sqlite3 opening a real DB, the migrations copied to
      // out/main/migrations, and node-pty spawning the platform's neutral shell.
      await page.getByTestId('btn-new-workspace').click()
      await page.getByTestId('wizard-dir-input').fill(workspaceRoot)
      await page.getByTestId('wizard-layout-card-1').click()
      await page.getByTestId('wizard-launch-btn').click()
      await expect(
        page.getByTestId('terminal-status-label').filter({ hasText: 'running' }).first()
      ).toBeVisible({ timeout: 10_000 })
      const metrics = () => app.evaluate(({app,webContents},url) => {
        const processes = app.getAppMetrics()
        return {
          processCount:processes.length,
          workingSetMb:Math.round(processes.reduce((sum,item) => sum + item.memory.workingSetSize,0)/1024),
          guestCount:webContents.getAllWebContents().filter(contents => contents.getURL().startsWith(url)).length
        }
      },previewUrl)
      const beforePreview = await metrics()
      await page.getByTestId('btn-open-tools').click()
      await page.getByText('Web Preview',{exact:true}).click()
      for (let count = 1; count <= 4; count++) {
        if (count > 1) await page.getByRole('button',{name:'New browser tab'}).click()
        await page.locator('.web-preview-address-input').fill(`${previewUrl}?tab=${count}`)
        await page.locator('.web-preview-address-input').press('Enter')
        await expect.poll(async () => (await metrics()).guestCount).toBe(count)
      }
      const withFour = await metrics()
      await page.getByTestId('workspace-web-preview-panel').getByRole('button',{name:'Collapse panel'}).click()
      await expect.poll(async () => (await metrics()).guestCount).toBe(0)
      const afterClose = await metrics()
      const result = {platform,bootMs,beforePreview,withFour,afterClose}
      writeFileSync(test.info().outputPath(`packaged-${platform}-preview-metrics.json`),JSON.stringify(result,null,2))
      console.log('[packaged-preview]',JSON.stringify(result))
      if (platform === 'win32') {
        expect(withFour.workingSetMb - beforePreview.workingSetMb).toBeLessThan(600)
        expect(afterClose.workingSetMb - beforePreview.workingSetMb).toBeLessThan(160)
        expect(afterClose.processCount).toBe(beforePreview.processCount)
      }
    } finally {
      await app.close()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })
}
