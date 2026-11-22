// Frozen acceptance test for 1.5.2 HML fixes (Jira OXE-347 part MCP, HML round 2 P0 perf, on f65fa5374). Written by the
// planner; the executor must not edit it. The rest of OXE-347 (login-shell probe, database open, boot order) needs a
// boot profile first (a spike), because the migration checks that run on every open are deliberate self-healing.
// The bug: on ready-to-show, McpConfigSync.syncAll() reads (and, when anything changed, rewrites) Claude Code's
// ~/.claude.json once PER WORKSPACE (approveProjectServersInClaude in the loop); that file grows to megabytes.
// Contract (electron/main/services/mcp-sync.service.ts):
// - syncAll() reads ~/.claude.json at most once and writes it at most once (one atomic tmp + rename), whatever the
//   number of workspaces, and approves every workspace's managed servers in that one write;
// - syncWorkspace(id) keeps its own behaviour (one read, a write only when something changed) and its return value.
import { mkdtempSync, writeFileSync as realWrite, readFileSync as realRead, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase } from '../../../electron/main/db/index'
import { McpManager } from '../../../electron/main/services/mcp.service'
import { McpConfigSync } from '../../../electron/main/services/mcp-sync.service'
import { WorkspaceService } from '../../../electron/main/services/workspace.service'

const home = vi.hoisted(() => ({ dir: '' }))
const fsCalls = vi.hoisted(() => ({ reads: [] as string[], renames: [] as string[] }))
vi.mock('node:os', async original => {
  const actual = await original<typeof import('node:os')>()
  return { ...actual, homedir: () => home.dir || actual.homedir() }
})
vi.mock('node:fs', async original => {
  const actual = await original<typeof import('node:fs')>()
  return {
    ...actual,
    readFileSync: ((path: unknown, ...rest: unknown[]) => { fsCalls.reads.push(String(path)); return (actual.readFileSync as (...a: unknown[]) => unknown)(path, ...rest) }) as typeof actual.readFileSync,
    renameSync: ((from: unknown, to: unknown) => { fsCalls.renames.push(String(to)); return actual.renameSync(from as string, to as string) }) as typeof actual.renameSync
  }
})

const norm = (path: string): string => path.replace(/\\/g, '/').toLowerCase()

afterEach(() => { fsCalls.reads.length = 0; fsCalls.renames.length = 0 })

describe('OXE-347 · Syncing every workspace touches ~/.claude.json once', () => {
  test('syncAll over three workspaces reads and writes Claude Code\'s config once and approves all three', async () => {
    home.dir = mkdtempSync(join(tmpdir(), 'oxe347-home-'))
    const claudeJson = join(home.dir, '.claude.json')
    realWrite(claudeJson, JSON.stringify({ numStartups: 3, projects: {} }), 'utf8')
    const roots = [1, 2, 3].map(index => { const root = join(home.dir, `ws-${index}`); mkdirSync(root); return root })

    const db = openInMemoryDatabase()
    try {
      for (const rootPath of roots) new WorkspaceService(db).create({ rootPath, layoutPreset: 1 })
      new McpManager(db).create({ workspaceId: null, name: 'docs', transport: 'stdio', enabled: true, trusted: true, config: { transport: 'stdio', command: 'node', args: ['docs.cjs'], env: {} } })
      // Fresh state for the measured call: the servers are not yet approved in Claude's config.
      realWrite(claudeJson, JSON.stringify({ numStartups: 3, projects: {} }), 'utf8')
      fsCalls.reads.length = 0; fsCalls.renames.length = 0

      new McpConfigSync(db).syncAll()

      const target = norm(claudeJson)
      expect(fsCalls.reads.filter(path => norm(path) === target), 'reads of ~/.claude.json').toHaveLength(1)
      expect(fsCalls.renames.filter(path => norm(path) === target), 'writes of ~/.claude.json').toHaveLength(1)
      const projects = (JSON.parse(realRead(claudeJson, 'utf8')) as { projects: Record<string, { enabledMcpjsonServers?: string[] }> }).projects
      for (const root of roots) {
        const entry = Object.entries(projects).find(([key]) => norm(key) === norm(root))?.[1]
        expect(entry?.enabledMcpjsonServers ?? [], root).toContain('docs')
      }
    } finally { db.close() }
  })
})
