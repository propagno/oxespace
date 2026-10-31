import { describe, expect, test } from 'vitest'
import type { WorkspaceLayout } from '../shared/types/workspace'
import { planSplit } from '../shared/workspace-split'

const full = (layout: WorkspaceLayout): Array<{ rowIndex: number; columnIndex: number }> => {
  const [rows, columns] = layout.split('x').map(Number)
  return Array.from({ length: rows * columns }, (_, index) => ({ rowIndex: Math.floor(index / columns), columnIndex: index % columns }))
}

// One rule for the main process and the e2e mock (F19): the mock used to grow any rows x columns, which hid the
// crash on a layout the grid had no preset for.
describe('planSplit', () => {
  test('16 panes, split right: refused, the slot is taken; on the last column: refused, no larger preset', () => {
    expect(planSplit('4x4', full('4x4'), { rowIndex: 0, columnIndex: 0 }, 'vertical')).toEqual({ ok: false, reason: 'occupied' })
    expect(planSplit('4x4', full('4x4'), { rowIndex: 0, columnIndex: 3 }, 'vertical')).toEqual({ ok: false, reason: 'limit' })
    expect(planSplit('4x4', full('4x4'), { rowIndex: 3, columnIndex: 0 }, 'horizontal')).toEqual({ ok: false, reason: 'limit' })
  })

  test('grows to the next preset past the last column or row', () => {
    expect(planSplit('1x1', full('1x1'), { rowIndex: 0, columnIndex: 0 }, 'vertical')).toEqual({ ok: true, layout: '1x2', rowIndex: 0, columnIndex: 1 })
    expect(planSplit('2x2', full('2x2'), { rowIndex: 1, columnIndex: 0 }, 'horizontal')).toEqual({ ok: true, layout: '3x4', rowIndex: 2, columnIndex: 0 })
  })

  test('a free slot inside the grid keeps the layout', () => {
    const panes = full('2x2').filter(p => !(p.rowIndex === 0 && p.columnIndex === 1))
    expect(planSplit('2x2', panes, { rowIndex: 0, columnIndex: 0 }, 'vertical')).toEqual({ ok: true, layout: '2x2', rowIndex: 0, columnIndex: 1 })
  })

  test('never yields a layout outside the presets', () => {
    const presets: WorkspaceLayout[] = ['1x1', '1x2', '2x1', '2x2', '2x3', '2x4', '2x5', '2x7', '3x4', '4x4']
    for (const layout of presets) for (const pane of full(layout)) for (const direction of ['vertical', 'horizontal'] as const) {
      const plan = planSplit(layout, [pane], pane, direction)
      if (plan.ok) expect(presets, `${layout} ${direction} from ${pane.rowIndex},${pane.columnIndex}`).toContain(plan.layout)
    }
  })
})
