// Frozen acceptance test for 1.5.0 F4, SECURITY S1 (TECH LEAD on #704): Switch back (git switch), the worktrees panel's
// Remove and branch delete, and thread:place-read are reachable only from the window's IPC on a person's action. None is
// an MCP tool, an internal RPC method, a phone command, or called from any agent-facing module.
// Written by the planner; the executor must not edit it.
// Spec: docs/roadmap-1.5/ccr-f4-places-pr.md §SECURITY.
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f4/f4-security-reach.native.test.ts
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { activeTools, findTool, TOOL_REGISTRY } from '../../../electron/main/mcp-internal/tool-registry'
import { MCP_COVERAGE } from '../../../shared/mcp-coverage'
import { REMOTE_COMMANDS } from '../../../shared/remote/protocol'
import { IPC_CHANNELS } from '../../../shared/types/ipc'

/** The person-only operations, by the names a tool, an RPC method or a call would carry. */
const PRIVILEGED = [
  { op: 'Switch back', methods: ['answerPlaceDrift', 'switchPlaceBack'], ipc: 'thread.placeDriftAnswer', words: /place[_-]?drift|switch[_-]?back/i },
  { op: 'Read an outside file', methods: ['readPlaceFile'], ipc: 'thread.placeRead', words: /place[_-]?read/i },
  { op: 'Worktrees panel Remove and branch delete', methods: ['WorktreesPanel'], ipc: 'worktreesPanel.remove', words: /worktrees?[_-]?panel/i }
] as const

const ROOT = process.cwd()
function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap(name => {
    const rel = `${dir}/${name}`
    return statSync(join(ROOT, rel)).isDirectory() ? sources(rel) : /\.(ts|js|cjs|mjs)$/.test(name) ? [rel] : []
  })
}

describe('F4 · S1: person-only operations are out of every agent path', () => {
  test.each(PRIVILEGED)('S1: $op is no MCP tool: not in the registry, not found by name, and its channel is forbidden or excluded with no tools', ({ methods, ipc, words }) => {
    // Every registered tool, active or not, by name and description.
    for (const entry of TOOL_REGISTRY) {
      const { name, description } = entry.descriptor
      expect(words.test(name), name).toBe(false)
      for (const method of methods) expect(`${name} ${description ?? ''}`.includes(method), name).toBe(false)
    }
    expect(activeTools().length).toBeGreaterThan(0)
    for (const guess of ['oxespace_place_read', 'oxespace_thread_place_read', 'oxespace_place_drift_answer', 'oxespace_switch_back', 'oxespace_worktrees_panel']) expect(findTool(guess), guess).toBeNull()
    const claims = Object.values(MCP_COVERAGE).filter(capability => capability.ipc?.includes(ipc) || capability.ipc?.includes(`${ipc.split('.')[0]}.*`))
    expect(claims, ipc).toHaveLength(1)
    expect('tools' in claims[0], ipc).toBe(false)
    expect('forbidden' in claims[0] || 'excluded' in claims[0], ipc).toBe(true)
  })

  test('S1: the drift answer and place-read are forbidden (never planned as tools); the panel channels exist for the window only', () => {
    for (const ipc of ['thread.placeDriftAnswer', 'thread.placeRead']) {
      const [claim] = Object.values(MCP_COVERAGE).filter(capability => capability.ipc?.includes(ipc))
      expect(claim, ipc).toHaveProperty('forbidden')
    }
    expect(IPC_CHANNELS.worktreesPanel.remove).toBe('worktrees-panel:remove')
  })

  test('S1: no phone command reaches them', () => {
    for (const command of REMOTE_COMMANDS) expect(/place|worktree|branch/i.test(command), command).toBe(false)
  })

  test('S1: no agent-facing module calls them: MCP tools and RPC, the phone gateway, the agent gateway, the hook server', () => {
    // rigor: source-assertion — reach is structural: no runtime call can prove that no agent path ever calls a method; the
    // call sites in the modules agents drive are the surface.
    const agentFacing = [
      ...sources('electron/main/mcp-internal'),
      ...sources('electron/main/services/remote'),
      ...sources('electron/main/services/agent-hooks'),
      'electron/main/services/oxequery/agent-gateway.ts'
    ]
    expect(agentFacing.length).toBeGreaterThan(10)
    const hits = agentFacing.flatMap(file => {
      const text = readFileSync(join(ROOT, file), 'utf8')
      return PRIVILEGED.flatMap(({ methods }) => methods.filter(method => new RegExp(`\\b${method}\\b`).test(text)).map(method => `${file}: ${method}`))
        .concat(/thread-place-(read|drift)|worktrees-panel/.test(text) ? [`${file}: imports a person-only module`] : [])
    })
    expect(hits).toEqual([])
  })

  test('S1 / S3: the modules that run git or a CLI for these operations never ask for a shell', () => {
    // rigor: source-assertion — "never a shell" is a property of every spawn site, including error paths no test reaches.
    for (const file of ['electron/main/services/pull-request/pr-provider.ts', 'electron/main/services/github/worktrees-panel.ts', 'electron/main/services/conversation/thread-place-drift.ts']) {
      const text = readFileSync(join(ROOT, file), 'utf8')
      expect(text, file).not.toMatch(/shell\s*:\s*true/)
      expect(text, file).not.toMatch(/\bexec(Sync)?\s*\(/)
    }
  })
})
