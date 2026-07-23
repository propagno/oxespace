import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeAll, describe, expect, test } from 'vitest'

/**
 * Design Mode (#3) needs a <webview>, which is strictly more powerful than the
 * `sandbox`ed iframe it replaced. These are static assertions over the main
 * process source: the guest must stay unprivileged and isolated. A runtime test
 * cannot cover `will-attach-webview` without launching Electron, and losing any
 * of these lines would be a silent security regression.
 */
describe('webview hardening', () => {
  let source = ''

  beforeAll(async () => {
    source = await readFile(join(process.cwd(), 'electron/main/index.ts'), 'utf8')
  })

  test('pins the guest preload and denies node integration on attach', () => {
    expect(source).toContain("mainWindow.webContents.on('will-attach-webview'")
    expect(source).toMatch(/webPreferences\.preload\s*=\s*DESIGN_GUEST_PRELOAD/)
    expect(source).toMatch(/webPreferences\.nodeIntegration\s*=\s*false/)
    expect(source).toMatch(/webPreferences\.contextIsolation\s*=\s*true/)
    expect(source).toMatch(/webPreferences\.sandbox\s*=\s*true/)
  })

  test('forces the isolated preview partition rather than trusting the renderer', () => {
    expect(source).toMatch(/params\.partition\s*=\s*WEB_PREVIEW_PARTITION/)
  })

  test('restricts guests to http(s)', () => {
    expect(source).toMatch(/safeProtocol\(params\.src\)/)
    expect(source).toMatch(/params\.src\s*=\s*'about:blank'/)
  })

  test('keeps the preview session unprivileged: no permissions, downloads or referrer', () => {
    expect(source).toMatch(/previewSession\.setPermissionRequestHandler\(.*callback\(false\)/)
    expect(source).toMatch(/previewSession\.setPermissionCheckHandler\(\(\)\s*=>\s*false\)/)
    expect(source).toMatch(/previewSession\.on\('will-download',\s*\(event\)\s*=>\s*event\.preventDefault\(\)\)/)
    expect(source).toContain('delete requestHeaders.Referer')
  })

  test('denies window.open from a guest', () => {
    expect(source).toMatch(/did-attach-webview/)
    expect(source).toMatch(/guestWebContents\.setWindowOpenHandler/)
  })

  test('leaves the app window itself sandboxed with context isolation', () => {
    expect(source).toMatch(/contextIsolation:\s*true/)
    expect(source).toMatch(/nodeIntegration:\s*false/)
    expect(source).toMatch(/sandbox:\s*true/)
  })
})
