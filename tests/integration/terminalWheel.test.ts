import { describe, expect, test } from 'vitest'
import { wheelToTuiScrollKeys } from '../../src/utils/terminalWheel'

describe('wheelToTuiScrollKeys', () => {
  test('does nothing on the normal buffer (xterm scrollback handles it)', () => {
    expect(wheelToTuiScrollKeys({
      bufferType: 'normal',
      mouseTrackingMode: 'none',
      deltaY: -120,
      deltaMode: 0
    })).toBeNull()
  })

  test('does nothing when the TUI owns mouse tracking', () => {
    expect(wheelToTuiScrollKeys({
      bufferType: 'alternate',
      mouseTrackingMode: 'any',
      deltaY: -120,
      deltaMode: 0
    })).toBeNull()
  })

  test('maps large wheel up/down to PageUp/PageDown on alt-screen', () => {
    expect(wheelToTuiScrollKeys({
      bufferType: 'alternate',
      mouseTrackingMode: 'none',
      deltaY: -120,
      deltaMode: 0
    })).toBe('\x1b[5~')
    expect(wheelToTuiScrollKeys({
      bufferType: 'alternate',
      mouseTrackingMode: 'none',
      deltaY: 120,
      deltaMode: 0
    })).toBe('\x1b[6~')
  })

  test('maps fine trackpad motion to repeated arrow keys', () => {
    const up = wheelToTuiScrollKeys({
      bufferType: 'alternate',
      mouseTrackingMode: 'none',
      deltaY: -30,
      deltaMode: 0
    })
    expect(up).toBe('\x1b[A')
    const down = wheelToTuiScrollKeys({
      bufferType: 'alternate',
      mouseTrackingMode: 'none',
      deltaY: 80,
      deltaMode: 0
    })
    expect(down).toBe('\x1b[B\x1b[B')
  })

  test('ignores modifier-held wheels (leave to host zoom/etc.)', () => {
    expect(wheelToTuiScrollKeys({
      bufferType: 'alternate',
      mouseTrackingMode: 'none',
      deltaY: -120,
      deltaMode: 0,
      ctrlKey: true
    })).toBeNull()
  })
})
