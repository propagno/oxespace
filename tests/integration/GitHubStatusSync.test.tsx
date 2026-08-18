import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { GitHubWorkspaceStatus } from '../../shared/types/github'
import { GitHubPanel } from '../../src/components/GitHub/GitHubPanel'
import { useGitHubStore } from '../../src/store/github.store'
import { useWorkspaceStore } from '../../src/store/workspace.store'

vi.mock('../../src/components/Terminal/TerminalView', () => ({
  TerminalView: () => <div data-testid="terminal-view" />
}))

function makeStatus(overrides: Partial<GitHubWorkspaceStatus> = {}): GitHubWorkspaceStatus {
  return {
    cli: { available: true, authenticated: true, user: 'tester', host: 'github.com', message: null },
    repository: {
      owner: 'org',
      name: 'repo',
      fullName: 'org/repo',
      url: 'https://github.com/org/repo',
      defaultBranch: 'main',
      isPrivate: false,
      remoteName: 'origin',
      remoteUrl: 'https://github.com/org/repo.git',
      detected: true
    },
    isGitRepository: true,
    branch: 'main',
    lastCommit: 'abc1234',
    lastCommitRelative: '2 hours ago',
    lastPushRelative: '3 hours ago',
    staged: 0,
    modified: 0,
    untracked: 0,
    ahead: 0,
    behind: 0,
    hasUncommittedChanges: false,
    changes: [],
    ...overrides
  }
}

function renderPanel(): void {
  render(
    <GitHubPanel
      workspaceId="workspace-1"
      rootPath="C:/repo"
      activeTab="status"
      onTabChange={() => undefined}
    />
  )
}

describe('GitHub Status sync (Fetch / Pull / Push)', () => {
  beforeEach(() => {
    useGitHubStore.setState({ byWorkspace: {} })
    useWorkspaceStore.setState({
      workspaces: [{
        id: 'workspace-1',
        name: 'repo',
        rootPath: 'C:/repo',
        layout: '1x1',
        layoutPreset: 1,
        themeId: 'dracula',
        uiDensity: 'compact',
        defaultShellProfileId: 'builtin-claude',
        autoStart: false,
        isActive: true,
        panes: []
      }],
      shellProfiles: [],
      activeWorkspaceId: 'workspace-1',
      isLoading: false,
      error: null
    })

    window.oxe = {
      app: { version: '0.2.10' },
      github: {
        getCliStatus: vi.fn().mockResolvedValue({ available: true, authenticated: true, user: 'tester', host: 'github.com', message: null }),
        getWorkspaceStatus: vi.fn().mockResolvedValue(makeStatus({ behind: 2, ahead: 0 })),
        fetch: vi.fn().mockResolvedValue({ ok: true, message: 'Fetch concluído.' }),
        pullFfOnly: vi.fn().mockResolvedValue({ ok: true, message: 'Branch atualizada (fast-forward).' }),
        stageAll: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
        stageFile: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
        unstageFile: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
        commit: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
        generateCommitMessage: vi.fn().mockResolvedValue({ ok: true, message: 'chore: update' }),
        push: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
        commitAndPush: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
        listBranches: vi.fn().mockResolvedValue([]),
        createBranch: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
        checkoutBranch: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
        listWorktrees: vi.fn().mockResolvedValue([]),
        createWorktree: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
        removeWorktree: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
        listPullRequests: vi.fn().mockResolvedValue([]),
        createPullRequest: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
        listCommits: vi.fn().mockResolvedValue([]),
        getCommitDetails: vi.fn().mockResolvedValue({}),
        listReleases: vi.fn().mockResolvedValue([]),
        createRelease: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
        listWorkflows: vi.fn().mockResolvedValue([]),
        listWorkflowRuns: vi.fn().mockResolvedValue([]),
        getWorkflowRunDetails: vi.fn().mockResolvedValue({}),
        runWorkflow: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
        rerunRun: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
        getRunLogs: vi.fn().mockResolvedValue({ logs: '', truncated: false, bytes: 0 }),
        listCheckpoints: vi.fn().mockResolvedValue([]),
        createCheckpoint: vi.fn().mockResolvedValue({}),
        restoreCheckpoint: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
        deleteCheckpoint: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
        listConnectedRepositories: vi.fn().mockResolvedValue([]),
        connectRepository: vi.fn().mockResolvedValue({})
      }
    } as unknown as typeof window.oxe
  })

  test('shows clear pull message and enables Pull when behind and clean', async () => {
    const user = userEvent.setup()
    renderPanel()

    await waitFor(() => {
      expect(screen.getByTestId('github-sync-title')).toHaveTextContent(/2 commits? to pull/i)
      expect(screen.getByTestId('github-status-headline')).toHaveTextContent(/2 to pull/i)
      expect(screen.getByTestId('github-sync-banner')).toBeInTheDocument()
      expect(screen.getByText(/2 incoming/i)).toBeInTheDocument()
    })

    const pullBtn = screen.getByTestId('github-status-update')
    expect(pullBtn).toBeEnabled()
    expect(pullBtn).toHaveTextContent(/Pull 2/)
    expect(screen.getByTestId('github-status-push')).toBeDisabled()

    await user.click(screen.getByTestId('github-status-fetch'))
    await waitFor(() => {
      expect(window.oxe.github.fetch).toHaveBeenCalledWith({ workspaceId: 'workspace-1', rootPath: 'C:/repo' })
    })
  })

  test('Pull confirms and calls pullFfOnly', async () => {
    const user = userEvent.setup()
    renderPanel()

    await waitFor(() => expect(screen.getByTestId('github-status-update')).toBeEnabled())
    await user.click(screen.getByTestId('github-status-update'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => {
      expect(window.oxe.github.pullFfOnly).toHaveBeenCalledWith({ workspaceId: 'workspace-1', rootPath: 'C:/repo' })
    })
  })

  test('Pull is disabled when working tree is dirty', async () => {
    window.oxe.github.getWorkspaceStatus = vi.fn().mockResolvedValue(
      makeStatus({ behind: 3, hasUncommittedChanges: true, modified: 1 })
    )

    renderPanel()

    await waitFor(() => {
      expect(screen.getByTestId('github-sync-title')).toHaveTextContent(/3 commits? to pull/i)
      expect(screen.getByTestId('github-status-update')).toBeDisabled()
      expect(screen.getByTestId('github-dirty-behind-callout')).toBeInTheDocument()
    })
    expect(screen.getByTestId('github-status-update')).toHaveAttribute(
      'title',
      expect.stringMatching(/commit|stash/i)
    )
  })

  test('shows push-ready state when only ahead', async () => {
    window.oxe.github.getWorkspaceStatus = vi.fn().mockResolvedValue(makeStatus({ behind: 0, ahead: 1 }))

    renderPanel()

    await waitFor(() => {
      expect(screen.getByTestId('github-sync-title')).toHaveTextContent(/1 commits? to push/i)
      expect(screen.getByText(/1 outgoing/i)).toBeInTheDocument()
    })
    expect(screen.getByTestId('github-status-update')).toBeDisabled()
    expect(screen.getByTestId('github-status-push')).toBeEnabled()
    expect(screen.getByTestId('github-status-push')).toHaveTextContent(/Push 1/)
  })

  test('shows up-to-date copy when synced', async () => {
    window.oxe.github.getWorkspaceStatus = vi.fn().mockResolvedValue(makeStatus({ ahead: 0, behind: 0, modified: 2, hasUncommittedChanges: true }))

    renderPanel()

    await waitFor(() => {
      expect(screen.getByTestId('github-sync-title')).toHaveTextContent(/In sync with remote/i)
      expect(screen.getByTestId('github-status-headline')).toHaveTextContent(/2 files? changed/i)
    })
    expect(screen.getByTestId('github-status-update')).toBeDisabled()
    expect(screen.getByTestId('github-status-push')).toBeDisabled()
    expect(screen.getByTestId('github-changes-card')).toHaveTextContent(/2 files/i)
  })

  test('shows no-remote callout when origin is missing', async () => {
    window.oxe.github.getWorkspaceStatus = vi.fn().mockResolvedValue(
      makeStatus({
        repository: {
          owner: null as unknown as string,
          name: null as unknown as string,
          fullName: null as unknown as string,
          url: null as unknown as string,
          defaultBranch: null as unknown as string,
          isPrivate: false,
          remoteName: null as unknown as string,
          remoteUrl: null as unknown as string,
          detected: false
        },
        lastPushRelative: null
      })
    )

    renderPanel()

    await waitFor(() => {
      expect(screen.getByTestId('github-no-remote-callout')).toBeInTheDocument()
      expect(screen.getByTestId('github-sync-title')).toHaveTextContent(/No remote/i)
    })
    expect(screen.getByTestId('github-status-fetch')).toBeDisabled()
  })

  test('lists changed files and stages or unstages them individually', async () => {
    const user = userEvent.setup()
    window.oxe.github.getWorkspaceStatus = vi.fn().mockResolvedValue(makeStatus({
      staged: 1,
      modified: 1,
      hasUncommittedChanges: true,
      changes: [
        { path: 'src/staged.ts', indexStatus: 'M', workTreeStatus: ' ', staged: true, unstaged: false, untracked: false, renamed: false, deleted: false },
        { path: 'src/changed.ts', indexStatus: ' ', workTreeStatus: 'M', staged: false, unstaged: true, untracked: false, renamed: false, deleted: false }
      ]
    }))

    renderPanel()

    await screen.findByText('changed.ts')
    await user.click(screen.getByRole('button', { name: 'Stage src/changed.ts' }))
    await waitFor(() => expect(window.oxe.github.stageFile).toHaveBeenCalledWith({ workspaceId: 'workspace-1', rootPath: 'C:/repo', path: 'src/changed.ts' }))

    await user.click(screen.getByRole('button', { name: 'Unstage src/staged.ts' }))
    await waitFor(() => expect(window.oxe.github.unstageFile).toHaveBeenCalledWith({ workspaceId: 'workspace-1', rootPath: 'C:/repo', path: 'src/staged.ts' }))
  })
})
