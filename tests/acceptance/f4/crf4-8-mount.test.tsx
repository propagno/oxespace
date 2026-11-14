// Frozen acceptance test for CR-F4-8 (OXE program, phase F4; FRONTEND's review of #749 @ 84440c3c, accepted by the TECH
// LEAD 09/11). #749 built ThreadTabs, ThreadTerminalTab, PullRequestTab and CollisionChips but mounted none of them,
// kept two pane branch badges, and asked main for the PR state with a thread id. DESIGN U4.4, U4.5, U4.6 and U4.8.
// Written by the planner; the executor must not edit it. It renders the real ThreadView and PaneContainer over the
// real preload (crf4-8-preload.ts): only main is fake, so a call the preload doesn't expose never answers.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { changeLanguage } from '../../../src/i18n'
import { useAccountStore } from '../../../src/store/account.store'
import { useTerminalStore } from '../../../src/store/terminal.store'
import { useThreadStore } from '../../../src/store/thread.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'
import { ThreadView } from '../../../src/components/Threads/ThreadView'
import { threadToolTabs } from '../../../electron/main/services/conversation/thread-tool-tabs'
import type { ThreadSnapshot } from '../../../shared/types/thread'
import type { ThreadPane, ThreadPlace } from '../../../shared/types/thread-places'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'
import { preloadOxe, type FakeMain } from './crf4-8-preload'

vi.mock('../../../src/hooks/useGitBranch', () => ({ useGitBranch: () => ({ branch: 'feat/thread', detached: false, shortSha: null, error: null }) }))
vi.mock('../../../src/components/Panes/PaneContent', () => ({ PaneContent: () => null }))

const PLACE: ThreadPlace = {
  id: 'pl-tree', kind: 'worktree', path: '/repo', firstSeenAt: 1,
  base: { commit: '9bb5339aa', branch: 'feat/thread', capturedAt: 1, turnId: 't1' }, current: { branch: 'feat/thread', commit: '9bb5339aa' },
  drift: null, writes: 1, files: ['src/x.ts']
}
const PANES: ThreadPane[] = [
  { paneId: 'pane-agent', title: 'claude · fix', workspaceId: 'ws', placeId: 'pl-tree', via: 'agent-location', group: 'agent' },
  { paneId: 'pane-mine', title: 'pwsh · tests', workspaceId: 'ws', placeId: 'pl-tree', via: 'shell-osc', group: 'yours' }
]
const PR = {
  provider: 'github', cli: 'ok',
  pr: { number: 321, title: 'Fix the login', state: 'open', draft: false, head: 'feat/thread', base: 'main', url: 'https://github.com/o/r/pull/321', workItems: [], checks: [], reviewers: [] }
}

function conversation(main: FakeMain = {}) {
  const snapshot: ThreadSnapshot = { thread: { id: 'thread', workspaceId: 'ws', projectId: 'project', rootPath: '/repo', provider: 'claude', title: 'Auth investigation', pinned: false, status: 'idle', nativeSessionId: null, createdAt: 1, updatedAt: 1 }, events: [] }
  const handlers: FakeMain = {
    'thread.commands': () => ({ commands: [] }),
    'thread.projects': () => ({ projects: [], unavailable: [] }),
    'thread.list': () => [snapshot.thread],
    'thread.read': () => snapshot,
    'thread.models': () => ({ defaultModel: 'm', models: [{ id: 'm', label: 'Model', description: '', efforts: [], defaultEffort: null }] }),
    'agentAccount.read': () => ({ provider: 'claude', scopeId: 'test', state: 'connected', method: 'subscription', checkedAt: 1 }),
    'thread.places': () => ({ places: [PLACE], capped: false, refused: 0 }),
    'thread.placeDiff': () => ({ place: PLACE, groups: { task: { files: [], base: '9bb5339aa', includeUncommitted: true, compiledAt: 1 } } }),
    'thread.panes': () => [],
    'thread.collisions': () => [],
    'pullRequest.state': () => ({ provider: 'github', cli: 'ok', pr: null }),
    'thread.toolTabs': async () => {
      const placesRes = await Promise.resolve(handlers['thread.places']?.('thread')) as { places: ThreadPlace[] } | undefined
      const panesRes = await Promise.resolve(handlers['thread.panes']?.('thread')) as ThreadPane[] | undefined
      const prRes = await Promise.resolve(handlers['pullRequest.state']?.({ rootPath: '/repo', branch: 'feat/thread' })) as { pr: { number: number } | null } | undefined
      return threadToolTabs({
        summary: { databases: 0, http: 0, containers: 0 },
        files: placesRes ? placesRes.places.reduce((sum, entry) => sum + entry.files.length, 0) : 0,
        panes: panesRes ? panesRes.length : 0,
        pullRequest: prRes?.pr ? { number: prRes.pr.number } : null
      })
    },
    ...main
  }
  const bridge = preloadOxe(handlers)
  const workspace = { id: 'ws', name: 'Repo', rootPath: '/repo', panes: [] } as unknown as Workspace
  useAccountStore.setState({ scopes: {}, snapshots: {} })
  useWorkspaceStore.setState({ workspaces: [workspace] })
  useThreadStore.setState({ threads: [snapshot.thread], projects: [{ projectId: 'project', displayName: 'Repo', identityLabel: '/repo', hidden: false, contexts: [{ rootPath: '/repo', label: 'Repo' }] }], snapshot, selectedId: 'thread', secondaryId: null, snapshotCache: {}, snapshotCacheOrder: [], drafts: {}, errors: {}, hiddenProjects: [] })
  render(<ThreadView workspace={workspace} />)
  return bridge
}
const tabNames = (): string[] => within(screen.getByRole('tablist', { name: 'Conversation tabs' })).getAllByRole('tab').map(tab => tab.textContent?.replace(/\d+/g, '').trim() ?? '')

afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('CR-F4-8 · the F4 tabs, chips and badge are mounted and reach main through the preload', () => {
  // Changed on 2026-11-13 by the product owner's decision: the Terminal tab left the conversation (1.5.2). The strip still
  // reads main again on a push; a pane main reports adds no tab.
  test('CR-F4-8 · the conversation shows the tab strip, and a pane main reports adds no Terminal tab, after a push', async () => {
    let panes: ThreadPane[] = []
    const bridge = conversation({ 'thread.panes': () => panes })
    await waitFor(() => expect(tabNames()).toEqual(['Conversation', 'Changes']))
    panes = PANES
    await act(async () => { bridge.emit('thread.placesChanged', { threadId: 'thread' }); bridge.emit('thread.toolTabsChanged', { threadId: 'thread' }) })
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(tabNames()).toEqual(['Conversation', 'Changes'])
  }, 30_000)

  // Changed on 2026-11-13 by the product owner's decision: the Terminal and Pull request tabs left the conversation
  // (1.5.2), so their two tests (the panes under Agent's and Yours, the PR asked with the root and branch) went with them.
  test('CR-F4-8 · with panes and a pull request in main, the conversation shows neither a Terminal nor a Pull request tab', async () => {
    conversation({ 'thread.panes': () => PANES, 'pullRequest.state': () => PR })
    await waitFor(() => expect(tabNames()).toEqual(['Conversation', 'Changes']))
    expect(screen.queryByRole('tab', { name: /^Terminal|Pull request/ })).toBeNull()
  }, 30_000)

  test('CR-F4-8 · the collision chip sits in the conversation header and opens the other conversation', async () => {
    const select = vi.fn(async () => undefined)
    conversation({ 'thread.collisions': () => [{ file: 'src/x.ts', checkoutId: 'co-1', others: [{ conversationId: 'other', title: 'Login refactor' }] }] })
    useThreadStore.setState({ select } as never)
    const header = screen.getByRole('heading', { level: 1, name: 'Auth investigation' }).closest('header') as HTMLElement
    const chip = await within(header).findByRole('button', { name: /Also edited by Login refactor/ })
    await userEvent.click(chip)
    expect(select).toHaveBeenCalledWith('other')
  }, 30_000)

  test('CR-F4-8 · a pane carries one branch badge, the Panes one, fed by the preload and turning on a switch', async () => {
    expect(existsSync(join(process.cwd(), 'src/components/Workspace/PaneBranchBadge.tsx'))).toBe(false)
    const bridge = preloadOxe({ 'terminal.branch': () => ({ branch: 'feat/x', startedOn: 'feat/x', switched: false }) })
    const pane = { id: 'p1', workspaceId: 'ws-1', type: 'terminal', rowIndex: 0, columnIndex: 0, status: 'running', agentProfileId: null, agentName: null, displayName: null, shellProfileId: null, rootPath: null, createdAt: null } as unknown as WorkspacePane
    const workspace = { id: 'ws-1', name: 'demo', rootPath: '/repo', defaultShellProfileId: null, panes: [pane] } as unknown as Workspace
    useTerminalStore.setState({ panes: {}, activePaneId: null })
    useWorkspaceStore.setState({ workspaces: [workspace], shellProfiles: [] })
    const { PaneContainer } = await import('../../../src/components/Grid/PaneContainer')
    const { container } = render(<PaneContainer pane={pane} workspace={workspace} agentProfile={null} autoStart={false} isMaximized={false} onToggleMaximize={() => undefined} />)
    expect(await screen.findByRole('img', { name: 'On feat/x' })).toBeInTheDocument()
    await act(async () => { bridge.emit('terminal.branchChanged', { paneId: 'p1', branch: 'fix/y', startedOn: 'feat/x', switched: true }) })
    const badge = await screen.findByRole('img', { name: 'On fix/y, switched from feat/x' })
    expect(badge).toHaveAttribute('data-tone', 'warning')
    expect(container.querySelectorAll('.pane-branch-badge')).toHaveLength(1)
  }, 30_000)
})
