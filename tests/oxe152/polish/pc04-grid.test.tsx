// Acceptance test for 1.5.2 Polimento · OxeCode superfície (Jira OXE-257, PC-04·11, CA-1 and CA-2).
// Contract:
// - CA-1: the grid divider (.split-resize-handle and .resize-handle-vertical) has a 24 px grab area centered on its line.
// - CA-2: the split grid gutter uses var(--space-2) (8 px).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { WorkspaceSplitGrid } from '../../../src/components/Grid/WorkspaceSplitGrid'
import { tokensCss } from '../../../src/design/tokens/css'
import type { PaneNode } from '../../../shared/types/pane-tree'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'

vi.mock('../../../src/components/Grid/PaneContainer', () => ({
  PaneContainer: ({ pane }: { pane: WorkspacePane }) => <div data-testid={`pane-${pane.id}`}>{pane.id}</div>
}))

const pane = (id: string, columnIndex: number): WorkspacePane => ({
  id,
  workspaceId: 'ws-1',
  type: 'terminal',
  rowIndex: 0,
  columnIndex,
  shellProfileId: 'builtin-claude',
  status: 'idle',
  agentProfileId: null,
  agentName: null,
  displayName: null,
  createdAt: null,
  rootPath: null
} as WorkspacePane)

const WORKSPACE: Workspace = {
  id: 'ws-1',
  name: 'Atlas',
  rootPath: 'C:/repos/atlas',
  layout: '2x1',
  layoutPreset: 2,
  themeId: 'dracula',
  uiDensity: 'compact',
  defaultShellProfileId: 'builtin-claude',
  autoStart: false,
  isActive: true,
  color: 3,
  panes: [pane('p1', 0), pane('p2', 1)]
} as unknown as Workspace

const TREE: PaneNode = {
  kind: 'split',
  direction: 'horizontal',
  sizes: [50, 50],
  children: [
    { kind: 'leaf', paneId: 'p1' },
    { kind: 'leaf', paneId: 'p2' }
  ]
}

afterEach(() => {
  cleanup()
})

describe('PC-04·11 · grid divider grab area and 8 px gutter', () => {
  test('[css] the grid divider has a 24 px grab area across its line', () => {
    const { container } = render(
      <WorkspaceSplitGrid
        workspace={WORKSPACE}
        tree={TREE}
        maximizedPaneId={null}
        activePaneId="p1"
        onToggleMaximize={vi.fn()}
        onResize={vi.fn()}
        onMovePane={vi.fn()}
      />
    )

    const handle = container.querySelector<HTMLElement>('[data-testid="split-resize-handle"]')
    expect(handle).not.toBeNull()
    expect(handle!.style.width).toBe('24px')
    expect(handle!.style.left).toBe('calc(50% - 12px)')

    const layoutCss = readFileSync(join(process.cwd(), 'src/styles/layout.css'), 'utf8')
    expect(layoutCss).toMatch(/\.resize-handle-vertical::after\s*\{[^}]*width:\s*24px/s)
    expect(layoutCss).toMatch(/\.resize-handle-horizontal::after\s*\{[^}]*height:\s*24px/s)
  })

  test('[css] the grid gutter is var(--space-2), 8 px', () => {
    expect(tokensCss()).toMatch(/--space-2:\s*8px\b/)

    const { container } = render(
      <WorkspaceSplitGrid
        workspace={WORKSPACE}
        tree={TREE}
        maximizedPaneId={null}
        activePaneId="p1"
        onToggleMaximize={vi.fn()}
        onResize={vi.fn()}
        onMovePane={vi.fn()}
      />
    )

    const slots = [...container.querySelectorAll<HTMLElement>('.split-pane-slot')]
    expect(slots).toHaveLength(2)
    expect(slots[0].style.left).toContain('var(--space-2)')
    expect(slots[0].style.top).toContain('var(--space-2)')
    expect(slots[0].style.left).not.toContain('10px')
  })
})
