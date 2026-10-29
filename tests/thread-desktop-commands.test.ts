import { describe, expect, it } from 'vitest'
import { hasDesktopCommand } from '../shared/threadDesktopCommands'

describe('Thread desktop commands', () => {
  it('offers /usage only where the adapter answers it', () => {
    // The Claude adapter has no provider operations: /usage there failed with "does not expose the requested operation".
    expect(hasDesktopCommand('claude', 'usage')).toBe(false)
    expect(hasDesktopCommand('codex', 'usage')).toBe(true)
  })

  it('keeps the commands OXESpace answers itself for both providers', () => {
    for (const name of ['spending', 'events', 'rules', 'checkpoint', 'rename', 'status']) {
      expect(hasDesktopCommand('claude', name)).toBe(true)
      expect(hasDesktopCommand('codex', name)).toBe(true)
    }
  })
})
