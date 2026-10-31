import { test } from '@playwright/test'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace } from '../helpers/launch'

/** Homologation of #162 (minified main): the app opens, a workspace opens, and how long each takes; 3 runs. */
test('boot smoke with the minified main', async () => {
  test.setTimeout(180_000)
  const runs: unknown[] = []
  for (let run = 0; run < 3; run++) {
    const started = Date.now()
    const { app, page, workspaceRoot, consoleErrors } = await launchApp()
    try {
      const window = Date.now() - started
      await page.locator('[data-testid="btn-new-workspace"]').waitFor()
      const ui = Date.now() - started
      await openDemoWorkspace(page, workspaceRoot)
      runs.push({ windowMs: window, uiMs: ui, workspaceMs: Date.now() - started, pageErrors: consoleErrors.filter(l => l.startsWith('pageerror:')) })
    } finally { await app.close() }
  }
  const out = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'b8-1')
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'boot.json'), JSON.stringify(runs, null, 2))
  console.log('BOOT', JSON.stringify(runs))
})
