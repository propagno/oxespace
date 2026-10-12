import { _electron as electron, expect, test } from '@playwright/test'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const source = process.env.OXESPACE_AUDIT_DB
const threadId = process.env.OXESPACE_AUDIT_THREAD_ID

test('a long restored Thread stays visually still at the bottom', async () => {
  test.skip(!source || !threadId || !existsSync(source), 'Set OXESPACE_AUDIT_DB and OXESPACE_AUDIT_THREAD_ID')
  test.setTimeout(180000)
  const root = mkdtempSync(join(tmpdir(), 'oxe-thread-stability-'))
  const dbPath = join(root, 'audit.sqlite3')
  copyFileSync(source!, dbPath)
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_DB_PATH: dbPath
  } })
  try {
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole('button', { name: 'Thread', exact: true }).click()
    const thread = await page.evaluate(id => window.oxe.thread!.read(id), threadId!)
    await page.locator('.thread-navigation-item').filter({ hasText: thread.thread.title.slice(0, 25) }).first().click()
    await expect(page.getByRole('heading', { name: thread.thread.title, exact: true })).toBeVisible()
    for (let index = 0; index < 100; index++) {
      const loaded = await page.evaluate(() => {
        const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(candidate => candidate.textContent?.includes('Load earlier messages'))
        if (!button) return true
        button.click()
        return false
      })
      if (loaded) break
      await page.waitForTimeout(150)
    }
    await expect(page.getByRole('button', { name: 'Load earlier messages' })).toHaveCount(0)
    await page.evaluate(() => document.fonts.ready)
    const samples = await page.locator('.thread-timeline').evaluate(async element => {
      const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      element.scrollTop = element.scrollHeight
      for (let index = 0; index < 100; index++) await nextFrame()
      const values: Array<{ top: number; viewportTop: number; viewportHeight: number; scrollTop: number; scrollHeight: number; paddingTop: string }> = []
      for (let index = 0; index < 120; index++) {
        await nextFrame()
        const last = element.querySelector<HTMLElement>('.thread-virtual-row:last-child')
        const space = element.querySelector<HTMLElement>('.thread-virtual-space')
        values.push({ top: last?.getBoundingClientRect().top ?? -1, viewportTop: element.getBoundingClientRect().top, viewportHeight: element.clientHeight, scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, paddingTop: space ? getComputedStyle(space).paddingTop : '' })
      }
      const nearEnd = [] as Array<{ distance: number; drift: number; scrollChanges: number }>
      for (const distance of [80, 200, 400, 800]) {
        element.scrollTop = element.scrollHeight - element.clientHeight - distance
        const positions: number[] = []
        for (let index = 0; index < 100; index++) {
          await nextFrame()
          if (index >= 30) positions.push(element.scrollTop)
        }
        nearEnd.push({ distance, drift: Math.max(...positions) - Math.min(...positions), scrollChanges: new Set(positions).size })
      }
      return { values, nearEnd }
    })
    const tops = samples.values.map(sample => sample.top)
    const jitter = Math.max(...tops) - Math.min(...tops)
    console.log('Thread bottom stability', { jitter, start: samples.values[0], end: samples.values.at(-1), topSamples: [...new Set(tops)].slice(0, 12), nearEnd: samples.nearEnd })
    expect(jitter).toBeLessThanOrEqual(1)
    expect(samples.nearEnd.every(sample => sample.drift <= 1)).toBe(true)
  } finally {
    // The copied long session can stall Electron's graceful shutdown; the
    // audit never writes back to the original database.
    const child = app.process()
    if (process.platform === 'win32' && child.pid) {
      try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { child.kill() }
    } else child.kill()
    if (child.exitCode === null) await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 5000)
      child.once('exit', () => { clearTimeout(timer); resolve() })
    })
    rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 })
  }
})
