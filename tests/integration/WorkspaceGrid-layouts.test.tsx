import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { Workspace, WorkspaceLayout, WorkspacePane } from '../../shared/types/workspace'
import { WorkspaceGrid } from '../../src/components/Grid/WorkspaceGrid'
import { LAYOUTS, layoutOf } from '../../src/components/Grid/layouts'

// F19: the classic grid (split layout off) with the 16-pane preset took a split and the whole window went down
// ("Cannot read properties of undefined (reading 'rows')"): the layout grew past the presets the grid knew.
const broken = new Set<string>()
vi.mock('../../src/components/Grid/PaneContainer', () => ({
  PaneContainer: ({ pane }: { pane: WorkspacePane }) => {
    if (broken.has(pane.id)) throw new Error(`pane ${pane.id} failed to draw`)
    return <div data-testid="pane" data-pane-id={pane.id} />
  }
}))

function workspaceOf(layout: string, panes: Array<[number, number]>): Workspace {
  return {
    id: 'workspace-1', name: 'repo', rootPath: 'C:/repo', layout: layout as WorkspaceLayout, layoutPreset: 16, themeId: 'midnight',
    uiDensity: 'compact', defaultShellProfileId: 'builtin-claude', autoStart: false, isActive: true,
    panes: panes.map(([rowIndex, columnIndex]) => ({ id: `pane-${rowIndex}-${columnIndex}`, workspaceId: 'workspace-1', type: 'terminal', rowIndex, columnIndex, shellProfileId: 'builtin-claude', status: 'idle' }))
  }
}
const grid = (rows: number, columns: number): Array<[number, number]> =>
  Array.from({ length: rows * columns }, (_, index) => [Math.floor(index / columns), index % columns])
const draw = (workspace: Workspace) => render(<WorkspaceGrid workspace={workspace} maximizedPaneId={null} onToggleMaximize={() => undefined} />)

describe('layoutOf', () => {
  test('reads the presets as they are', () => {
    for (const [name, definition] of Object.entries(LAYOUTS)) expect(layoutOf(name)).toEqual(definition)
  })
  test('reads a layout a split grew past the presets from its name, and an unreadable one as 1 x 1', () => {
    expect(layoutOf('4x5')).toEqual({ rows: 4, columns: 5 })
    expect(layoutOf('5x4')).toEqual({ rows: 5, columns: 4 })
    expect(layoutOf('')).toEqual({ rows: 1, columns: 1 })
    expect(layoutOf('wide')).toEqual({ rows: 1, columns: 1 })
    expect(layoutOf('0x0')).toEqual({ rows: 1, columns: 1 })
  })
})

describe('WorkspaceGrid outside the presets (F19)', () => {
  test('16 panes, then a split to the right: 17 panes drawn, nothing thrown', () => {
    // What a split of the last column of 4 x 4 leaves: a fifth column the presets do not have.
    draw(workspaceOf('4x5', [...grid(4, 4), [0, 4]]))
    expect(screen.getAllByTestId('pane')).toHaveLength(17)
    expect(screen.getByTestId('workspace-grid')).toBeInTheDocument()
  })

  test('one pane that fails to draw shows its error in its own place; the others stay', () => {
    broken.add('pane-1-2')
    try {
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      draw(workspaceOf('4x4', grid(4, 4)))
      expect(screen.getAllByTestId('pane')).toHaveLength(15)
      expect(screen.getByText(/this pane/i)).toBeInTheDocument()
      expect(screen.getByTestId('workspace-grid')).toBeInTheDocument()
    } finally { broken.clear(); vi.restoreAllMocks() }
  })

  // Random sequences of layout commands, as the palette and the shortcuts can send them in any order: preset
  // changes, splits right and down (the way the e2e mock grows the layout, past any preset), closes. The grid must
  // draw every state. Seeded, so a failure names the sequence that broke it.
  test('draws every state of 60 random sequences of layout commands', () => {
    const presets = Object.keys(LAYOUTS)
    let seed = 0x0f19
    const random = (n: number): number => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n }
    for (let run = 0; run < 60; run++) {
      let layout = presets[random(presets.length)]
      let { rows, columns } = layoutOf(layout)
      let panes = grid(rows, columns)
      const steps: string[] = [layout]
      for (let step = 0; step < 10; step++) {
        const command = random(4)
        if (command === 0) {
          layout = presets[random(presets.length)]; ({ rows, columns } = layoutOf(layout))
          panes = grid(rows, columns); steps.push(`preset ${layout}`)
        } else if (command === 1 && panes.length > 0) {
          const [row, column] = panes[random(panes.length)]
          if (!panes.some(([r, c]) => r === row && c === column + 1)) { panes = [...panes, [row, column + 1]]; columns = Math.max(columns, column + 2) }
          layout = `${rows}x${columns}`; steps.push(`split right ${row},${column}`)
        } else if (command === 2 && panes.length > 0) {
          const [row, column] = panes[random(panes.length)]
          if (!panes.some(([r, c]) => r === row + 1 && c === column)) { panes = [...panes, [row + 1, column]]; rows = Math.max(rows, row + 2) }
          layout = `${rows}x${columns}`; steps.push(`split down ${row},${column}`)
        } else if (panes.length > 1) {
          const index = random(panes.length); steps.push(`close ${panes[index].join(',')}`)
          panes = panes.filter((_, i) => i !== index)
        }
        const view = draw(workspaceOf(layout, panes))
        expect(screen.getAllByTestId('pane'), `run ${run}: ${steps.join(' → ')}`).toHaveLength(panes.length)
        view.unmount()
      }
    }
  }, 60_000)
})
