import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeAll, describe, expect, test } from 'vitest'

/**
 * The native preview guest must stay unprivileged and isolated. These static
 * checks protect both the active WebContentsView and the legacy attach hook;
 * Electron E2E separately exercises the live native guest.
 */
describe('browser preview hardening', () => {
  let source = ''
  let security = ''
  let native = ''

  beforeAll(async () => {
    source = await readFile(join(process.cwd(), 'electron/main/index.ts'), 'utf8')
    security = await readFile(join(process.cwd(), 'electron/main/services/browser-preview-security.ts'), 'utf8')
    native = await readFile(join(process.cwd(), 'electron/main/services/browser-preview.service.ts'), 'utf8')
  })

  test('pins the guest preload and denies node integration on attach', () => {
    expect(source).toContain("mainWindow.webContents.on('will-attach-webview'")
    expect(source).toMatch(/webPreferences\.preload\s*=\s*DESIGN_GUEST_PRELOAD/)
    expect(source).toMatch(/webPreferences\.nodeIntegration\s*=\s*false/)
    expect(source).toMatch(/webPreferences\.contextIsolation\s*=\s*true/)
    expect(source).toMatch(/webPreferences\.sandbox\s*=\s*true/)
  })

  test('accepts only bounded ephemeral preview partitions and secures each profile', () => {
    expect(security).toContain("const WEB_PREVIEW_PARTITION_PREFIX = 'oxe-webpreview-'")
    expect(source).toContain('params.partition?.startsWith(WEB_PREVIEW_PARTITION_PREFIX)')
    expect(source).toContain('params.partition = `${WEB_PREVIEW_PARTITION_PREFIX}${randomUUID()}`')
    expect(source).toContain('securePreviewSession(session.fromPartition(params.partition))')
    expect(security).toContain('securePreviewSession(previewSession)')
    expect(native).toContain('session:previewSessionFor(input.ownerKey)')
  })

  test('restricts guests to http(s)', () => {
    expect(source).toMatch(/safeProtocol\(params\.src\)/)
    expect(source).toMatch(/params\.src\s*=\s*'about:blank'/)
  })

  test('keeps the preview session unprivileged: no permissions, downloads or referrer', () => {
    expect(security).toMatch(/previewSession\.setPermissionRequestHandler\(.*callback\(false\)/)
    expect(security).toMatch(/previewSession\.setPermissionCheckHandler\(\(\)\s*=>\s*false\)/)
    expect(security).toMatch(/previewSession\.on\('will-download',\s*event\s*=>\s*event\.preventDefault\(\)\)/)
    expect(security).toContain('delete requestHeaders.Referer')
  })

  test('denies window.open from a guest', () => {
    expect(source).toMatch(/did-attach-webview/)
    expect(source).toContain('securePreviewGuest(guestWebContents)')
    expect(security).toMatch(/guest\.setWindowOpenHandler/)
    expect(security).not.toContain('shell.openExternal')
    expect(native).toContain('securePreviewGuest(view.webContents)')
  })

  test('leaves the app window itself sandboxed with context isolation', () => {
    expect(source).toMatch(/contextIsolation:\s*true/)
    expect(source).toMatch(/nodeIntegration:\s*false/)
    expect(source).toMatch(/sandbox:\s*true/)
  })
})
