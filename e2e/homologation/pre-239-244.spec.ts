import { _electron as electron, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * #239 (B11) + #244 (F20) pre-homologation, black box, REAL app in a throwaway profile, pt-BR then en: folders a
 * person might type in the new-workspace wizard. Each one: what is said under the field, how long it took, whether a
 * workspace appeared anyway, and whether the wizard kept the path. Output: e2e/screenshots/homologation/pre-239-244/
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'pre-239-244')
mkdirSync(OUT, { recursive: true })

for (const locale of ['pt-BR', 'en-US'] as const) {
  test(`workspace root refusals, real app: ${locale}`, async () => {
    test.setTimeout(420_000)
    const root = mkdtempSync(join(tmpdir(), 'oxespace-hml-239-'))
    const accents = join(root, 'Projetos São João', 'meu app ção'); mkdirSync(accents, { recursive: true })
    const aFile = join(root, 'notas.txt'); writeFileSync(aFile, 'x')
    const cases: Array<[string, string]> = [
      ['empty', ''],
      ['spaces only', '   '],
      ['relative', 'meu-projeto'],
      ['dot', '.'],
      ['missing', 'C:\\nao\\existe\\pasta'],
      ['a file', aFile],
      ['drive not present', 'Q:\\projeto'],
      ['unreachable UNC', '\\\\host-inexistente-hml\\share\\repo'],
      ['access denied', 'C:\\Windows\\System32\\config'],
      ['device name', 'C:\\Users\\CON'],
      ['trailing spaces', `${accents}   `],
      ['quoted (pasted from Explorer)', `"${accents}"`],
      ['dot-dot', join(root, 'Projetos São João', '..', 'Projetos São João', 'meu app ção')],
      ['spaces and accents (valid)', accents]
    ]
    const app = await electron.launch({ args: [join(process.cwd(), 'e2e', 'electron-main.cjs')], env: { ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_DB_PATH: join(root, 'oxespace.sqlite3'), OXESPACE_LOCALE: locale } })
    const results: unknown[] = []
    try {
      const page = await app.firstWindow()
      const errors: string[] = []
      page.on('pageerror', e => errors.push(String(e)))
      await page.getByTestId('btn-new-workspace').first().waitFor({ timeout: 30_000 })
      for (const [name, path] of cases) {
        if (!(await page.getByTestId('wizard-dir-input').isVisible().catch(() => false))) {
          await page.keyboard.press('Escape')
          await page.getByTestId('btn-new-workspace').first().click()
        }
        const input = page.getByTestId('wizard-dir-input')
        await input.fill(path)
        const launch = page.getByTestId('wizard-launch-btn')
        const enabled = await launch.isEnabled().catch(() => false)
        const started = Date.now()
        if (enabled) await launch.click()
        // Wait until the wizard either shows a message or goes away, up to 40 s (a UNC lookup can be slow).
        let state = 'timeout'
        for (let i = 0; i < 80; i++) {
          if (!(await input.isVisible().catch(() => false))) { state = 'wizard closed'; break }
          if ((await input.getAttribute('aria-invalid')) === 'true') { state = 'refused'; break }
          await page.waitForTimeout(500)
        }
        const ms = Date.now() - started
        const describedBy = await input.getAttribute('aria-describedby').catch(() => null)
        const message = describedBy ? await page.evaluate(ids => ids.split(' ').map(id => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' | '), describedBy) : ''
        const dialogText = (await page.getByRole('dialog').last().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 400)
        const kept = await input.inputValue().catch(() => null)
        const workspaces = await page.locator('aside').first().innerText().catch(() => '')
        await page.screenshot({ path: join(OUT, `${locale}-${name.replace(/\W+/g, '_')}.png`) })
        results.push({ name, path, launchEnabled: enabled, state, ms, message, focus: await page.evaluate(() => `${document.activeElement?.tagName} ${document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.getAttribute('aria-label') ?? ''}`), keptPath: kept === path, dialogText: state === 'refused' ? '' : dialogText, sidebarHasWorkspace: /meu app|pasta|projeto|notas|config|CON|share/i.test(workspaces) })
        writeFileSync(join(OUT, `${locale}.json`), JSON.stringify({ results, errors }, null, 2))
      }
    } finally { await app.close() }
  })
}
