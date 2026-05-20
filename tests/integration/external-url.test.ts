import { describe, expect, it } from 'vitest'
import { isSafeExternalUrl } from '../../electron/main/utils/external-url'

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
})
