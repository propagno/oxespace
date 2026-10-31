import { test } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'

/** P2-5 bisection: runs palette items [START..END] of sequence.json in order, recording errors per step in full. */
const seq = JSON.parse(readFileSync(join(process.cwd(), 'e2e', 'homologation', process.env.SEQ_FILE ?? 'sequence.json'), 'utf8')) as Array<{ value: string; text: string }>
const START = Number(process.env.SEQ_START ?? 0), END = Number(process.env.SEQ_END ?? seq.length - 1)
test(`sequence ${START}..${END}`, async () => {
  test.setTimeout(540_000)
  const { app, page, workspaceRoot, consoleErrors } = await launchApp({ appearance: 'light' })
  const log: unknown[] = []
  const out = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'audit-menus', `sequence-${process.env.SEQ_FILE ?? 'full'}-${START}-${END}.json`)
  try {
    await resizeWindow(app, 1280, 860)
    await openDemoWorkspace(page, workspaceRoot)
    for (let i = START; i <= END; i++) {
      const item = seq[i]
      await page.keyboard.press('Control+1').catch(() => undefined)
      for (let k = 0; k < 3; k++) await page.keyboard.press('Escape')
      await page.keyboard.press('Control+k')
      const opened = await page.locator('[cmdk-root]').waitFor({ timeout: 3_000 }).then(() => true, () => false)
      if (!opened) { log.push({ i, item: item.text, paletteDidNotOpen: true }); writeFileSync(out, JSON.stringify(log, null, 2)); break }
      await page.keyboard.insertText(item.text.split(' · ')[0])
      await page.waitForTimeout(150)
      const option = page.locator(`[cmdk-item][data-value="${item.value.replace(/"/g, '\\"')}"]`).first()
      const before = consoleErrors.length
      if (await option.isVisible().catch(() => false)) await option.click()
      await page.waitForTimeout(700)
      log.push({ i, item: item.text, newErrors: consoleErrors.slice(before), toasts: await page.locator('[data-sonner-toast]').allInnerTexts().catch(() => []), panes: await page.locator('.xterm').count() })
      writeFileSync(out, JSON.stringify(log, null, 2))
    }
    for (let k = 0; k < 3; k++) await page.keyboard.press('Escape')
    await page.keyboard.press('Control+k')
    const reopened = await page.locator('[cmdk-root]').waitFor({ timeout: 3_000 }).then(() => true, () => false)
    const state = await page.evaluate(() => ({ focus: `${document.activeElement?.tagName} ${String((document.activeElement as HTMLElement)?.className ?? '').slice(0, 80)}`, dialogs: [...document.querySelectorAll('[role="dialog"]')].map(d => d.getAttribute('aria-label')), panes: document.querySelectorAll('.xterm').length, toasts: [...document.querySelectorAll('[data-sonner-toast]')].map(t => (t.textContent ?? '').trim().slice(0, 200)) }))
    log.push({ end: true, reopened, state })
    await page.screenshot({ path: out.replace(/.json$/, '.png') })
  } finally { writeFileSync(out, JSON.stringify(log, null, 2)); await app.close() }
})
