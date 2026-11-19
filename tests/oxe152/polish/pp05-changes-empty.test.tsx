import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { GitDiffSummary } from '../../../shared/types/git'
import { ChangesPanel } from '../../../src/components/Changes/ChangesPanel'

function mockGitBridge(summary: GitDiffSummary) {
  Object.assign(window, {
    oxe: {
      ...(window as unknown as { oxe?: object }).oxe,
      git: {
        getBranch: vi.fn(async () => ({ branch: 'feat/demo', shortSha: 'abc1234' })),
        getDiffSummary: vi.fn(async () => summary),
        getFileOriginal: vi.fn(async () => ({ content: '', truncated: false })),
        getFileAtRef: vi.fn(async () => ({ content: '' }))
      },
      github: {
        listBranches: vi.fn(async () => [{ name: 'main', remote: false }, { name: 'feat/demo', remote: false }]),
        resolveWorktreeBase: vi.fn(async () => ({ baseRef: 'main' })),
        listWorktrees: vi.fn(async () => [])
      },
      fs: {
        readFile: vi.fn(async () => ({ content: '' }))
      }
    }
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('OXE-260 · PP-05.3 ChangesPanel empty state, semantic KIND tokens and 24 px targets', () => {
  test('hides +0 and −0 totals when summary has 0 additions and 0 deletions', async () => {
    mockGitBridge({
      base: 'main',
      files: [],
      additions: 0,
      deletions: 0,
      compiledAt: 1
    })

    const { container } = render(<ChangesPanel workspaceId="ws-1" rootPath="/tmp/repo" />)
    expect(await screen.findByText('No changes')).toBeInTheDocument()
    expect(container.querySelector('.changes-totals')).toBeNull()
  })

  test('hides .changes-files and the file filter input when there are 0 files and no query, and keeps them visible when filtering', async () => {
    mockGitBridge({
      base: 'main',
      files: [],
      additions: 0,
      deletions: 0,
      compiledAt: 1
    })

    const { container } = render(<ChangesPanel workspaceId="ws-1" rootPath="/tmp/repo" />)
    expect(await screen.findByText('No changes')).toBeInTheDocument()
    expect(container.querySelector('.changes-files')).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Filter files' })).toBeNull()

    cleanup()
    mockGitBridge({
      base: 'main',
      files: [{ path: 'src/app.ts', status: 'M', additions: 3, deletions: 1, binary: false }],
      additions: 3,
      deletions: 1,
      compiledAt: 2
    })

    const second = render(<ChangesPanel workspaceId="ws-1" rootPath="/tmp/repo" />)
    const filter = await screen.findByRole('textbox', { name: 'Filter files' })
    expect(second.container.querySelector('.changes-totals')).not.toBeNull()
    await userEvent.type(filter, 'nonexistent')
    expect(second.container.querySelector('.changes-files')).not.toBeNull()
    expect(screen.getByText('No file matches the filter')).toBeInTheDocument()
  })

  test('[css] KIND uses semantic --intent-*-fg or --tx-* tokens without hex literals and interactive controls meet --control-sm 24 px', () => {
    const tsx = readFileSync(resolve(process.cwd(), 'src/components/Changes/ChangesPanel.tsx'), 'utf8')
    const kindBlock = tsx.match(/const KIND:[\s\S]*?\n\}/)?.[0] ?? ''
    expect(kindBlock.length).toBeGreaterThan(0)
    expect(kindBlock).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    expect(kindBlock).toMatch(/var\(--(?:intent-[a-z]+-fg|tx-[a-z]+)\)/)

    const kindBadgeBlock = tsx.match(/function KindBadge[\s\S]*?\n\}/)?.[0] ?? ''
    expect(kindBadgeBlock).not.toMatch(/#[0-9a-fA-F]{3,8}/)

    const css = readFileSync(resolve(process.cwd(), 'src/components/Changes/ChangesPanel.css'), 'utf8')
    expect(css).toMatch(/\.changes-review-comments button\s*\{[^}]*height\s*:\s*var\(--control-sm\)/)
    expect(css).toMatch(/\.oxe-diff-add-glyph::before\s*\{[^}]*width\s*:\s*var\(--control-sm\)[^}]*height\s*:\s*var\(--control-sm\)/)
    expect(css).toMatch(/\.oxe-line-comment-remove\s*\{[^}]*min-height\s*:\s*var\(--control-sm\)/)
  })
})
