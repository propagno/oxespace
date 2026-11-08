// Frozen acceptance test for 1.5.0 F4 (OXE program): the contract around places, the resolver, panes, collisions, the
// pull request provider and the worktrees panel. IPC channels and preload, MCP coverage (place-read and the drift answer
// forbidden), the C3 codes, and migration 095.
// Written by the planner; the executor must not edit it.
// Spec: docs/roadmap-1.5/ccr-f4-places-pr.md §Contract.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
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
      agentSummary: 'thread:agent-summary'
    })
    // The old single-root diff stays one release for Code mode's review panel.
    expect(IPC_CHANNELS.thread.projectDiff).toBe('thread:project-diff')
  })

  test('F4: the pull request provider and the worktrees panel channels', () => {
    expect(IPC_CHANNELS.pullRequest).toEqual({ state: 'pull-request:state' })
    expect(IPC_CHANNELS.worktreesPanel).toEqual({ list: 'worktrees-panel:list', remove: 'worktrees-panel:remove' })
  })

  test('F4: the preload exposes every new channel through IPC_CHANNELS, and no write channel takes a place id', () => {
    const preload = text('electron/preload/api.ts')
    for (const key of ['places', 'placeDiff', 'resolvePath', 'placeDriftAnswer', 'placeRead', 'placesChanged', 'panes', 'collisions', 'agentSummary']) {
      expect(preload).toMatch(new RegExp(`IPC_CHANNELS\\.thread\\.${key}\\b`))
    }
    expect(preload).toMatch(/IPC_CHANNELS\.pullRequest\.state\b/)
    expect(preload).toMatch(/IPC_CHANNELS\.worktreesPanel\.(list|remove)\b/)
    // Outside files are read only: the file-system write inputs know nothing of places.
    expect(text('shared/types/filesystem.ts')).not.toMatch(/placeId/)
  })

  test('F4: MCP coverage: place-read and the drift answer are forbidden; the read models are excluded', () => {
    for (const key of ['thread.placeRead', 'thread.placeDriftAnswer']) {
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
    for (const code of ['thread.place.dirty', 'thread.place.detached', 'thread.place.gone', 'thread.place.noDrift', 'thread.place.notEvidence', 'thread.place.outside', 'worktree.remove.dirty', 'worktree.remove.notFound', 'worktree.remove.unmergedBranch']) {
      expect(MESSAGE_CODES as readonly string[]).toContain(code)
    }
  })

  test('F4: migration 095 adds the place tables only, after H1\'s 094', () => {
    const path = 'electron/main/db/migrations/095_thread_places.sql'
    expect(existsSync(join(repo, path))).toBe(true)
    const sql = text(path)
    for (const table of ['thread_places', 'thread_place_writes', 'thread_turn_cwd']) expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`))
    expect(sql).toMatch(/PRAGMA user_version = 95;/)
    expect(sql).not.toMatch(/\b(DROP|ALTER)\s+TABLE\b/i)
    expect(sql).toMatch(/kind IN \('root', 'worktree', 'checkout', 'outside'\)/)
  })
})
