import { describe, expect, it } from 'vitest'
import { isLoopbackHttpUrl, isSafeExternalUrl } from '../../electron/main/utils/external-url'

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
