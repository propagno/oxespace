import { _electron as electron, expect, test } from '@playwright/test'
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const source = process.env.OXESPACE_AUDIT_DB
const threadId = process.env.OXESPACE_AUDIT_THREAD_ID

test('audit a copied real Thread conversation across viewports', async () => {
  test.skip(!source || !threadId || !existsSync(source), 'Set OXESPACE_AUDIT_DB and OXESPACE_AUDIT_THREAD_ID for a local visual audit')
  test.setTimeout(180000)
  const root = mkdtempSync(join(tmpdir(), 'oxe-thread-visual-'))
  const dbPath = join(root, 'audit.sqlite3')
  copyFileSync(source!, dbPath)
  const output = join(process.cwd(), 'test-results', 'thread-real-session-audit')
  mkdirSync(output, { recursive: true })
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
    while (await page.getByRole('button', { name: 'Load earlier messages' }).isVisible()) {
      await page.getByRole('button', { name: 'Load earlier messages' }).click()
      await page.waitForTimeout(250)
    }
    await expect(page.locator('.thread-virtual-space')).toHaveAttribute('data-total-rows', /[3-9][0-9][0-9]/)
    const results: Array<Record<string, unknown>> = []
    for (const [width, height] of [[900, 600], [1280, 800], [1600, 1000]]) {
      await page.setViewportSize({ width, height })
      const heading = await page.evaluate(() => {
        const title = document.querySelector('.thread-heading h1')!.getBoundingClientRect()
        const actions = document.querySelector('.thread-heading-actions')!.getBoundingClientRect()
        return { titleRight: title.right, actionsLeft: actions.left }
      })
      expect(heading.titleRight).toBeLessThanOrEqual(heading.actionsLeft + 1)
      for (const [label, fraction] of [['start', 0], ['quarter', .25], ['middle', .5], ['three-quarter', .75], ['end', 1]] as const) {
        const metrics = await page.locator('.thread-timeline').evaluate((element, position) => {
          element.scrollTop = (element.scrollHeight - element.clientHeight) * position
          return { scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }
        }, fraction)
        await page.waitForTimeout(350)
        const geometry = await page.evaluate(() => {
          const viewport = document.querySelector('.thread-timeline')!.getBoundingClientRect()
          const rows = [...document.querySelectorAll<HTMLElement>('.thread-virtual-row')].map(row => ({ key: row.dataset.threadRow, rect: row.getBoundingClientRect(), content: row.firstElementChild?.getBoundingClientRect() }))
            .filter(row => row.rect.bottom > viewport.top && row.rect.top < viewport.bottom)
          const overlaps = rows.slice(1).flatMap((row, index) => rows[index].rect.bottom > row.rect.top + 1 ? [{ before: rows[index].key, after: row.key, pixels: Math.round(rows[index].rect.bottom - row.rect.top) }] : [])
          const contentOverlaps = rows.slice(1).flatMap((row, index) => rows[index].content && rows[index].content.bottom > row.rect.top + 1 ? [{ before: rows[index].key, after: row.key, pixels: Math.round(rows[index].content.bottom - row.rect.top) }] : [])
          return { mounted: document.querySelectorAll('.thread-virtual-row').length, visible: rows.length, overlaps,
            contentOverlaps, first: rows[0]?.key, last: rows.at(-1)?.key, viewport: { top: viewport.top, bottom: viewport.bottom } }
        })
        results.push({ width, height, label, ...metrics, ...geometry })
        await page.screenshot({ path: join(output, `${width}-${label}.png`) })
      }
      const sweep = await page.locator('.thread-timeline').evaluate(async element => {
        const samples: Array<{ offset: number; overlaps: number; horizontalOverflow: number }> = []
        const max = element.scrollHeight - element.clientHeight
        for (let offset = 0; offset <= max; offset += 360) {
          element.scrollTop = offset
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          const rows = [...document.querySelectorAll<HTMLElement>('.thread-virtual-row')].map(row => row.getBoundingClientRect()).sort((a, b) => a.top - b.top)
          const overlaps = rows.slice(1).filter((row, index) => rows[index].bottom > row.top + 1).length
          const horizontalOverflow = Math.max(0, ...[...element.querySelectorAll<HTMLElement>('.thread-message, .thread-tool, .thread-approval, .thread-request')].map(node => Math.round(node.getBoundingClientRect().right - element.getBoundingClientRect().right)))
          if (overlaps || horizontalOverflow > 2) samples.push({ offset, overlaps, horizontalOverflow })
        }
        return samples
      })
      results.push({ width, height, label: 'full-sweep', issues: sweep })
    }
    const expandedPrompt = await page.locator('.thread-timeline').evaluate(async element => {
      for (let offset = 0; offset < element.scrollHeight; offset += 900) {
        element.scrollTop = offset
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        const button = [...element.querySelectorAll<HTMLButtonElement>('.thread-long-prompt > button')].find(node => node.textContent?.includes('Show full message'))
        if (!button) continue
        button.click()
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        const rows = [...element.querySelectorAll<HTMLElement>('.thread-virtual-row')].map(row => row.getBoundingClientRect()).sort((a, b) => a.top - b.top)
        return { found: true, overlaps: rows.slice(1).filter((row, index) => rows[index].bottom > row.top + 1).length }
      }
      return { found: false, overlaps: 0 }
    })
    results.push({ label: 'expanded-prompt', ...expandedPrompt })
    writeFileSync(join(output, 'metrics.json'), JSON.stringify(results, null, 2))
    console.log('Audit rows', await page.locator('.thread-virtual-space').getAttribute('data-total-rows'), 'overlaps', results.reduce((sum, row) => sum + ((row.overlaps as unknown[] | undefined)?.length ?? 0), 0), 'sweep issues', results.filter(row => row.label === 'full-sweep').flatMap(row => row.issues as unknown[]).length)
    expect(results.filter(row => row.label === 'full-sweep').flatMap(row => row.issues as unknown[])).toEqual([])
    // Some real sessions have no user prompt long enough to expose expansion.
    // The dedicated Thread UI scenario exercises that control with a fixture.
    expect(expandedPrompt.overlaps).toBe(0)
  } finally {
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
