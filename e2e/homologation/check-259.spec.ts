import { _electron as electron, test } from '@playwright/test'
import { cleanEnv } from './clean-env'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * #259 on main, black box, REAL app in a throwaway profile: what leaves the app for the system browser. The window asks
 * to open URLs the rule must refuse (javascript:, file:, data:, ftp:, credentials, 2,049 chars, view-source:) and ones it
 * must let through (https, http, mailto, 2,048 chars), by window.open and by navigating the main window. shell.openExternal
 * is replaced by a recorder, so no browser opens. Then: the incident journal has the refusals without any part of a URL,
 * and an MCP sign-in for an unknown server opens nothing. Output: e2e/screenshots/homologation/check-259/
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'check-259')
mkdirSync(OUT, { recursive: true })

test('external links leave the app only by the rule', async () => {
  test.setTimeout(180_000)
  const root = mkdtempSync(join(tmpdir(), 'oxespace-hml-259-'))
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e', 'electron-main.cjs')], env: { ...cleanEnv(), OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_DB_PATH: join(root, 'oxespace.sqlite3'), OXESPACE_LOCALE: 'en-US' } })
  const notes: Record<string, unknown> = {}
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ shell, dialog }) => {
      const g = globalThis as Record<string, unknown>; g.opened = []
      shell.openExternal = (async (url: string) => { (g.opened as string[]).push(url) }) as typeof shell.openExternal
      dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox
    })
    await page.getByTestId('btn-new-workspace').first().waitFor({ timeout: 30_000 })
    const long = (n: number) => `https://example.com/${'a'.repeat(n - 'https://example.com/'.length)}`
    const urls: Array<[string, string]> = [
      ['https', 'https://example.com/docs'], ['http', 'http://example.com/x'], ['mailto', 'mailto:someone@example.com'],
      ['len-2048', long(2048)], ['len-2049', long(2049)], ['javascript', 'javascript:alert(1)'], ['file', 'file:///C:/Windows/System32/calc.exe'],
      ['data', 'data:text/html,<script>alert(1)</script>'], ['ftp', 'ftp://example.com/x'], ['credentials', 'https://user:secret@example.com/'],
      ['view-source', 'view-source:https://example.com'], ['ms-settings', 'ms-settings:privacy'], ['smb-unc', 'file://evil.example/share/x.exe'],
      ['mixed-case-scheme', 'JaVaScRiPt:alert(1)'], ['tab-in-scheme', 'java\tscript:alert(1)'], ['mailto-with-creds-like', 'mailto:a@b.com?body=https://u:p@x']
    ]
    const results: Record<string, unknown> = {}
    for (const [name, url] of urls) {
      const before = (await app.evaluate(() => ((globalThis as Record<string, unknown>).opened as string[]).length))
      await page.evaluate(u => { try { window.open(u, '_blank') } catch { /* refused in the window */ } }, url)
      await page.waitForTimeout(250)
      const after = await app.evaluate(() => ((globalThis as Record<string, unknown>).opened as string[]).slice())
      results[name] = { opened: after.length > before, openedAs: after.length > before ? after[after.length - 1].slice(0, 60) : null }
    }
    notes.windowOpen = results
    // Navigating the main window away: it must stay in the app; what goes out, and does it skip the F24 confirmation?
    const beforeNav = (await app.evaluate(() => ((globalThis as Record<string, unknown>).opened as string[]).length))
    await page.evaluate(() => { location.href = 'https://evil.example/navigated' }).catch(() => undefined)
    await page.waitForTimeout(800)
    notes.navigate = { stillInApp: (await page.url()).startsWith('file:') || (await page.url()).startsWith('http://localhost'), url: page.url().slice(0, 60), opened: (await app.evaluate(() => ((globalThis as Record<string, unknown>).opened as string[]).slice())).slice(beforeNav) }
    // MCP sign-in for a server that does not exist.
    notes.signInUnknown = await page.evaluate(() => (window as unknown as { oxe: { mcp: { openSignIn: (id: string) => Promise<unknown> } } }).oxe.mcp.openSignIn('no-such-server')).catch(e => String(e).slice(0, 160))
    // The journal: refusals recorded, nothing of a URL in them.
    const incidents = await page.evaluate(() => (window as unknown as { oxe: { diagnostics: { incidents: (i?: object) => Promise<unknown[]> } } }).oxe.diagnostics.incidents()).catch(e => String(e))
    notes.incidents = incidents
    const text = JSON.stringify(incidents)
    notes.journalLeaks = ['example.com', 'evil.example', 'secret', 'calc.exe', 'alert', 'privacy', 'someone@'].filter(n => text.includes(n))
    notes.allOpened = await app.evaluate(() => (globalThis as Record<string, unknown>).opened)
  } finally {
    writeFileSync(join(OUT, 'notes.json'), JSON.stringify(notes, null, 2))
    await app.close()
  }
})
