// Frozen acceptance test for 1.5.0 F8 (OXE program): the contract. Agora (A29) is the window's, over the existing agents
// overview and F6's activity, so it has no backend test here; the timeline and branch are new thread channels (A30); the
// branch name is prefilled from the conversation and the checkpoint time. Written by the planner; the executor must not
// edit it. CCR: docs/roadmap-1.5/ccr-f8-agora-history.md §Contract.
import { describe, expect, test, vi } from 'vitest'
import { branchNameFor } from '../../../shared/branch-name'
import { createOxeApi, type PreloadIpc } from '../../../electron/preload/api'
import { MESSAGE_CODES } from '../../../shared/messages'
import { MCP_COVERAGE } from '../../../shared/mcp-coverage'
import { REMOTE_COMMANDS } from '../../../shared/remote/protocol'
import { IPC_CHANNELS } from '../../../shared/types/ipc'

const claims = (key: string) => Object.values(MCP_COVERAGE).filter(capability => capability.ipc?.includes(key) || capability.ipc?.includes(`${key.split('.')[0]}.*`))

describe('F8 · contract', () => {
  test('A30: history and branch are thread channels, preloaded', async () => {
    expect(IPC_CHANNELS.thread).toMatchObject({ timeline: 'thread:timeline', branchFromCheckpoint: 'thread:branch-from-checkpoint' })
    // thread:history stays the message history pages it already is.
    expect(IPC_CHANNELS.thread.history).toBe('thread:history')
    const invoke = vi.fn().mockResolvedValue(undefined)
    const api = createOxeApi({ invoke, on: vi.fn(), removeListener: vi.fn() } as PreloadIpc) as unknown as { thread: Record<string, (...args: unknown[]) => unknown> }
    await api.thread.timeline('t1')
    await api.thread.branchFromCheckpoint('t1', 'cp1', { branch: 'oxe/x' })
    expect(invoke.mock.calls).toEqual([[IPC_CHANNELS.thread.timeline, 't1'], [IPC_CHANNELS.thread.branchFromCheckpoint, 't1', 'cp1', { branch: 'oxe/x' }]])
  })

  test('A30: MCP coverage: branching is the person\'s (forbidden); the timeline is an excluded read model', () => {
    const branch = claims('thread.branchFromCheckpoint')
    expect(branch).toHaveLength(1)
    expect(branch[0]).toHaveProperty('forbidden')
    const timeline = claims('thread.timeline')
    expect(timeline).toHaveLength(1)
    expect(timeline[0]).toHaveProperty('excluded')
  })

  test('A30: the branch name is prefilled as oxe/<slug>-from-HHMM, ASCII, at most 60 characters, and always a safe ref name', () => {
    const at = new Date(2026, 10, 8, 14, 3).getTime()
    expect(branchNameFor('Fix the Pix webhook retries', at)).toBe('oxe/fix-the-pix-webhook-retries-from-1403')
    expect(branchNameFor('Ação: refatorar módulo de cobrança!!', at)).toBe('oxe/acao-refatorar-modulo-de-cobranca-from-1403')
    expect(branchNameFor('', at)).toBe('oxe/conversation-from-1403')
    const long = branchNameFor('x'.repeat(200), at)
    expect(long.length).toBeLessThanOrEqual(60)
    expect(long).toMatch(/^oxe\/[a-z0-9-]+-from-1403$/)
  })

  test('A30: the C3 codes for branching', () => {
    for (const code of ['thread.branch.unsupported', 'thread.branch.checkpointGone', 'thread.branch.checkpointFailed', 'thread.branch.exists',
      'thread.branch.pathExists', 'thread.branch.baseGone', 'thread.branch.notGit', 'thread.branch.sessionGone', 'thread.branch.failed',
      ]) expect(MESSAGE_CODES as readonly string[], code).toContain(code)
  })

  test('A30 (SECURITY): Restore and Branch are a person\'s: forbidden to agents over MCP, and never a phone command', () => {
    // The path is live: these channels exist, and the phone does have commands.
    expect(IPC_CHANNELS.thread).toMatchObject({ rewind: 'thread:rewind', redoRewind: 'thread:redo-rewind' })
    expect(REMOTE_COMMANDS.length).toBeGreaterThan(0)
    for (const key of ['thread.rewind', 'thread.redoRewind', 'thread.branchFromCheckpoint']) {
      const claimed = claims(key)
      expect(claimed, key).toHaveLength(1)
      expect(claimed[0], key).toHaveProperty('forbidden')
      expect(REMOTE_COMMANDS as readonly string[], key).not.toContain(key)
    }
  })
})
