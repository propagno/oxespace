import { describe, expect, it } from 'vitest'
import { nextToolState, type ToolCallState } from '../electron/main/services/conversation/kernel/tool-call-machine'

const STATES: ToolCallState[] = ['running', 'completed', 'failed', 'unknown']

describe('nextToolState', () => {
  it('terminal states are absorbing for every possible report', () => {
    for (const terminal of ['completed', 'failed'] as const) {
      for (const incoming of STATES) expect(nextToolState(terminal, incoming)).toBe(terminal)
    }
  })
  it('running moves to any reported state', () => {
    for (const incoming of STATES) expect(nextToolState('running', incoming)).toBe(incoming)
  })
  it('unknown only moves to a real outcome', () => {
    expect(nextToolState('unknown', 'running')).toBe('unknown')
    expect(nextToolState('unknown', 'completed')).toBe('completed')
    expect(nextToolState('unknown', 'failed')).toBe('failed')
  })
})
