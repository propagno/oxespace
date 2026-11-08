// Frozen acceptance test for 1.5.0 A67 (OXE program, phase F10). Written by the planner; the executor must not edit it.
// CCR: docs/roadmap-1.5/ccr-a67-workspace-color.md (#693).
import { describe, expect, test } from 'vitest'
import type { RemoteWorkspace } from '../../../shared/remote/protocol'
import type { RemoteWorkspaceRow } from '../../../electron/main/services/remote/desktop'
import { toWorkspace } from '../../../electron/main/services/remote/filters'
import { workspaceColorIndex } from '../../../shared/workspace-color'

/** The row as T-A67.1 makes it: the stored slot, or null when none was chosen. */
type ColoredRow = RemoteWorkspaceRow & { color: number | null }
type ColoredWorkspace = RemoteWorkspace & { color?: number }

const row = (id: string, color: number | null, name = 'proj'): ColoredRow =>
  ({ id, name, rootPath: '/fixture/proj', active: true, panes: [], color })

const mapped = (value: ColoredRow): ColoredWorkspace => toWorkspace(value, new Set(), []) as ColoredWorkspace

/** A fixed sequence of ids, so the run is the same on every machine. */
function seededIds(count: number): string[] {
  let state = 0x2545f491
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0
    ids.push(`ws-${state.toString(36)}-${i}`)
  }
  return ids
}

describe('A67 · the workspace colour reaches the phone (desktop mapper)', () => {
  test('a workspace with a chosen colour sends that slot', () => {
    expect(mapped(row('ws1', 3)).color).toBe(3)
  })

  test('a workspace with no chosen colour sends the derived slot the desktop shows', () => {
    for (const id of ['ws1', 'alpha', 'a-very-long-workspace-id-0001']) {
      expect(mapped(row(id, null)).color).toBe(workspaceColorIndex({ id, color: null }))
    }
  })

  test('the colour depends only on the id and the stored slot, never on another workspace field', () => {
    expect(mapped(row('ws1', null, 'one name')).color).toBe(mapped(row('ws1', null, 'another name')).color)
  })

  test('every sent colour is an integer between 1 and 8', () => {
    for (const id of seededIds(200)) {
      const color = mapped(row(id, null)).color
      expect(Number.isInteger(color)).toBe(true)
      expect(color).toBeGreaterThanOrEqual(1)
      expect(color).toBeLessThanOrEqual(8)
    }
  })

  test('the mapped workspace keeps exactly id, name, active, panes and color', () => {
    expect(Object.keys(mapped(row('ws1', 2))).sort()).toEqual(['active', 'color', 'id', 'name', 'panes'])
  })
})
