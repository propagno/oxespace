import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorTabs } from '../src/components/Editor/EditorTabs'

afterEach(cleanup)

const tabs = [
  { relativePath: 'src/a.ts', pinned: true },
  { relativePath: 'src/b.ts', pinned: false },
  { relativePath: 'src/c.ts', pinned: false }
]

function renderTabs(onMove = vi.fn()) {
  render(<EditorTabs tabs={tabs as never} activePath="src/b.ts" dirtyPaths={new Set()} onActivate={vi.fn()} onClose={vi.fn()} onCloseOthers={vi.fn()} onTogglePin={vi.fn()} onMove={onMove} />)
  return onMove
}

describe('editor tabs without dragging (WCAG 2.5.7)', () => {
  it('moves a tab left or right from its menu', () => {
    const onMove = renderTabs()
    fireEvent.contextMenu(screen.getByRole('tab', { name: /c\.ts/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move left' }))
    expect(onMove).toHaveBeenCalledWith('src/c.ts', 'src/b.ts')
  })

  it('keeps pinned tabs ahead: an unpinned tab cannot move past a pinned one, and the last cannot move right', () => {
    renderTabs()
    fireEvent.contextMenu(screen.getByRole('tab', { name: /b\.ts/ }))
    expect(screen.getByRole('menuitem', { name: 'Move left' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Move right' })).toBeEnabled()
  })
})
