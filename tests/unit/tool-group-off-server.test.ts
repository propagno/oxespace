// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const incidents: Array<[string, string | undefined]> = []
vi.mock('../../electron/main/services/diagnostics/incident-sink', () => ({ recordIncident: (code: string, subject?: string) => { incidents.push([code, subject]) } }))
vi.mock('../../electron/main/services/policy', () => ({ policyStore: () => null }))
vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), isPackaged: false } }))

const { offGroupBlocking, toolCallBlocked } = await import('../../electron/main/mcp-internal/tool-policy')
const { projectToolModes } = await import('../../electron/main/services/conversation/tool-groups')
const { MCP_TOOL_GROUPS } = await import('../../electron/main/services/conversation/thread-mcp')

const off = (...groups: string[]) => projectToolModes({ toolModes: Object.fromEntries(groups.map(group => [group, 'off'])) } as never)
const DATA_TOOL = MCP_TOOL_GROUPS.data[0]
const CORE_TOOL = MCP_TOOL_GROUPS.core[0]

const folders: string[] = []
afterAll(() => { for (const folder of folders) rmSync(folder, { recursive: true, force: true }) })
beforeEach(() => { incidents.length = 0 })

/** A caller: authenticated (a live execution whose folder is `cwd`) or not, with the registered projects. */
function ctx(options: { execution?: { cwd: string; workspaceId: string }; workspaces?: string[] } = {}) {
  return {
    executionId: options.execution ? 'e1' : undefined, executionToken: options.execution ? 't' : undefined, workspaceId: options.execution?.workspaceId ?? null,
    executions: { authenticate: () => { if (!options.execution) throw new Error('no'); return options.execution } },
    workspaceServ: {
      get: (id: string) => id === 'w1' ? { rootPath: options.execution?.cwd ?? '' } : undefined,
      list: () => (options.workspaces ?? []).map(rootPath => ({ rootPath }))
    },
    db: { prepare: () => ({ all: () => [] }) }
  } as never
}

describe('a tool group the project turned off is refused at tools/call, whatever the bridge was told (#357 case 9)', () => {
  it('blocks a tool only when every configurable group it belongs to is off, and never core', () => {
    expect(offGroupBlocking(DATA_TOOL, ['/p'], () => off('data'))).toBe('data')
    expect(offGroupBlocking(DATA_TOOL, ['/p'], () => off())).toBeUndefined()
    expect(offGroupBlocking(DATA_TOOL, ['/p'], () => off('docs', 'app'))).toBeUndefined()
    expect(offGroupBlocking(CORE_TOOL, ['/p'], () => off('orchestration', 'data', 'docs', 'app'))).toBeUndefined()
    // Not an OXESpace group tool at all (the enable switch, an unknown name): not this rule's business.
    expect(offGroupBlocking('oxespace_tools_enable', ['/p'], () => off('data'))).toBeUndefined()
  })

  it('judges an authenticated caller by its own execution\'s roots, never by another project', () => {
    const modes = (root: string) => root === '/mine' ? off() : off('data')
    expect(toolCallBlocked(DATA_TOOL, ctx({ execution: { cwd: '/mine', workspaceId: 'w1' }, workspaces: ['/mine', '/other'] }), null, modes)).toBeUndefined()
    const refused = toolCallBlocked(DATA_TOOL, ctx({ execution: { cwd: '/other', workspaceId: 'w1' } }), null, modes)
    expect(refused).toContain('"data" tools are turned off')
    expect(refused).toContain('incident.mcp.toolGroupOff')
    expect(incidents).toEqual([['incident.mcp.toolGroupOff', `data:${DATA_TOOL}`]])
  })

  it('holds the strictest project for a caller that proves no execution', () => {
    const modes = (root: string) => root === '/strict' ? off('data') : off()
    expect(toolCallBlocked(DATA_TOOL, ctx({ workspaces: ['/open', '/strict'] }), null, modes)).toContain('turned off')
  })

  it('reads the real oxe.yaml from the caller\'s folder, and again when it changes', () => {
    const root = mkdtempSync(join(tmpdir(), 'oxe-off-group-')); folders.push(root)
    const caller = ctx({ execution: { cwd: root, workspaceId: 'w1' } })
    expect(toolCallBlocked(DATA_TOOL, caller, null)).toBeUndefined()
    writeFileSync(join(root, 'oxe.yaml'), 'thread:\n  tools:\n    data: off\n')
    expect(toolCallBlocked(DATA_TOOL, caller, null)).toContain('turned off')
    writeFileSync(join(root, 'oxe.yaml'), 'thread:\n  tools:\n    data: always\n')
    expect(toolCallBlocked(DATA_TOOL, caller, null)).toBeUndefined()
  })

  it('fails closed: deleting, breaking or bloating oxe.yaml never lifts an off read earlier in this run', () => {
    const root = mkdtempSync(join(tmpdir(), 'oxe-off-closed-')); folders.push(root)
    const caller = ctx({ execution: { cwd: root, workspaceId: 'w1' } })
    const file = join(root, 'oxe.yaml')
    writeFileSync(file, 'thread:\n  tools:\n    data: off\n')
    expect(toolCallBlocked(DATA_TOOL, caller, null)).toContain('turned off')
    rmSync(file)
    expect(toolCallBlocked(DATA_TOOL, caller, null)).toContain('turned off')
    writeFileSync(file, 'thread: [unclosed\n')
    expect(toolCallBlocked(DATA_TOOL, caller, null)).toContain('turned off')
    writeFileSync(file, `# ${'x'.repeat(300 * 1024)}\n`)
    expect(toolCallBlocked(DATA_TOOL, caller, null)).toContain('turned off')
    // A valid file is what changes the modes; B7.4 asks the person before such a widening applies.
    writeFileSync(file, 'thread:\n  tools:\n    data: on-demand\n')
    expect(toolCallBlocked(DATA_TOOL, caller, null)).toBeUndefined()
  })

  it('keeps an off when a valid rewrite drops or misspells the group, and lets a stated mode through', () => {
    const root = mkdtempSync(join(tmpdir(), 'oxe-off-rewrite-')); folders.push(root)
    const caller = ctx({ execution: { cwd: root, workspaceId: 'w1' } })
    const file = join(root, 'oxe.yaml')
    writeFileSync(file, 'thread:\n  tools:\n    data: off\n')
    expect(toolCallBlocked(DATA_TOOL, caller, null)).toContain('turned off')
    writeFileSync(file, 'x: 1\n')
    expect(toolCallBlocked(DATA_TOOL, caller, null)).toContain('turned off')
    writeFileSync(file, 'thread:\n  tools:\n    data: offf\n')
    expect(toolCallBlocked(DATA_TOOL, caller, null)).toContain('turned off')
    // One folder spelled another way shares the same memory.
    expect(toolCallBlocked(DATA_TOOL, ctx({ execution: { cwd: `${root}${sep}.${sep}`, workspaceId: 'w1' } }), null)).toContain('turned off')
  })

  it('exempts the tools a role group shares only for a caller that holds the role', () => {
    const shared = MCP_TOOL_GROUPS.worker.find(tool => (MCP_TOOL_GROUPS.orchestration as readonly string[]).includes(tool))
    if (!shared) return
    const modes = () => off('orchestration')
    const withRole = (worker: boolean) => ({ ...(ctx({ execution: { cwd: '/p', workspaceId: 'w1', owner: { kind: 'thread', id: 't1' } } as never }) as object),
      db: { prepare: (sql: string) => ({ all: () => [], get: () => (worker && sql.includes('work_runs') ? { 1: 1 } : undefined) }) } }) as never
    expect(toolCallBlocked(shared, withRole(false), null, modes)).toContain('turned off')
    expect(toolCallBlocked(shared, withRole(true), null, modes)).toBeUndefined()
  })

  it.skipIf(process.platform === 'win32')('never reads an oxe.yaml that is not a regular file (a FIFO would block)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'oxe-off-fifo-')); folders.push(root)
    const { execFileSync } = await import('node:child_process')
    execFileSync('mkfifo', [join(root, 'oxe.yaml')])
    const { loadRepoConfigSync } = await import('../../electron/main/services/repo-config/loader')
    expect(loadRepoConfigSync(root)).toBeNull()
  })

  it('uses the defaults for a root never read from a valid file', () => {
    const root = mkdtempSync(join(tmpdir(), 'oxe-off-never-')); folders.push(root)
    writeFileSync(join(root, 'oxe.yaml'), 'thread: [unclosed\n')
    expect(toolCallBlocked(DATA_TOOL, ctx({ execution: { cwd: root, workspaceId: 'w1' } }), null)).toBeUndefined()
  })
})
