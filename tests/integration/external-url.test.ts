import { describe, expect, it } from 'vitest'
import { isAppNavigation, isLoopbackHttpUrl, isSafeExternalUrl } from '../../electron/main/utils/external-url'

describe('external URL allowlist', () => {
  it('allows only browser-safe external protocols', () => {
    expect(isSafeExternalUrl('https://github.com/propagno/oxespace')).toBe(true)
    expect(isSafeExternalUrl('http://localhost:3000')).toBe(true)
    expect(isSafeExternalUrl('mailto:support@example.com')).toBe(true)
    expect(isSafeExternalUrl('file:///C:/Users/dudu-/secret.txt')).toBe(false)
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeExternalUrl('data:text/html,hello')).toBe(false)
    expect(isSafeExternalUrl('not a url')).toBe(false)
  })

  it('recognizes only HTTP loopback targets for privileged preview handling', () => {
    expect(isLoopbackHttpUrl('http://localhost:3000')).toBe(true)
    expect(isLoopbackHttpUrl('https://127.0.0.1:8443')).toBe(true)
    expect(isLoopbackHttpUrl('http://[::1]:5173')).toBe(true)
    expect(isLoopbackHttpUrl('https://example.com')).toBe(false)
    expect(isLoopbackHttpUrl('file:///C:/secret.txt')).toBe(false)
  })
})

describe('main window navigation', () => {
  const packaged = 'file:///C:/Program%20Files/OXESpace/resources/app.asar/out/renderer/index.html'
  it('stays on the renderer file or the dev server', () => {
    expect(isAppNavigation(`${packaged}#/thread`, packaged)).toBe(true)
    expect(isAppNavigation('http://localhost:5173/src/main.tsx', 'http://localhost:5173')).toBe(true)
  })
  it('refuses remote pages, other local files and other dev ports', () => {
    expect(isAppNavigation('https://example.com/', packaged)).toBe(false)
    expect(isAppNavigation('file:///C:/Users/me/evil.html', packaged)).toBe(false)
    expect(isAppNavigation('http://localhost:3000/', 'http://localhost:5173')).toBe(false)
    expect(isAppNavigation('not a url', packaged)).toBe(false)
  })
})
