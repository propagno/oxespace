// Acceptance test for 1.5.2 Polimento · OxeCode painéis (Jira OXE-264, PP-05·8, CA-1 and CA-2).
import { cleanup, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { WorkspaceGitHubPanel } from '../../../src/components/Workspace/WorkspaceGitHubPanel'
import type { Workspace } from '../../../shared/types/workspace'

vi.mock('../../../src/components/GitHub/GitControlPanel', () => ({
  GitControlPanel: () => <div data-testid="mock-git-control-panel" />
}))
vi.mock('../../../src/components/GitHub/GitHubPanel', () => ({
  GitHubPanel: () => <div data-testid="mock-github-panel" />
}))
vi.mock('../../../src/components/Workspace/PanelScopeBadge', () => ({
  PanelScopeBadge: () => <span data-testid="mock-scope-badge" />
}))

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')

afterEach(() => {
  cleanup()
})

describe('OXE-264 · PP-05·8 Git panel tokens, --font-mono and no duplicate Files/Git switcher', () => {
  test('[css] GitControlPanel and github CSS use --font-mono, --control-sm/--control-md, --weight-semibold and canonical tokens with no --gh-* or --ov-*', () => {
    const gitControlCss = read('src/components/GitHub/GitControlPanel.css')
    const githubCss = read('src/styles/features/github.css')
    const combined = `${gitControlCss}\n${githubCss}`

    expect(combined).not.toMatch(/font-family:\s*monospace\b/)
    expect(gitControlCss).toMatch(/\.git-control-heading\s+strong\s*\{[^}]*font-family:\s*var\(--font-mono\)/)
    expect(gitControlCss).toMatch(/\.git-control-file-status\s*\{[^}]*font-family:\s*var\(--font-mono\)/)

    expect(gitControlCss).not.toMatch(/\b(26|27)px\b/)
    expect(githubCss).not.toMatch(/\b(26|27)px\b/)
    expect(gitControlCss).toContain('var(--control-sm)')
    expect(githubCss).toContain('var(--control-sm)')

    expect(combined).not.toMatch(/font-weight:\s*650\b/)
    expect(githubCss).toContain('var(--weight-semibold)')

    expect(combined).not.toMatch(/--gh-/)
    expect(combined).not.toMatch(/--ov-/)
    expect(githubCss).toContain('var(--surface-raised)')
    expect(githubCss).toContain('var(--bd-default)')
    expect(githubCss).toContain('var(--tx-primary)')
    expect(githubCss).toContain('var(--tx-muted)')
  })

  test('WorkspaceGitHubPanel header omits duplicate Files and Git switcher buttons', () => {
    const workspace = {
      id: 'ws-1',
      name: 'demo',
      rootPath: '/tmp/demo',
      panes: [],
      layout: { type: 'leaf', paneId: 'p1' },
      activePaneId: 'p1'
    } as unknown as Workspace

    const { container } = render(
      <WorkspaceGitHubPanel
        workspace={workspace}
        scope={{ rootPath: '/tmp/demo', label: 'demo', kind: 'workspace' }}
        activeTab="status"
        isExpanded={false}
        onCollapse={vi.fn()}
        onToggleExpanded={vi.fn()}
        onTabChange={vi.fn()}
      />
    )

    expect(container.querySelector('.repository-view-actions')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Files$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Git$/i })).toBeNull()
  })
})
