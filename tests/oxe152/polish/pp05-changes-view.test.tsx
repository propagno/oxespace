import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { changeLanguage } from '../../../src/i18n'
import { WorkspaceReviewPanel } from '../../../src/components/Workspace/WorkspaceReviewPanel'
import { PanelScopeBadge } from '../../../src/components/Workspace/PanelScopeBadge'
import { useUIStore } from '../../../src/store/ui.store'
import type { Workspace } from '../../../shared/types/workspace'
import type { WorkspaceScope } from '../../../src/utils/workspaceScope'

vi.mock('../../../src/components/Review/ReviewPane', () => ({
  ReviewPane: () => <div className="review-pane" data-testid="mock-review-pane" />
}))

vi.mock('../../../src/components/Workspace/panelChunks', () => {
  const mod = { ChangesPanel: () => <div data-testid="mock-changes-panel" /> }
  return {
    CHANGES_PANEL_CHUNK: {
      get: () => mod,
      load: () => Promise.resolve(mod)
    }
  }
})

const WORKSPACE: Workspace = {
  id: 'ws-1',
  name: 'demo',
  path: '/tmp/demo',
  color: '#0ea5e9',
  createdAt: 1,
  lastAccessedAt: 1
} as Workspace

const SCOPE: WorkspaceScope = {
  rootPath: '/tmp/demo',
  folderName: 'demo',
  isWorktree: false,
  pinned: false
}

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  useUIStore.setState({ panelScopePinnedByWorkspace: {} })
  await changeLanguage('en')
})

describe('OXE-259 · PP-05.2 Changes view switcher and unpinned PanelScopeBadge', () => {
  test('WorkspaceReviewPanel renders a localized view switcher with consistent active state in pt-BR and en', async () => {
    await changeLanguage('pt-BR')
    render(
      <WorkspaceReviewPanel
        workspace={WORKSPACE}
        scope={SCOPE}
        isExpanded={false}
        onCollapse={vi.fn()}
        onToggleExpanded={vi.fn()}
      />
    )

    const changesRadio = screen.getByRole('radio', { name: 'Alterações' })
    const classicRadio = screen.getByRole('radio', { name: 'Clássico' })
    expect(changesRadio).toHaveAttribute('aria-checked', 'true')
    expect(classicRadio).toHaveAttribute('aria-checked', 'false')

    await userEvent.click(classicRadio)
    expect(changesRadio).toHaveAttribute('aria-checked', 'false')
    expect(classicRadio).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('mock-review-pane')).toBeInTheDocument()

    cleanup()
    await changeLanguage('en')
    render(
      <WorkspaceReviewPanel
        workspace={WORKSPACE}
        scope={SCOPE}
        isExpanded={false}
        onCollapse={vi.fn()}
        onToggleExpanded={vi.fn()}
      />
    )

    const enChanges = screen.getByRole('radio', { name: 'Changes' })
    const enClassic = screen.getByRole('radio', { name: 'Classic' })
    expect(enChanges).toHaveAttribute('aria-checked', 'true')
    expect(enClassic).toHaveAttribute('aria-checked', 'false')

    await userEvent.click(enClassic)
    expect(enClassic).toHaveAttribute('aria-checked', 'true')
    expect(enChanges).toHaveAttribute('aria-checked', 'false')
  })

  test('unpinned PanelScopeBadge collapses the pin hint at rest so it takes 0 px in the layout', () => {
    render(<PanelScopeBadge workspaceId={WORKSPACE.id} scope={SCOPE} />)
    const badge = screen.getByTestId('panel-scope-badge')
    expect(badge).toHaveAttribute('aria-pressed', 'false')
    expect(badge.querySelector('.panel-scope-badge-pin-hint')).not.toBeNull()

    const css = readFileSync(resolve(process.cwd(), 'src/styles/worktree.css'), 'utf8')
    expect(css).toMatch(/\.panel-scope-badge\s+\.panel-scope-badge-pin-hint\s*\{[^}]*display\s*:\s*none/)
    expect(css).toMatch(/\.panel-scope-badge:hover\s+\.panel-scope-badge-pin-hint[\s\S]*\.panel-scope-badge:focus-visible\s+\.panel-scope-badge-pin-hint\s*\{[^}]*display\s*:\s*inline-block/)
  })
})
