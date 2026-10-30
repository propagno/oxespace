import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { FileSystemService } from '../../electron/main/services/file-system.service'
import { ThreadPermissionStore } from '../../electron/main/services/conversation/thread-permissions'
import { setToolGroupMode, toolGroupsReport } from '../../electron/main/services/mcp-tool-groups'
import { removeTempDir } from '../helpers/removeTempDir'

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

describe('Settings › Tools (F10)', () => {
  it('reports every group with its default mode and what it costs', async () => {
    const report = await toolGroupsReport(null)
    expect(report.rootPath).toBeNull()
    expect(report.groups.map(group => [group.id, group.mode, group.source, group.configurable])).toEqual([
      ['core', 'always', 'default', false], ['orchestration', 'on-demand', 'default', true], ['data', 'on-demand', 'default', true],
      ['docs', 'on-demand', 'default', true], ['app', 'on-demand', 'default', true], ['team', 'always', 'role', false], ['worker', 'always', 'role', false]
    ])
    for (const group of report.groups) {
      expect(group.cost.claude.loaded.chars, group.id).toBeGreaterThan(0)
      expect(group.cost.claude.deferred.chars, group.id).toBeLessThan(group.cost.claude.loaded.chars)
      expect(group.cost.claude.loaded.tokens).toBe(Math.ceil(group.cost.claude.loaded.chars / 4))
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
    expect(report.groups.find(group => group.id === 'data')).toMatchObject({ mode: 'off', source: 'project' })
    expect(report.totals.plainConversation.chars).toBeLessThan((await toolGroupsReport(null)).totals.plainConversation.chars)
    expect(new ThreadPermissionStore(db).auditLog({ projectRoot: root })).toEqual([expect.objectContaining({ action: 'configuration', actor: 'user', summary: 'Set the data tool group to off' })])
  })

  it('edits an existing oxe.yaml and keeps the rest as written', async () => {
    const { root, db, files } = project()
    writeFileSync(join(root, 'oxe.yaml'), '# team settings\nscripts:\n  setup: npm ci\nthread:\n  tools: [docs]\n')
    const report = await setToolGroupMode(db, files, { rootPath: root, group: 'app', mode: 'always' })
    expect(readFileSync(join(root, 'oxe.yaml'), 'utf8')).toBe('# team settings\nscripts:\n  setup: npm ci\nthread:\n  tools:\n    docs: always\n    app: always\n')
    expect(report.groups.filter(group => group.source === 'project').map(group => [group.id, group.mode])).toEqual([['docs', 'always'], ['app', 'always']])
  })

  it('refuses a folder OXESpace does not know and a layout it cannot edit, writing nothing', async () => {
    const { root, db, files } = project()
    const stranger = mkdtempSync(join(tmpdir(), 'oxe-stranger-')); roots.push(stranger)
    await expect(setToolGroupMode(db, files, { rootPath: stranger, group: 'data', mode: 'off' })).rejects.toThrow('not a project')
    expect(() => readFileSync(join(stranger, 'oxe.yaml'))).toThrow()
    writeFileSync(join(root, 'oxe.yaml'), 'thread: { brief: true }\n')
    await expect(setToolGroupMode(db, files, { rootPath: root, group: 'data', mode: 'off' })).rejects.toThrow('by hand')
    expect(readFileSync(join(root, 'oxe.yaml'), 'utf8')).toBe('thread: { brief: true }\n')
    expect(new ThreadPermissionStore(db).auditLog({ projectRoot: root })).toEqual([])
  })
})
