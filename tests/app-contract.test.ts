import { describe, expect, it } from 'vitest'
import { isNotificationIcon, NOTIFICATION_ICONS } from '../shared/types/app'

describe('notification icon contract', () => {
  it('names icons by meaning, never by path or URL', () => {
    expect(NOTIFICATION_ICONS).toEqual(['attention', 'done', 'failed', 'info'])
    for (const icon of NOTIFICATION_ICONS) expect(isNotificationIcon(icon)).toBe(true)
    for (const value of ['', 'C:/evil.png', '../../icon.png', 'https://example.com/a.png', 'file:///etc/passwd', 'ATTENTION', null, 1]) {
      expect(isNotificationIcon(value), String(value)).toBe(false)
    }
  })
})
