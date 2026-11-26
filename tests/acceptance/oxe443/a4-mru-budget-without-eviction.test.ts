import { describe, expect, test } from 'vitest'
import {
  MAX_MOUNTED_TERMINAL_PANES,
  MAX_WEBGL_CONTEXTS,
  selectWorkspacesToEvict
} from '../../../src/components/Terminal/webglBudget'

describe('OXE-443 A4 · MRU mounted pane budget decoupled from active WebGL cap', () => {
  test('keeps 5 four-pane workspaces mounted under default MAX_MOUNTED_TERMINAL_PANES decoupled from MAX_WEBGL_CONTEXTS', () => {
    expect(MAX_WEBGL_CONTEXTS).toBe(14)
    expect(MAX_MOUNTED_TERMINAL_PANES).toBeGreaterThanOrEqual(32)

    const fiveWorkspaces = ['w1', 'w2', 'w3', 'w4', 'w5']
    expect(selectWorkspacesToEvict(fiveWorkspaces, () => 4, 'w5', 8)).toEqual([])

    // 9 four-pane workspaces = 36 panes > 32 -> evicts only oldest ('w1') to land at 32.
    const nineWorkspaces = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8', 'w9']
    expect(selectWorkspacesToEvict(nineWorkspaces, () => 4, 'w9', 12)).toEqual(['w1'])
  })

  test('handles empty workspace list and zero-pane counts safely', () => {
    expect(selectWorkspacesToEvict([], () => 0, null, 8)).toEqual([])
    expect(selectWorkspacesToEvict(['w1', 'w2'], () => 0, 'w2', 8)).toEqual([])
  })
})
