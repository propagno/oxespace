import { mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { FileSystemService } from '../../electron/main/services/file-system.service'
import { ThreadPermissionStore } from '../../electron/main/services/conversation/thread-permissions'
import { MCP_TOOL_GROUPS } from '../../electron/main/services/conversation/thread-mcp'
import { McpConfigSync } from '../../electron/main/services/mcp-sync.service'
import { setToolGroupMode, toolGroupsReport } from '../../electron/main/services/mcp-tool-groups'
import { estimateTokens } from '../../shared/types/mcp-tools'
import { removeTempDir } from '../helpers/removeTempDir'

// The .mcp.json sync also approves its servers in ~/.claude.json and Copilot's config: never the real ones here.
vi.mock('node:os', async original => {
  const os = await original<typeof import('node:os')>()
  const { mkdtempSync: make } = await import('node:fs')
  const path = await import('node:path')
  const home = make(path.join(os.tmpdir(), 'oxe-tool-groups-home-'))
  return { ...os, homedir: () => home }
})
vi.mock('../../electron/main/vendor/codegraph/mcp/tools', () => ({ ToolHandler: class { execute = vi.fn() } }))

const roots: string[] = []
const databases: AppDatabase[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
  for (const root of roots.splice(0)) removeTempDir(root)
})

function project() {
  const root = mkdtempSync(join(tmpdir(), 'oxe-tool-groups-')); roots.push(root)
  const db = openInMemoryDatabase(); databases.push(db)
  db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('A', 'A', ?, '1x1', 'builtin-claude')").run(root)
  const files = new FileSystemService((workspaceId, requested) => {
    const row = db.prepare('SELECT root_path FROM workspaces WHERE id = ?').get(workspaceId) as { root_path: string } | undefined
    return row && row.root_path === requested ? row.root_path : null
  })
  return { root, db, files }
}

/** The internal OXESpace server, as bootstrap registers it: global, trusted, the bridge with no arguments of its own. */
function withInternalServer(db: AppDatabase) {
  db.prepare(`INSERT INTO mcp_servers (id, workspace_id, name, transport, config_json, enabled, trusted, created_at, updated_at)
    VALUES ('internal', NULL, 'oxespace', 'stdio', ?, 1, 1, 0, 0)`).run(JSON.stringify({ transport: 'stdio', command: 'node', args: ['/bin/oxespace-mcp.cjs'], env: {} }))
}
const internalArgs = (root: string) => (JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf8')) as { mcpServers: Record<string, { args: string[] }> }).mcpServers.oxespace.args
const allowedOf = (args: string[]) => args.includes('--allowed-tools') ? JSON.parse(args[args.indexOf('--allowed-tools') + 1]) as string[] : null

describe('Settings › Tools (F10)', () => {
  it('reports every group with its default mode and what it costs', async () => {
    const report = await toolGroupsReport(null)
    expect(report.rootPath).toBeNull()
    expect(report.oxeYaml).toBe('missing')
    expect(report.groups.map(group => [group.id, group.mode, group.source, group.configurable])).toEqual([
      ['core', 'always', 'default', false], ['orchestration', 'on-demand', 'default', true], ['data', 'on-demand', 'default', true],
      ['docs', 'on-demand', 'default', true], ['app', 'on-demand', 'default', true], ['team', 'always', 'role', false], ['worker', 'always', 'role', false], ['code', 'always', 'role', false]
    ])
    for (const group of report.groups) {
      expect(group.cost.claude.loaded.chars, group.id).toBeGreaterThan(0)
      expect(group.cost.claude.deferred.chars, group.id).toBeLessThan(group.cost.claude.loaded.chars)
      expect(group.cost.claude.loaded.tokens).toBe(estimateTokens(group.cost.claude.loaded.chars))
      expect(group.cost.codex.loaded).toEqual(group.cost.claude.loaded)
    }
    expect(report.totals.plainConversation.chars).toBeLessThan(report.totals.everythingOnDemand.chars + 1)
    // A plain conversation stays within today's budget.
    expect(report.groups[0].cost.claude.loaded.chars).toBeLessThanOrEqual(9000)
  })

  it('creates oxe.yaml when the project has none, records the change and reports it', async () => {
    const { root, db, files } = project()
    const report = await setToolGroupMode(db, files, { rootPath: root, group: 'data', mode: 'off' })
    expect(readFileSync(join(root, 'oxe.yaml'), 'utf8')).toBe('thread:\n  tools:\n    data: off\n')
    expect(report.oxeYaml).toBe('valid')
    expect(report.groups.find(group => group.id === 'data')).toMatchObject({ mode: 'off', source: 'project' })
    expect(report.totals.plainConversation.chars).toBeLessThan((await toolGroupsReport(null)).totals.plainConversation.chars)
    expect(new ThreadPermissionStore(db).auditLog({ projectRoot: root })).toEqual([expect.objectContaining({ action: 'configuration', actor: 'user', summary: 'Set the data tool group to off' })])
    // Replaced through a temporary file in the same folder, which is gone afterwards.
    expect(readdirSync(root).filter(name => name.endsWith('.tmp'))).toEqual([])
  })

  it('edits an existing oxe.yaml and keeps the rest as written', async () => {
    const { root, db, files } = project()
    writeFileSync(join(root, 'oxe.yaml'), '# team settings\nscripts:\n  setup: npm ci\nthread:\n  tools: [docs]\n')
    const report = await setToolGroupMode(db, files, { rootPath: root, group: 'app', mode: 'always' })
    expect(readFileSync(join(root, 'oxe.yaml'), 'utf8')).toBe('# team settings\nscripts:\n  setup: npm ci\nthread:\n  tools:\n    docs: always\n    app: always\n')
    expect(report.groups.filter(group => group.source === 'project').map(group => [group.id, group.mode])).toEqual([['docs', 'always'], ['app', 'always']])
  })

  it('refuses a folder OXESpace does not know and a layout it cannot edit, with a code, writing nothing', async () => {
    const { root, db, files } = project()
    const stranger = mkdtempSync(join(tmpdir(), 'oxe-stranger-')); roots.push(stranger)
    await expect(setToolGroupMode(db, files, { rootPath: stranger, group: 'data', mode: 'off' })).rejects.toThrow('mcp.toolGroups.unknownProject')
    expect(() => readFileSync(join(stranger, 'oxe.yaml'))).toThrow()
    writeFileSync(join(root, 'oxe.yaml'), 'thread: { brief: true }\n')
    await expect(setToolGroupMode(db, files, { rootPath: root, group: 'data', mode: 'off' })).rejects.toThrow('mcp.toolGroups.inlineThread')
    expect(readFileSync(join(root, 'oxe.yaml'), 'utf8')).toBe('thread: { brief: true }\n')
    expect(new ThreadPermissionStore(db).auditLog({ projectRoot: root })).toEqual([])
  })

  it('reports an invalid oxe.yaml as invalid, not as defaults, and refuses to edit it', async () => {
    const { root, db, files } = project()
    const broken = 'thread:\n  tools: [data\n'
    writeFileSync(join(root, 'oxe.yaml'), broken)
    const report = await toolGroupsReport(root)
    expect(report.oxeYaml).toBe('invalid')
    expect(report.groups.filter(group => group.configurable).every(group => group.source === 'default')).toBe(true)
    await expect(setToolGroupMode(db, files, { rootPath: root, group: 'data', mode: 'off' })).rejects.toThrow('mcp.toolGroups.invalidYaml')
    expect(readFileSync(join(root, 'oxe.yaml'), 'utf8')).toBe(broken)
    expect(new ThreadPermissionStore(db).auditLog({ projectRoot: root })).toEqual([])
    // An empty or comments-only file is valid and sets nothing.
    writeFileSync(join(root, 'oxe.yaml'), '# nothing yet\n')
    expect((await toolGroupsReport(root)).oxeYaml).toBe('valid')
  })
})

describe('replacing a project file atomically (FileSystemService.replaceFile)', () => {
  it('refuses, writing nothing, when the file changed or appeared since it was read', async () => {
    const { root, files } = project()
    const target = { workspaceId: 'A', rootPath: root, relativePath: 'oxe.yaml' }
    writeFileSync(join(root, 'oxe.yaml'), 'a: 1\n')
    const read = await files.readFile(target)
    // Another editor saves meanwhile.
    writeFileSync(join(root, 'oxe.yaml'), 'a: 2\n')
    utimesSync(join(root, 'oxe.yaml'), new Date(), new Date(read.mtimeMs + 5000))
    await expect(files.replaceFile({ ...target, content: 'a: 3\n', expectedMtimeMs: read.mtimeMs })).rejects.toThrow('project.file.changedMeanwhile')
    expect(readFileSync(join(root, 'oxe.yaml'), 'utf8')).toBe('a: 2\n')
    // A file expected to be missing that exists now is not replaced either.
    await expect(files.replaceFile({ ...target, content: 'a: 3\n', expectedMtimeMs: null })).rejects.toThrow('project.file.changedMeanwhile')
    expect(readdirSync(root).filter(name => name.endsWith('.tmp'))).toEqual([])
    // Unchanged since read: replaced.
    const fresh = await files.readFile(target)
    await files.replaceFile({ ...target, content: 'a: 4\n', expectedMtimeMs: fresh.mtimeMs })
    expect(readFileSync(join(root, 'oxe.yaml'), 'utf8')).toBe('a: 4\n')
  })

  it('stays inside the registered root', async () => {
    const { root, files } = project()
    await expect(files.replaceFile({ workspaceId: 'A', rootPath: root, relativePath: '../outside.yaml', content: 'x', expectedMtimeMs: null })).rejects.toThrow()
    await expect(files.replaceFile({ workspaceId: 'B', rootPath: root, relativePath: 'oxe.yaml', content: 'x', expectedMtimeMs: null })).rejects.toThrow()
  })
})

describe('the workspace .mcp.json follows the project\'s tool groups (B7.2, M1 of #210)', () => {
  it('leaves the internal entry as it was while no group is off', () => {
    const { root, db } = project()
    withInternalServer(db)
    new McpConfigSync(db).syncWorkspace('A')
    expect(internalArgs(root)).toEqual(['/bin/oxespace-mcp.cjs'])
  })

  it('offers every tool but those of a group the project turned off, roles included', () => {
    const { root, db } = project()
    withInternalServer(db)
    writeFileSync(join(root, 'oxe.yaml'), 'thread:\n  tools:\n    data: off\n')
    new McpConfigSync(db).syncWorkspace('A')
    const allowed = allowedOf(internalArgs(root))!
    for (const tool of MCP_TOOL_GROUPS.data) expect(allowed, tool).not.toContain(tool)
    for (const group of ['core', 'orchestration', 'docs', 'app', 'team', 'worker', 'code'] as const) expect(allowed).toEqual(expect.arrayContaining([...MCP_TOOL_GROUPS[group]]))
  })

  it('rewrites the entry when Settings › Tools changes a mode', async () => {
    const { root, db, files } = project()
    withInternalServer(db)
    new McpConfigSync(db).syncWorkspace('A')
    await setToolGroupMode(db, files, { rootPath: root, group: 'docs', mode: 'off' })
    expect(allowedOf(internalArgs(root))).not.toContain('oxespace_open_web_preview')
    await setToolGroupMode(db, files, { rootPath: root, group: 'docs', mode: 'always' })
    expect(internalArgs(root)).toEqual(['/bin/oxespace-mcp.cjs'])
  })
})
