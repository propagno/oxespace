import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import type { GitDiffSummary } from '../../../shared/types/git'
import { ChangesPanel } from '../../../src/components/Changes/ChangesPanel'

// OXE-408: pp05-changes-empty (OXE-260, frozen) failed only in a busy batch. There Monaco's chunk had already been
// transformed by an earlier file, so the lazy diff view finished loading while the test typed in the filter, and the
// real Monaco mounted in jsdom and threw ("ResizeObserver is not defined"), unmounting the panel. Loading the chunk
// before the render makes that order certain, here, every run; tests/setup.ts keeps the real Monaco out of jsdom.

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

beforeAll(async () => {
  await import('../../../src/components/Changes/MonacoDiff')
}, 60_000)

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('OXE-408 · ChangesPanel with the Monaco diff chunk already loaded (the busy-batch order of pp05-changes-empty)', () => {
  test('a selected file mounts the diff view without the real Monaco, the panel stays mounted, and the filter still narrows to no match', async () => {
    mockGitBridge({
      base: 'main',
      files: [{ path: 'src/app.ts', status: 'M', additions: 3, deletions: 1, binary: false }],
      additions: 3,
      deletions: 1,
      compiledAt: 2
    })

    const view = render(<ChangesPanel workspaceId="ws-1" rootPath="/tmp/repo" />)
    const filter = await screen.findByRole('textbox', { name: 'Filter files' })
    await vi.waitFor(() => expect(view.container.querySelector('[data-monaco-placeholder="diff"]')).not.toBeNull(), { timeout: 10_000 })
    expect(view.container.querySelector('.monaco-editor, .monaco-diff-editor')).toBeNull()
    await userEvent.type(filter, 'nonexistent')
    expect(view.container.querySelector('.changes-files')).not.toBeNull()
    expect(screen.getByText('No file matches the filter')).toBeInTheDocument()
  }, 30_000)
})
