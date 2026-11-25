// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ThreadSnapshot } from '../../../shared/types/thread'
import type { Workspace } from '../../../shared/types/workspace'
import { ChangesPanel } from '../../../src/components/Changes/ChangesPanel'
import { buildReadOnlyReviewPrompt, pickDefaultReviewerProvider } from '../../../src/components/Changes/reviewWithAgent'
import { useThreadStore } from '../../../src/store/thread.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'
import { preloadOxe } from '../../acceptance/f4/crf4-8-preload'

vi.mock('../../../src/hooks/useGitBranch', () => ({
  useGitBranch: () => ({ branch: 'feat/review', detached: false, shortSha: null, error: null })
}))

vi.mock('../../../src/components/Changes/MonacoDiff', () => ({
  default: ({ path }: { path: string }) => <div data-testid="mock-monaco-diff">{path}</div>
}))

function makeSnapshot(overrides: Partial<ThreadSnapshot['thread']> = {}, extra: Partial<ThreadSnapshot> = {}): ThreadSnapshot {
  return {
    thread: {
      id: 'thread-1',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      rootPath: '/repo',
      provider: 'claude',
      nativeSessionId: null,
      title: 'Feature work',
      pinned: false,
      status: 'idle',
      createdAt: 1,
      updatedAt: 100,
      configurationRevision: 2,
      ...overrides
    },
    events: [],
    turns: [{ id: 'turn-2', sequence: 2, status: 'completed', configuration: {} as never }],
    ...extra
  } as unknown as ThreadSnapshot
}

beforeEach(() => {
  localStorage.clear()
  useThreadStore.setState({
    threads: [],
    projects: [],
    selectedId: null,
    snapshot: null,
    snapshotCache: {},
    snapshotCacheOrder: []
  })
  const workspace = { id: 'ws-1', name: 'demo', rootPath: '/repo', defaultShellProfileId: null, panes: [] } as unknown as Workspace
  useWorkspaceStore.setState({ workspaces: [workspace], activeWorkspaceId: 'ws-1', shellProfiles: [] })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('OXE-323 · last-turn review scope', () => {
  test('shows files touched by the last agent turn when Last turn scope is selected', async () => {
    const user = userEvent.setup()
    const snapshot = makeSnapshot()
    useThreadStore.setState({ snapshot, selectedId: snapshot.thread.id, threads: [snapshot.thread] })

    const turnFiles = vi.fn(async () => [
      { path: 'src/lastTurnFile.ts', root: '/repo', state: 'pending' as const, preExists: true, postExists: true, additions: 7, deletions: 2 }
    ])

    preloadOxe({
      'git.getBranch': () => ({ branch: 'feat/review', shortSha: null }),
      'git.getDiffSummary': () => ({ files: [], additions: 0, deletions: 0, compiledAt: 1 }),
      'git.getFileOriginal': () => ({ content: 'old', missing: false, binary: false, size: 3, truncated: false }),
      'fs.readFile': () => ({ content: 'new' }),
      'github.listBranches': () => [],
      'github.listWorktrees': () => [],
      'github.resolveWorktreeBase': () => ({ baseRef: 'main' }),
      'thread.turnFiles': turnFiles
    })

    render(<ChangesPanel workspaceId="ws-1" rootPath="/repo" threadId="thread-1" currentProvider="claude" />)
    await screen.findByTestId('changes-panel')

    await user.click(screen.getByRole('button', { name: /^Change scope:/ }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Last turn' }))

    await waitFor(() => expect(turnFiles).toHaveBeenCalledWith('thread-1', 'turn-2'))
    expect((await screen.findAllByText('lastTurnFile.ts')).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /Change scope: Last turn/ })).toBeTruthy()
  })

  test('shows graceful empty state when no last turn exists', async () => {
    const user = userEvent.setup()
    preloadOxe({
      'git.getBranch': () => ({ branch: 'feat/review', shortSha: null }),
      'git.getDiffSummary': () => ({ files: [], additions: 0, deletions: 0, compiledAt: 1 }),
      'github.listBranches': () => [],
      'github.listWorktrees': () => [],
      'github.resolveWorktreeBase': () => ({ baseRef: 'main' })
    })

    render(<ChangesPanel workspaceId="ws-1" rootPath="/repo" />)
    await screen.findByTestId('changes-panel')

    await user.click(screen.getByRole('button', { name: /^Change scope:/ }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Last turn' }))

    expect(await screen.findByText('No last turn changes')).toBeTruthy()
    expect(screen.getByText('No agent turn has recorded file changes in this workspace yet.')).toBeTruthy()
  })
})

describe('OXE-323 · Review with another agent (read-only)', () => {
  test('pickDefaultReviewerProvider chooses a different provider than the current one', () => {
    expect(pickDefaultReviewerProvider('claude')).toBe('codex')
    expect(pickDefaultReviewerProvider('codex')).toBe('claude')
    expect(pickDefaultReviewerProvider(undefined)).toBe('claude')
  })

  test('buildReadOnlyReviewPrompt includes scope and changed files', () => {
    const prompt = buildReadOnlyReviewPrompt({
      scope: 'staged',
      files: [{ path: 'src/app.ts', status: 'M', additions: 4, deletions: 1, binary: false }]
    })
    expect(prompt).toContain('read-only')
    expect(prompt).toContain('src/app.ts')
    expect(prompt).toContain('+4/-1')
  })

  test('opens confirmation dialog, enforces read-only configuration before sending, and launches review', async () => {
    const user = userEvent.setup()
    const callOrder: string[] = []
    const createdSnapshot = makeSnapshot({ id: 'review-thread-1', provider: 'codex', configurationRevision: 0 })
    const configuredSnapshot = makeSnapshot({
      id: 'review-thread-1',
      provider: 'codex',
      configurationRevision: 1,
      configuration: { access: 'read-only', networkAccess: false, hooksEnabled: false }
    })

    const threadCreate = vi.fn(async () => {
      callOrder.push('create')
      return createdSnapshot
    })
    const threadConfigure = vi.fn(async () => {
      callOrder.push('configure')
      return configuredSnapshot
    })
    const threadSend = vi.fn(async () => {
      callOrder.push('send')
    })

    useThreadStore.setState({
      projects: [{ projectId: 'proj-1', displayName: 'demo', contexts: [{ rootPath: '/repo' }] } as never]
    })

    preloadOxe({
      'git.getBranch': () => ({ branch: 'feat/review', shortSha: null }),
      'git.getDiffSummary': () => ({
        files: [{ path: 'src/feature.ts', status: 'M', additions: 12, deletions: 3, binary: false }],
        additions: 12,
        deletions: 3,
        compiledAt: 1
      }),
      'git.getFileOriginal': () => ({ content: 'a', missing: false, binary: false, size: 1, truncated: false }),
      'fs.readFile': () => ({ content: 'b' }),
      'github.listBranches': () => [],
      'github.listWorktrees': () => [],
      'github.resolveWorktreeBase': () => ({ baseRef: 'main' }),
      'thread.create': threadCreate,
      'thread.configure': threadConfigure,
      'thread.send': threadSend
    })

    render(<ChangesPanel workspaceId="ws-1" rootPath="/repo" currentProvider="claude" />)
    const trigger = await screen.findByRole('button', { name: 'Review with another agent' })
    await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false))

    await user.click(trigger)
    const dialog = await screen.findByTestId('review-with-agent-dialog')
    expect(dialog).toBeTruthy()
    expect(screen.getByText('Read-only access')).toBeTruthy()

    const select = screen.getByLabelText('Reviewer agent') as HTMLSelectElement
    // Default reviewer differs from currentProvider ('claude' -> 'codex')
    expect(select.value).toBe('codex')

    await user.selectOptions(select, 'antigravity')
    await user.click(screen.getByRole('button', { name: 'Start read-only review' }))

    await waitFor(() => expect(threadSend).toHaveBeenCalledTimes(1))
    expect(callOrder).toEqual(['create', 'configure', 'send'])
    expect(threadCreate).toHaveBeenCalledWith({ projectId: 'proj-1', rootPath: '/repo', provider: 'antigravity' })
    expect(threadConfigure).toHaveBeenCalledWith(
      'review-thread-1',
      { access: 'read-only', networkAccess: false, hooksEnabled: false },
      0
    )
    expect(threadSend.mock.calls[0]?.[0]).toBe('review-thread-1')
    expect(threadSend.mock.calls[0]?.[1]).toContain('src/feature.ts')
    expect(await screen.findByText('Read-only review started with Antigravity')).toBeTruthy()
  })

  test('never sends prompt if read-only configure fails', async () => {
    const user = userEvent.setup()
    const createdSnapshot = makeSnapshot({ id: 'review-thread-2', provider: 'codex', configurationRevision: 0 })
    const threadSend = vi.fn(async () => undefined)

    useThreadStore.setState({
      projects: [{ projectId: 'proj-1', displayName: 'demo', contexts: [{ rootPath: '/repo' }] } as never]
    })

    preloadOxe({
      'git.getBranch': () => ({ branch: 'feat/review', shortSha: null }),
      'git.getDiffSummary': () => ({
        files: [{ path: 'src/feature.ts', status: 'M', additions: 5, deletions: 1, binary: false }],
        additions: 5,
        deletions: 1,
        compiledAt: 1
      }),
      'git.getFileOriginal': () => ({ content: 'a', missing: false, binary: false, size: 1, truncated: false }),
      'fs.readFile': () => ({ content: 'b' }),
      'github.listBranches': () => [],
      'github.listWorktrees': () => [],
      'github.resolveWorktreeBase': () => ({ baseRef: 'main' }),
      'thread.create': async () => createdSnapshot,
      'thread.configure': async () => { throw new Error('sandbox lock failed') },
      'thread.send': threadSend
    })

    render(<ChangesPanel workspaceId="ws-1" rootPath="/repo" currentProvider="claude" />)
    const trigger = await screen.findByRole('button', { name: 'Review with another agent' })
    await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false))

    await user.click(trigger)
    await user.click(await screen.findByRole('button', { name: 'Start read-only review' }))

    expect(await screen.findByText('Could not start review')).toBeTruthy()
    expect(threadSend).not.toHaveBeenCalled()
  })
})
