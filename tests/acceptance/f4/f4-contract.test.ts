// Frozen acceptance test for 1.5.0 F4 (OXE program): the contract around places, the resolver, panes, collisions, the
// pull request provider and the worktrees panel. IPC channels and preload, MCP coverage (place-read and the drift answer
// forbidden) and the C3 codes. Migration 095 is exercised on a real database in a13.
// Written by the planner; the executor must not edit it.
// Spec: docs/roadmap-1.5/ccr-f4-places-pr.md §Contract.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { createOxeApi, type PreloadIpc } from '../../../electron/preload/api'
import { MESSAGE_CODES } from '../../../shared/messages'
import { MCP_COVERAGE } from '../../../shared/mcp-coverage'
import { IPC_CHANNELS } from '../../../shared/types/ipc'

const repo = join(__dirname, '..', '..', '..')
const text = (path: string): string => readFileSync(join(repo, path), 'utf8')
const claims = (key: string) => {
  const namespace = `${key.split('.')[0]}.*`
  return Object.values(MCP_COVERAGE).filter(capability => capability.ipc?.includes(key) || capability.ipc?.includes(namespace))
}

describe('F4 · contract', () => {
  test('F4: the thread channels for places, the resolver, panes, collisions and the agent summary', () => {
    expect(IPC_CHANNELS.thread).toMatchObject({
      places: 'thread:places',
      placeDiff: 'thread:place-diff',
      resolvePath: 'thread:resolve-path',
      placeDriftAnswer: 'thread:place-drift-answer',
      placeRead: 'thread:place-read',
      placesChanged: 'thread:places-changed',
      panes: 'thread:panes',
      collisions: 'thread:collisions',
      agentSummary: 'thread:agent-summary',
      placeUndo: 'thread:place-undo',
      placeRestore: 'thread:place-restore',
      placeDiscard: 'thread:place-discard'
    })
    // The old single-root diff stays one release for Code mode's review panel.
    expect(IPC_CHANNELS.thread.projectDiff).toBe('thread:project-diff')
  })

  test('F4: the pull request provider and the worktrees panel channels', () => {
    expect(IPC_CHANNELS.pullRequest).toEqual({ state: 'pull-request:state' })
    expect(IPC_CHANNELS.worktreesPanel).toEqual({ list: 'worktrees-panel:list', remove: 'worktrees-panel:remove' })
  })

  test('F4: the preload API calls each new channel with what the window passes', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined)
    const on = vi.fn()
    const api = createOxeApi({ invoke, on, removeListener: vi.fn() } as PreloadIpc)
    const thread = api.thread as unknown as Record<string, (...args: unknown[]) => unknown>
    await thread.places('t1')
    await thread.placeDiff('t1', 'p1')
    await thread.resolvePath('t1', 'src/x.ts', { turnId: 'turn-1' })
    await thread.placeDriftAnswer('t1', 'p1', 'followed')
    await thread.placeRead('t1', 'p1', 'ROTEIRO.md')
    await thread.panes('t1')
    await thread.collisions('t1')
    await thread.agentSummary('t1')
    await thread.placeUndo('t1', 'p1', { path: 'a.txt', hunk: '@@ -1 +1 @@', seenMtime: 5 })
    await thread.placeRestore('t1', 'token')
    await thread.placeDiscard('t1', 'p1', { confirmed: true })
    const other = api as unknown as Record<string, Record<string, (...args: unknown[]) => unknown>>
    await other.pullRequest.state({ rootPath: '/r', branch: 'agent-fix' })
    await other.worktreesPanel.list({ rootPath: '/r' })
    await other.worktreesPanel.remove({ rootPath: '/r', path: '/r-tree', deleteBranch: false })
    expect(invoke.mock.calls).toEqual([
      [IPC_CHANNELS.thread.places, 't1'], [IPC_CHANNELS.thread.placeDiff, 't1', 'p1'], [IPC_CHANNELS.thread.resolvePath, 't1', 'src/x.ts', { turnId: 'turn-1' }],
      [IPC_CHANNELS.thread.placeDriftAnswer, 't1', 'p1', 'followed'], [IPC_CHANNELS.thread.placeRead, 't1', 'p1', 'ROTEIRO.md'], [IPC_CHANNELS.thread.panes, 't1'],
      [IPC_CHANNELS.thread.collisions, 't1'], [IPC_CHANNELS.thread.agentSummary, 't1'],
      [IPC_CHANNELS.thread.placeUndo, 't1', 'p1', { path: 'a.txt', hunk: '@@ -1 +1 @@', seenMtime: 5 }], [IPC_CHANNELS.thread.placeRestore, 't1', 'token'],
      [IPC_CHANNELS.thread.placeDiscard, 't1', 'p1', { confirmed: true }], [IPC_CHANNELS.pullRequest.state, { rootPath: '/r', branch: 'agent-fix' }],
      [IPC_CHANNELS.worktreesPanel.list, { rootPath: '/r' }], [IPC_CHANNELS.worktreesPanel.remove, { rootPath: '/r', path: '/r-tree', deleteBranch: false }]
    ])
    const listener = vi.fn()
    thread.onPlacesChanged(listener)
    expect(on).toHaveBeenCalledWith(IPC_CHANNELS.thread.placesChanged, expect.any(Function))
  })

  test('F4: no file-system write input takes a place id: outside files stay read only', () => {
    // rigor: source-assertion — the criterion is the absence of a write path, which no call can show; the input types are the surface.
    expect(text('shared/types/filesystem.ts')).not.toMatch(/placeId/)
  })

  test('F4: MCP coverage: place-read and the drift answer are forbidden; the read models are excluded', () => {
    for (const key of ['thread.placeRead', 'thread.placeDriftAnswer', 'thread.placeUndo', 'thread.placeRestore', 'thread.placeDiscard']) {
      const found = claims(key)
      expect(found, key).toHaveLength(1)
      expect(found[0], key).toHaveProperty('forbidden')
    }
    for (const key of ['thread.places', 'thread.placeDiff', 'thread.resolvePath', 'thread.placesChanged', 'thread.panes', 'thread.collisions', 'thread.agentSummary', 'pullRequest.state', 'worktreesPanel.list', 'worktreesPanel.remove']) {
      const found = claims(key)
      expect(found, key).toHaveLength(1)
      expect(found[0], key).toHaveProperty('excluded')
    }
  })

  test('F4: the C3 refusal codes are in the catalog of main codes', () => {
    for (const code of ['thread.place.dirty', 'thread.place.detached', 'thread.place.gone', 'thread.place.noDrift', 'thread.place.notEvidence', 'thread.place.outside', 'worktree.remove.dirty', 'worktree.remove.notFound', 'worktree.remove.unmergedBranch',
      'thread.place.busy', 'thread.place.branchGone', 'worktree.remove.busy', 'worktree.remove.failed', 'worktree.remove.locked', 'worktree.remove.defaultBranch', 'worktree.remove.branchInUse',
      'thread.place.stale', 'thread.place.notTask', 'thread.place.restoreGone', 'thread.place.confirm']) {
      expect(MESSAGE_CODES as readonly string[]).toContain(code)
    }
  })

})
