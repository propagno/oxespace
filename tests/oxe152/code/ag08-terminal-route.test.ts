// Acceptance test for 1.5.2 OxeChat/OxeCode bridge (Jira OXE-190, AG-08, CA-3).
// Contract: terminal-to-OxeChat router resolves the matching thread (preferring ownedWorktree / observedLocation
// over project rootPath) or new-conversation draft using normalized Windows-safe paths (drive case, slashes, trailing slash).
import { describe, expect, test } from 'vitest'
import { normalizePathForMatch, resolveTerminalChatTarget } from '../../../src/components/Terminal/terminalToChat'
import type { ConversationThread, ThreadProjectSummary } from '../../../shared/types/thread'

const thread = (overrides: Partial<ConversationThread>): ConversationThread => ({
  id: 't-default',
  workspaceId: 'ws-1',
  projectId: 'proj-1',
  rootPath: 'C:/Users/Dev/Repo',
  provider: 'claude',
  nativeSessionId: null,
  title: 'Thread',
  pinned: false,
  status: 'idle',
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides
})

const project = (projectId: string, rootPath: string): ThreadProjectSummary => ({
  projectId,
  displayName: projectId,
  identityLabel: projectId,
  hidden: false,
  contexts: [{ rootPath, label: projectId }]
})

describe('OXE-190 · AG-08 terminal-to-OxeChat router', () => {
  test('terminal-to-OxeChat router resolves thread or new draft by normalized project and worktree cwd', () => {
    expect(normalizePathForMatch('C:\\Users\\Dev\\Repo\\')).toBe('c:/users/dev/repo')
    expect(normalizePathForMatch('c:/users/dev/repo///')).toBe('c:/users/dev/repo')
    expect(normalizePathForMatch('/home/dev/repo/')).toBe('/home/dev/repo')

    const mainThread = thread({
      id: 't-main',
      projectId: 'proj-a',
      rootPath: 'C:/Repos/Alpha',
      updatedAt: 3000
    })
    const worktreeThread = thread({
      id: 't-wt',
      projectId: 'proj-a',
      rootPath: 'C:/Repos/Alpha',
      ownedWorktree: {
        path: 'C:/Repos/Alpha-wt-feat',
        branch: 'feat/x',
        baseBranch: 'main'
      } as ConversationThread['ownedWorktree'],
      updatedAt: 2000
    })

    // Exact worktree match with Windows backslash, lowercase drive, and trailing slash wins over rootPath thread.
    expect(
      resolveTerminalChatTarget({
        cwd: 'c:\\repos\\alpha-wt-feat\\',
        workspaceRootPath: 'C:/Repos/Alpha',
        threads: [mainThread, worktreeThread],
        projects: [project('proj-a', 'C:/Repos/Alpha')]
      })
    ).toEqual({
      kind: 'thread',
      threadId: 't-wt',
      rootPath: 'C:/Repos/Alpha-wt-feat'
    })

    // Nested subdirectory inside the worktree still resolves to the worktree thread.
    expect(
      resolveTerminalChatTarget({
        cwd: 'C:\\Repos\\Alpha-wt-feat\\packages\\core',
        workspaceRootPath: 'C:/Repos/Alpha',
        threads: [mainThread, worktreeThread],
        projects: [project('proj-a', 'C:/Repos/Alpha')]
      })
    ).toEqual({
      kind: 'thread',
      threadId: 't-wt',
      rootPath: 'C:/Repos/Alpha-wt-feat'
    })

    // Root directory resolves to the project's root thread.
    expect(
      resolveTerminalChatTarget({
        cwd: 'c:/repos/alpha/',
        threads: [mainThread, worktreeThread],
        projects: [project('proj-a', 'C:/Repos/Alpha')]
      })
    ).toEqual({
      kind: 'thread',
      threadId: 't-main',
      rootPath: 'C:/Repos/Alpha'
    })

    // Project with no active thread resolves to a new-conversation draft for that project.
    expect(
      resolveTerminalChatTarget({
        cwd: 'c:\\repos\\beta\\src\\',
        threads: [mainThread],
        projects: [project('proj-a', 'C:/Repos/Alpha'), project('proj-b', 'C:/Repos/Beta')]
      })
    ).toEqual({
      kind: 'new-draft',
      projectId: 'proj-b',
      rootPath: 'C:/Repos/Beta'
    })
  })
})
