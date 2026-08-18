import { describe, expect, test } from 'vitest'
import { normalizePreviewUrl } from '../../src/components/WebPreview/WebPreviewPanel'

describe('WebPreviewPanel URL policy', () => {
  test('defaults to loopback-only and requires explicit external opt-in', () => {
    expect(normalizePreviewUrl('localhost:3000')).toBe('http://localhost:3000/')
    expect(normalizePreviewUrl('https://example.com')).toBeNull()
    expect(normalizePreviewUrl('https://example.com', true)).toBe('https://example.com/')
    expect(normalizePreviewUrl('file:///C:/secret.txt', true)).toBeNull()
  })
})
