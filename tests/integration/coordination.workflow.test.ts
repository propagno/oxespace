import { afterEach, describe, expect, test, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { openInMemoryDatabase } from '../../electron/main/db'
import { WorkspaceService } from '../../electron/main/services/workspace.service'
import { ExecutionRegistry } from '../../electron/main/services/execution-registry'
import { DelegationService, type DelegationDependencies } from '../../electron/main/services/delegation.service'
import { collectEvidence } from '../../electron/main/services/coordination/evidence-bundle'
import type { GitHubWorktreeApi } from '../../shared/types/github'
import { DELEGATION_TOOLS } from '../../electron/main/mcp-internal/delegation-tools'
import type { ToolContext } from '../../electron/main/mcp-internal/tool-registry'
const exec = promisify(execFile)
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const fn of cleanup.splice(0)) await fn() })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'oxe-coordination-'))
  const db = openInMemoryDatabase()
  const workspace = new WorkspaceService(db)
  const git = async (cwd: string, ...args: string[]) => (await exec('git', args, { cwd, windowsHide: true })).stdout.trim()
  const roots = []
  for (const name of ['source repo', 'target repo', 'unrelated']) {
    const root = join(directory, name); await mkdir(root)
    await git(root, 'init')
    await writeFile(join(root, 'decision.md'), 'Authentication uses JWT HttpOnly.')
    await git(root, 'add', 'decision.md')
    await git(root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture')
    roots.push(root)
  }
  const a = workspace.create({ rootPath: roots[0], layout: '1x1', autoStart: false })
  const b = workspace.create({ rootPath: roots[1], layout: '1x1', autoStart: false })
  const registry = new ExecutionRegistry()
  registry.register({ paneId: a.panes[0].id, workspaceId: a.id, cwd: roots[0] })
  const origin = registry.forPane(a.panes[0].id)!
  const createWorktree = vi.fn(async (input: { rootPath: string; path: string; branch: string; baseRef?: string; createBranch?: boolean }) => {
    await git(input.rootPath, 'worktree', 'add', ...(input.createBranch ? ['-b', input.branch, input.path, input.baseRef!] : [input.path, input.branch]))
    return {} as never
  })
  const deps: DelegationDependencies = { workspace, executions: registry,
    git: { createWorktree } as unknown as GitHubWorktreeApi, validateAgent: () => {},
    launch: vi.fn(async task => { registry.register({ paneId: task.paneId!, workspaceId: task.workspaceId, cwd: task.path }) }),
    stop: paneId => registry.end(paneId), changed: vi.fn(), enrich: async () => { throw new Error('memory offline') } }
  let service = new DelegationService(db, deps)
  cleanup.push(async () => { await service.stop(); db.close(); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) })
  await service.configure(a.id, true); await service.configure(b.id, true)
  const input = { key: 'request', agentProfileId: 'claude', objective: 'Analyze workflow', handoff: 'Analyze selected evidence', acceptance: 'Return a report', targetWorkspaceId: b.id, evidenceFiles: ['decision.md'], mode: 'analysis' as const }
  return { db, workspace, a, b, registry, origin, roots, input, createWorktree, deps, service, git,
    restart: async () => { await service.stop(); service = new DelegationService(db, deps); return service } }
}
describe('cross-workspace coordination', () => {
  test('explicit route transfers bounded evidence and returns result without memory', async () => {
    const f = await fixture()
    await expect(f.service.create(f.origin, f.input)).rejects.toThrow('CONSENT_REQUIRED')
    await f.service.configureTarget(f.a.id, f.roots[1], true, true)
    expect(await f.service.preflight(f.origin, f.b.id)).toMatchObject({ ready: true, targetWorkspaceId: f.b.id, automaticWakeUp: false })
    expect((await f.service.status(f.a.id)).tasks).toHaveLength(0)
    const context = { delegation: f.service, executions: f.registry, executionId: f.origin.id,
      executionToken: f.origin.token, workspaceId: f.a.id } as unknown as ToolContext
    const discover = await DELEGATION_TOOLS.find(t => t.descriptor.name === 'oxespace_delegation_targets')!.handler({}, context)
    expect(JSON.stringify(discover)).toContain(f.b.id)
    expect(JSON.stringify(discover)).not.toContain(f.origin.token)
    const [task, duplicate] = await Promise.all([f.service.create(f.origin, f.input), f.service.create(f.origin, f.input)])
    expect(duplicate.id).toBe(task.id)
    await vi.waitFor(() => expect(f.service.get(task.id).destinationExecutionId).toBeTruthy(), { timeout: 15000 })
    const running = f.service.get(task.id)
    expect(running.workspaceId).toBe(f.b.id)
    expect(running.originWorkspaceId).toBe(f.a.id)
    expect(f.createWorktree).toHaveBeenCalledTimes(1)
    expect(f.createWorktree.mock.calls[0][0].rootPath).toBe(f.roots[1])
    expect(running.context).toContain('JWT HttpOnly')
    expect(running.evidence?.[0].sha256).toHaveLength(64)
    const child = f.registry.forPane(running.paneId!)!
    await f.service.update(child, task.id, 'accepted', 'Analyzing')
    await f.service.update(child, task.id, 'review', 'Verified report: preserve JWT HttpOnly decision.')
    expect((await f.service.details(f.origin, task.id)).results).toHaveLength(1)
    const result = await DELEGATION_TOOLS.find(t => t.descriptor.name === 'oxespace_delegation_result')!.handler({ taskId: task.id }, context)
    expect(JSON.stringify(result)).toContain('Verified report')
    expect(JSON.stringify(result)).not.toContain(f.origin.token)
    expect((await f.service.inbox(f.origin)).some(e => e.kind === 'review')).toBe(true)
    const inbox = await f.service.inbox(f.origin)
    f.service.coordinator.acknowledge(running, f.origin, inbox.at(-1)!.cursor)
    expect(await f.service.inbox(f.origin)).toEqual([])
    expect((await f.service.inbox(child)).length).toBeGreaterThan(0)
    expect((await f.service.inbox(f.origin, 0)).length).toBeGreaterThan(0)
    expect((await f.service.status(f.a.id)).tasks).toHaveLength(1)
    expect((await f.service.status(f.b.id)).tasks).toHaveLength(1)
    await expect(f.service.create(f.origin, { ...f.input, objective: 'Different' })).rejects.toThrow('different input')
  }, 30000)
  test('revoke blocks delivery and retry; new session needs explicit adoption', async () => {
    const f = await fixture()
    await f.service.configureTarget(f.a.id, f.roots[1], true, true)
    const task = await f.service.create(f.origin, f.input)
    await vi.waitFor(() => expect(f.service.get(task.id).destinationExecutionId).toBeTruthy(), { timeout: 15000 })
    const service = await f.restart()
    f.registry.register({ paneId: 'replacement-origin-pane', workspaceId: f.a.id, cwd: f.roots[0] })
    const resumed = f.registry.forPane('replacement-origin-pane')!
    await expect(service.authorize(resumed, task.id)).rejects.toThrow()
    await service.adopt(f.a.id, task.id, resumed.paneId)
    await expect(service.authorize(resumed, task.id)).resolves.toMatchObject({ id: task.id })
    await expect(service.create(resumed, f.input)).resolves.toMatchObject({ id: task.id })
    await service.configureTarget(f.a.id, f.roots[1], false, false)
    await expect(service.authorize(resumed, task.id)).rejects.toThrow('CONSENT_REQUIRED')
    await expect(service.control(f.a.id, task.id, 'retry')).rejects.toThrow('CONSENT_REQUIRED')
    expect(f.createWorktree).toHaveBeenCalledTimes(1)
  }, 30000)
  test('registers local repository only via trusted consent and rejects unrelated execution', async () => {
    const f = await fixture()
    await f.service.configureTarget(f.a.id, f.roots[2], true, false)
    expect(f.workspace.list()).toHaveLength(3)
    await f.service.configureTarget(f.a.id, f.roots[2], true, false)
    expect(f.workspace.list()).toHaveLength(3)
    await f.service.configureTarget(f.a.id, f.roots[1], true, false)
    await expect(f.service.create(f.origin, f.input)).rejects.toThrow('CONSENT_REQUIRED')
    const task = await f.service.create(f.origin, { ...f.input, evidenceFiles: [] })
    f.registry.register({ paneId: 'third', workspaceId: f.a.id, cwd: f.roots[2] })
    await expect(f.service.authorize(f.registry.forPane('third')!, task.id)).rejects.toThrow('scope')
  }, 30000)
  test('revocation during enrichment prevents launch; retry uses the preserved worktree', async () => {
    const f = await fixture()
    await f.service.configureTarget(f.a.id, f.roots[1], true, true)
    let release!: () => void
    let entered = false
    f.deps.enrich = async () => { entered = true; await new Promise<void>(resolve => { release = resolve }); return '' }
    const task = await f.service.create(f.origin, f.input)
    await vi.waitFor(() => expect(entered).toBe(true), { timeout: 15000 })
    await f.service.configureTarget(f.a.id, f.roots[1], false, false)
    release()
    await vi.waitFor(() => expect(f.service.get(task.id).state).toBe('failed'), { timeout: 10000 })
    expect(f.deps.launch).not.toHaveBeenCalled()
    await f.service.configureTarget(f.a.id, f.roots[1], true, true)
    f.deps.enrich = async () => ''
    await f.service.control(f.a.id, task.id, 'retry')
    await vi.waitFor(() => expect(f.service.get(task.id).destinationExecutionId).toBeTruthy(), { timeout: 15000 })
    expect(f.createWorktree).toHaveBeenCalledTimes(1)
  }, 45000)
  test('concurrent agents keep independent result histories and cancellation cannot be overwritten', async () => {
    const f = await fixture()
    await f.service.configureTarget(f.a.id, f.roots[1], true, true)
    const [a, b] = await Promise.all([f.service.create(f.origin, f.input), f.service.create(f.origin, { ...f.input, key: 'second', agentProfileId: 'codex' })])
    await vi.waitFor(() => expect([a, b].every(t => f.service.get(t.id).destinationExecutionId)).toBe(true), { timeout: 20000 })
    const childA = f.registry.forPane(f.service.get(a.id).paneId!)!
    const childB = f.registry.forPane(f.service.get(b.id).paneId!)!
    await Promise.all([f.service.update(childA, a.id, 'review', 'Claude result'), f.service.update(childB, b.id, 'review', 'Codex result')])
    expect((await f.service.details(f.origin, a.id)).results).toEqual([expect.objectContaining({ text: 'Claude result', revision: 1 })])
    expect((await f.service.details(f.origin, b.id)).results).toEqual([expect.objectContaining({ text: 'Codex result', revision: 1 })])
    await expect(f.service.authorize(childA, b.id)).rejects.toThrow()
    await f.service.control(f.a.id, a.id, 'cancel')
    await expect(f.service.update(childA, a.id, 'accepted', 'Late report')).rejects.toThrow()
    expect(f.service.get(a.id).state).toBe('cancelled')
  }, 45000)
  test('evidence excludes dirty contents, traversal and oversized content', async () => {
    const f = await fixture()
    await writeFile(join(f.roots[0], 'decision.md'), 'dirty secret not shared')
    expect((await collectEvidence(f.roots[0], ['decision.md']))[0].text).toContain('JWT HttpOnly')
    await expect(collectEvidence(f.roots[0], ['../target repo/decision.md'])).rejects.toThrow('path')
    await expect(collectEvidence(f.roots[0], ['.env'])).rejects.toThrow('path')
    await writeFile(join(f.roots[0], 'large.txt'), 'a'.repeat(65000))
    await f.git(f.roots[0], 'add', 'large.txt')
    await f.git(f.roots[0], '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'large')
    await expect(collectEvidence(f.roots[0], ['large.txt'])).rejects.toThrow('limits')
  }, 30000)
})
