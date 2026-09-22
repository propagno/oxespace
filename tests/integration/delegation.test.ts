import { afterEach, describe, expect, test, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { openInMemoryDatabase } from '../../electron/main/db'
import { WorkspaceService } from '../../electron/main/services/workspace.service'
import { ExecutionRegistry } from '../../electron/main/services/execution-registry'
import { DelegationService, type DelegationDependencies } from '../../electron/main/services/delegation.service'
import { agentMcpArguments, AgentLaunchService } from '../../electron/main/services/agent-launch.service'
import type { TerminalManager } from '../../electron/main/services/terminal.service'
import type { GitHubWorktreeApi } from '../../shared/types/github'

const exec = promisify(execFile)
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const fn of cleanup.splice(0)) await fn() })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(),'oxe-delegation-'))
  const root = join(directory,'repo'); await mkdir(root)
  const git = async (...args: string[]) => (await exec('git',args,{ cwd:root,windowsHide:true })).stdout.trim()
  await git('init'); await git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','--allow-empty','-m','initial')
  const db = openInMemoryDatabase(); const workspace = new WorkspaceService(db)
  const ws = workspace.create({ rootPath:root, layout:'1x1',autoStart:false })
  const executions = new ExecutionRegistry()
  executions.register({ paneId:ws.panes[0].id,workspaceId:ws.id,cwd:root })
  const origin = executions.forPane(ws.panes[0].id)!
  const launch = vi.fn(async (t: { paneId?: string; workspaceId:string; path:string }) => { executions.register({ paneId:t.paneId!, workspaceId:t.workspaceId, cwd:t.path }) })
  const createWorktree = vi.fn(async (i: { path:string;branch:string;createBranch?:boolean;baseRef?:string }) => {
    await git('worktree','add',...(i.createBranch ? ['-b',i.branch,i.path,i.baseRef!] : [i.path,i.branch])); return {} as never
  })
  const deps: DelegationDependencies = { workspace, executions, git: { createWorktree } as unknown as GitHubWorktreeApi,
    launch, validateAgent: () => {}, stop: pane => executions.end(pane), changed: vi.fn(), enrich: async () => { throw new Error('AI Memory unavailable') } }
  const service = new DelegationService(db,deps)
  cleanup.push(async () => { await service.stop(); db.close(); await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100}) })
  await service.configure(ws.id,true)
  const input = {key:'task-A',agentProfileId:'codex',objective:'Fix auth',handoff:'Authentication uses JWT HttpOnly.',acceptance:'Authentication tests pass'}
  return {db, root,git,workspace,ws,executions,origin,launch,createWorktree,service,input,deps}
}
describe('delegation lifecycle', () => {
  test('captures multiple selected public conversations and keeps their snapshot after restart', async () => {
    const f = await fixture()
    f.deps.enrich = async task => ({ memory: task.includeMemory ? 'AI_MEMORY_MARKER' : '', code: 'CODE_CONTEXT_MARKER' })
    const foreignId = randomUUID()
    f.db.prepare('INSERT INTO conversation_threads (id, workspace_id, data_json, events_json) VALUES (?, ?, ?, ?)')
      .run(foreignId, f.ws.id, JSON.stringify({ id: foreignId, workspaceId: f.ws.id, projectId: 'foreign', rootPath: join(f.root, '..'),
        provider: 'codex', nativeSessionId: null, title: 'Foreign source', pinned: false, status: 'idle', createdAt: 1, updatedAt: 1 }), '[]')
    await expect(f.service.create(f.origin, { ...f.input, sourceThreadIds: [foreignId] })).rejects.toThrow('another project')
    const ids = [randomUUID(), randomUUID()]
    for (const [index, id] of ids.entries()) {
      const thread = { id, workspaceId: f.ws.id, projectId: 'project', rootPath: f.root,
        provider: index ? 'claude' : 'codex', nativeSessionId: null, title: `Source ${index + 1}`,
        pinned: false, status: 'idle', createdAt: 1, updatedAt: 1 }
      const events = [
        { type: 'message', id: randomUUID(), role: 'user', text: `Public request ${index + 1}` },
        { type: 'tool', id: randomUUID(), name: 'command', state: 'completed', detail: 'PRIVATE_TOOL_OUTPUT' },
        { type: 'message', id: randomUUID(), role: 'assistant', text: `Public decision ${index + 1}` }
      ]
      f.db.prepare('INSERT INTO conversation_threads (id, workspace_id, data_json, events_json) VALUES (?, ?, ?, ?)')
        .run(id, f.ws.id, JSON.stringify(thread), JSON.stringify(events))
    }
    const created = await f.service.create(f.origin, { ...f.input, sourceThreadIds: ids, includeMemory: true })
    expect(created.sessionContext).toHaveLength(2)
    await vi.waitFor(() => expect(f.service.get(created.id).knowledgeBundle).toBeTruthy(), { timeout: 10000 })
    const context = f.service.get(created.id).knowledgeBundle!.context
    expect(context).toContain('Public request 1')
    expect(context).toContain('Public decision 2')
    expect(context).toContain('AI_MEMORY_MARKER')
    expect(context).toContain('CODE_CONTEXT_MARKER')
    expect(context).not.toContain('PRIVATE_TOOL_OUTPUT')
    await f.service.stop()
    const restarted = new DelegationService(f.db, f.deps)
    expect(restarted.get(created.id).sessionContext?.map(source => source.threadId)).toEqual(ids)
    expect(restarted.get(created.id).knowledgeBundle?.context).toBe(context)
    await restarted.stop()
  }, 20000)

  test('renderer creation uses its owned execution and preserves the preview branch and path', async () => {
    const f = await fixture()
    const intent = { strategy: 'generated' as const, template: 'feature/{reference}-{shortId}', reference: 'CARD-142' }
    const preview = await f.service.preview(f.ws.id, f.input.objective, intent)
    const created = await f.service.createFromSurface(f.ws.id, { kind: 'pane', id: f.origin.paneId }, { ...f.input, branchIntent: intent, previewId: preview.previewId })
    expect(created.branch).toBe(preview.checkout.branch)
    expect(created.path).toBe(preview.checkout.path)
    await expect(f.service.createFromSurface(f.ws.id, { kind: 'pane', id: 'unrelated' }, f.input)).rejects.toThrow('another workspace')
    await f.service.stop()
  }, 20000)

  test('concurrent unique requests cannot exceed the project limit after Git preflight yields', async () => {
    const f = await fixture()
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, index) => f.service.create(f.origin, { ...f.input, key: `parallel-${index}` })))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(4)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(2)
    await f.service.stop()
  }, 30000)

  test('never reuses the origin or main checkout even with explicit worktree reuse', async () => {
    const f = await fixture()
    const branch = await f.git('branch', '--show-current')
    await expect(f.service.preview(f.ws.id, 'Parallel task', { strategy: 'existing', name: branch, reuseExistingWorktree: true })).rejects.toThrow('DESTINATION_MUST_BE_ISOLATED')
    expect(f.createWorktree).not.toHaveBeenCalled()
  }, 15000)
  test('retry recreates a closed destination pane without replacing its worktree or handoff', async () => {
    const f = await fixture(); f.launch.mockRejectedValueOnce(new Error('Missing agent executable'))
    const task = await f.service.create(f.origin, f.input)
    await vi.waitFor(() => expect(f.service.get(task.id).state).toBe('failed'), {timeout:10000})
    const old = f.service.get(task.id)
    f.workspace.closePane(old.paneId!)
    await f.service.control(f.ws.id, task.id, 'retry')
    await vi.waitFor(() => expect(f.service.get(task.id).destinationExecutionId).toBeTruthy(), {timeout:10000})
    const retried = f.service.get(task.id)
    expect(retried.paneId).not.toBe(old.paneId)
    expect(f.workspace.get(f.ws.id)?.panes.some(p => p.id === retried.paneId)).toBe(true)
    expect(retried.path).toBe(old.path)
    expect(retried.context).toBe(old.context)
    expect(f.createWorktree).toHaveBeenCalledTimes(1)
  }, 20000)
  test('cancellation during provisioning never launches and keeps the created checkout', async () => {
    const f = await fixture()
    let release!: () => void
    let began = false
    f.deps.enrich = async () => { began = true; await new Promise<void>(resolve => { release = resolve }); return '' }
    const a = await f.service.create(f.origin, f.input)
    await vi.waitFor(() => expect(began).toBe(true), { timeout: 10000 })
    await f.service.control(f.ws.id, a.id, 'cancel')
    release()
    await f.service.stop()
    expect(f.launch).not.toHaveBeenCalled()
    expect(f.service.get(a.id).state).toBe('cancelled')
    expect(await readFile(join(f.service.get(a.id).path, '.git'), 'utf8')).toContain('gitdir:')
  }, 20000)
  test('foreign workspace cannot claim an unbound destination execution', async () => {
    const f = await fixture()
    f.launch.mockImplementationOnce(async task => {
      await expect(f.service.authorize({ ...f.origin, id: 'foreign', paneId: task.paneId!, workspaceId: 'other' }, currentId)).rejects.toThrow('scope')
      f.executions.register({ paneId: task.paneId!, workspaceId: task.workspaceId, cwd: task.path })
    })
    let currentId = ''
    const task = await f.service.create(f.origin, f.input); currentId = task.id
    await vi.waitFor(() => expect(f.service.get(task.id).destinationExecutionId).toBeTruthy(), { timeout: 10000 })
    expect(f.service.get(task.id).destinationExecutionId).not.toBe('foreign')
  }, 20000)
  test('concurrent requests are idempotent, isolate worktrees and transfer targeted context without memory', async () => {
    const f = await fixture()
    await writeFile(join(f.root,'private-uncommitted.txt'),'not transferred')
    const [a, duplicate, b] = await Promise.all([f.service.create(f.origin,f.input),f.service.create(f.origin,f.input),f.service.create(f.origin,{...f.input,key:'task-B'})])
    expect(a.id).toBe(duplicate.id); expect(a.id).not.toBe(b.id)
    await vi.waitFor(() => {
      expect(f.service.get(a.id).state).toBe('starting')
      expect(f.service.get(b.id).state).toBe('starting')
    },{timeout:15000})
    expect(f.createWorktree).toHaveBeenCalledTimes(2)
    const current = f.service.get(a.id)
    expect(current.context).toContain('JWT HttpOnly')
    expect(current.context).toContain('private-uncommitted.txt')
    await expect(readFile(join(current.path,'private-uncommitted.txt'))).rejects.toThrow()
    expect(current.baseSha).toBe(await f.git('rev-parse','HEAD'))
    const child = f.executions.forPane(current.paneId!)!
    await f.service.update(child,a.id,'accepted','Received the handoff')
    await f.service.checkpoint(child,a.id,'Mapped authentication flow; implementation next.')
    await f.service.message(child,a.id,'Which JWT issuer?')
    const inbox = await f.service.inbox(f.origin)
    expect(inbox.some(e => e.text === 'Which JWT issuer?')).toBe(true)
    expect(await f.service.inbox(f.origin)).toEqual(inbox)
    expect(await f.service.inbox(f.origin,inbox.at(-1)!.cursor)).toEqual([])
    await f.service.update(child,a.id,'review','Tests passed; implementation ready for review')
    expect((await f.service.details(f.origin, a.id)).checkpoints).toHaveLength(1)
    await f.service.control(f.ws.id,a.id,'approve')
    expect(f.service.get(a.id).state).toBe('approved')
    expect(f.service.get(b.id).state).toBe('starting')
    await expect(f.service.create(child,{...f.input,key:'recursive'})).rejects.toThrow('Recursive')
    await expect(f.service.create(f.origin,{...f.input,handoff:'Different'})).rejects.toThrow('Idempotency')
  },30000)
  test('uses an exact generic branch intent and a repository default base', async () => {
    const f = await fixture()
    const beforePreview = await f.git('branch', '--format=%(refname:short)')
    const preview = await f.service.preview(f.ws.id, 'Implement card 142', { strategy: 'create', name: 'feature/CARD-142', baseRef: 'HEAD' })
    expect(preview).toMatchObject({ ready: true, checkout: { branch: 'feature/CARD-142', createBranch: true, baseRef: 'HEAD' } })
    expect(await f.git('branch', '--format=%(refname:short)')).toBe(beforePreview)
    await f.git('branch', 'feature/existing-card')
    const exact = await f.service.create(f.origin, { ...f.input, key: 'existing-branch',
      branchIntent: { strategy: 'existing', name: 'feature/existing-card' } })
    await vi.waitFor(() => expect(f.service.get(exact.id).state).toBe('starting'), { timeout: 10000 })
    expect(f.service.get(exact.id)).toMatchObject({ branch: 'feature/existing-card', checkout: {
      strategy: 'existing', createBranch: false, branch: 'feature/existing-card'
    } })
    expect(f.createWorktree.mock.calls.at(-1)?.[0]).toMatchObject({ branch: 'feature/existing-card', createBranch: false })

    const created = await f.service.create(f.origin, { ...f.input, key: 'created-branch',
      branchIntent: { strategy: 'create', name: 'feature/CARD-142', baseRef: 'HEAD' } })
    await vi.waitFor(() => expect(f.service.get(created.id).state).toBe('starting'), { timeout: 10000 })
    expect(f.service.get(created.id).branch).toBe('feature/CARD-142')
    expect(f.service.get(created.id).checkout?.baseRef).toBe('HEAD')
  }, 20000)
  test('opens an existing remote branch with tracking in an isolated worktree', async () => {
    const f = await fixture()
    const bare = join(f.root, '..', 'remote.git')
    await exec('git', ['init', '--bare', bare], { windowsHide: true })
    await f.git('remote', 'add', 'origin', bare)
    await f.git('branch', '-m', 'main')
    await f.git('branch', 'feature/CARD-99')
    await f.git('push', '-u', 'origin', 'feature/CARD-99')
    await f.git('branch', '-D', 'feature/CARD-99')
    const preview = await f.service.preview(f.ws.id, 'Card 99', { strategy: 'existing', name: 'feature/CARD-99' })
    expect(preview.checkout).toMatchObject({ branch: 'feature/CARD-99', remoteRef: 'origin/feature/CARD-99', createBranch: true })
    const task = await f.service.create(f.origin, { ...f.input, key: 'remote-card-99', branchIntent: { strategy: 'existing', name: 'feature/CARD-99' } })
    await vi.waitFor(() => expect(f.service.get(task.id).state).toBe('starting'), { timeout: 10000 })
    expect(await f.git('-C', task.path, 'branch', '--show-current')).toBe('feature/CARD-99')
    expect(await f.git('-C', task.path, 'rev-parse', '--abbrev-ref', '@{upstream}')).toBe('origin/feature/CARD-99')
    expect(await f.git('branch', '--show-current')).toBe('main')
  }, 30000)
  test('defaults application delegations to a persistent Thread with an exact session binding', async () => {
    const f = await fixture()
    const start = vi.fn(async (task: { workspaceId: string; path: string }, persist?: (id: string) => void) => {
      persist?.('thread-destination')
      const env = f.executions.register({ owner: { kind: 'thread', id: 'thread-destination' }, workspaceId: task.workspaceId, cwd: task.path })
      return { threadId: 'thread-destination', executionId: env.OXESPACE_EXECUTION_ID, nativeSessionId: 'native-session', provider: 'codex' as const, generation: 1 }
    })
    const resume = vi.fn(async (task: { workspaceId: string; path: string }) => {
      const env = f.executions.register({ owner: { kind: 'thread', id: 'thread-destination' }, workspaceId: task.workspaceId, cwd: task.path })
      return { threadId: 'thread-destination', executionId: env.OXESPACE_EXECUTION_ID, nativeSessionId: 'native-session', provider: 'codex' as const, generation: 2 }
    })
    f.deps.threadHost = { start, resume, stop: vi.fn(async () => {}) } as never
    const delegated = await f.service.create(f.origin, { ...f.input, key: 'thread-default' })
    await vi.waitFor(() => expect(f.service.get(delegated.id).nativeSession).toBeTruthy(), { timeout: 10000 })
    expect(f.service.get(delegated.id)).toMatchObject({ surface: 'thread', destinationThreadId: 'thread-destination', nativeSession: {
      provider: 'codex', nativeSessionId: 'native-session', canonicalRoot: f.service.get(delegated.id).path, generation: 1, resumable: true
    } })
    expect(f.service.get(delegated.id).paneId).toBeUndefined()
    const restarted = new DelegationService(f.db, f.deps)
    expect(restarted.get(delegated.id).state).toBe('interrupted')
    await restarted.control(f.ws.id, delegated.id, 'resume')
    expect(resume).toHaveBeenCalledTimes(1)
    expect(restarted.get(delegated.id).nativeSession?.generation).toBe(2)
    // Cancellation while resume is in flight must win over its eventual result.
    const interrupted = restarted.get(delegated.id)
    interrupted.state = 'interrupted'
    f.db.prepare('UPDATE delegations SET payload = ? WHERE id = ?').run(JSON.stringify(interrupted), delegated.id)
    let release!: () => void
    resume.mockImplementationOnce(async task => {
      await new Promise<void>(resolve => { release = resolve })
      const env = f.executions.register({ owner: { kind: 'thread', id: 'thread-destination' }, workspaceId: task.workspaceId, cwd: task.path })
      return { threadId: 'thread-destination', executionId: env.OXESPACE_EXECUTION_ID, nativeSessionId: 'native-session', provider: 'codex' as const, generation: 3 }
    })
    const resuming = restarted.control(f.ws.id, delegated.id, 'resume')
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    await expect(restarted.control(f.ws.id, delegated.id, 'resume')).rejects.toThrow('already in progress')
    await restarted.control(f.ws.id, delegated.id, 'cancel')
    release(); await resuming
    expect(restarted.get(delegated.id).state).toBe('cancelled')
    await restarted.stop()
  }, 15000)
  test('rejects unrelated executions and disabled creation; process exit is not completion', async () => {
    const f = await fixture()
    const a = await f.service.create(f.origin,f.input)
    await vi.waitFor(() => expect(f.service.get(a.id).state).toBe('starting'),{timeout:10000})
    await expect(f.service.authorize({...f.origin,id:'foreign'},a.id)).rejects.toThrow('scope')
    await expect(f.service.authorize({...f.origin,workspaceId:'foreign'},a.id)).rejects.toThrow('scope')
    f.service.exited(f.service.get(a.id).paneId!)
    expect(f.service.get(a.id).state).toBe('interrupted')
    await f.service.configure(f.ws.id,false)
    await expect(f.service.create(f.origin,{...f.input,key:'disabled'})).rejects.toThrow('Enable')
  },20000)
  test('failed launch preserves resources and retry reuses them; restart does not relaunch', async () => {
    const f = await fixture(); f.launch.mockRejectedValueOnce(new Error('Missing agent executable'))
    const a = await f.service.create(f.origin,f.input)
    await vi.waitFor(() => expect(f.service.get(a.id).state).toBe('failed'),{timeout:10000})
    const pane = f.service.get(a.id).paneId
    await f.service.control(f.ws.id,a.id,'retry')
    await vi.waitFor(() => expect(f.service.get(a.id).state).toBe('starting'),{timeout:10000})
    expect(f.service.get(a.id).paneId).toBe(pane); expect(f.createWorktree).toHaveBeenCalledTimes(1)
    const restarted = new DelegationService(f.db,f.deps)
    expect(restarted.get(a.id).state).toBe('interrupted'); expect(f.launch).toHaveBeenCalledTimes(2)
    f.executions.end(pane!)
    await restarted.control(f.ws.id,a.id,'retry')
    await vi.waitFor(() => expect(restarted.get(a.id).destinationExecutionId).toBeTruthy(), { timeout:10000 })
    expect(restarted.get(a.id).paneId).toBe(pane)
    expect(restarted.get(a.id).context).toContain('JWT HttpOnly')
    expect(f.createWorktree).toHaveBeenCalledTimes(1)
    await restarted.control(f.ws.id,a.id,'cancel'); expect(restarted.get(a.id).state).toBe('cancelled')
    await restarted.stop()
    expect(await readFile(join(f.service.get(a.id).path,'.git'),'utf8')).toContain('gitdir:')
  },30000)
})
test('execution credentials are distinct, workspace-bound and revoked on exit', () => {
  const r = new ExecutionRegistry()
  const a = r.register({paneId:'a',workspaceId:'ws',cwd:'/repo'})
  const b = r.register({paneId:'b',workspaceId:'ws',cwd:'/repo'})
  expect(a.OXESPACE_EXECUTION_ID).not.toBe(b.OXESPACE_EXECUTION_ID)
  expect(() => r.authenticate(a.OXESPACE_EXECUTION_ID,b.OXESPACE_EXECUTION_TOKEN,'ws')).toThrow()
  expect(r.authenticate(a.OXESPACE_EXECUTION_ID,a.OXESPACE_EXECUTION_TOKEN,'ws').paneId).toBe('a')
  r.end('a'); expect(() => r.authenticate(a.OXESPACE_EXECUTION_ID,a.OXESPACE_EXECUTION_TOKEN,'ws')).toThrow()
})
test('execution registry isolates pane and thread owners with monotonic generations', () => {
  const registry = new ExecutionRegistry()
  const first = registry.register({ owner: { kind: 'thread', id: 'conversation' }, workspaceId: 'ws', cwd: '/repo' })
  const one = registry.forOwner({ kind: 'thread', id: 'conversation' })!
  expect(one.owner).toEqual({ kind: 'thread', id: 'conversation' })
  expect(one.paneId).toBe('thread:conversation')
  expect(one.generation).toBe(1)
  const second = registry.register({ owner: { kind: 'thread', id: 'conversation' }, workspaceId: 'ws', cwd: '/repo' })
  expect(() => registry.authenticate(first.OXESPACE_EXECUTION_ID, first.OXESPACE_EXECUTION_TOKEN, 'ws')).toThrow()
  expect(registry.authenticate(second.OXESPACE_EXECUTION_ID, second.OXESPACE_EXECUTION_TOKEN, 'ws').generation).toBe(2)
  registry.endOwner({ kind: 'thread', id: 'conversation' })
  expect(registry.forOwner({ kind: 'thread', id: 'conversation' })).toBeUndefined()
})
test('native adapters use positional prompts and invocation-scoped MCP without permission bypass', async () => {
  const start = vi.fn(async () => {})
  for (const provider of ['claude','codex'] as const) {
    const launcher = new AgentLaunchService({start} as unknown as TerminalManager,() => [{agentProfileId:provider,provider,name:provider,command:provider,commandTemplate:'',isBuiltin:true}],'/app data')
    await launcher.launch({ id:'task', paneId:'pane',workspaceId:'ws',path:'/repo with spaces',agentProfileId:provider } as never)
    const input = start.mock.calls.at(-1) as unknown as [ { launch: { args:string[] }; initialPrompt?: string } ]
    expect(input[0].initialPrompt).toBeUndefined()
    expect(input[0].launch.args.at(-2)).toBe('--')
    expect(input[0].launch.args.at(-1)).toContain('oxespace_delegation_context')
    expect(input[0].launch.args.join(' ')).not.toContain('dangerously')
    expect(agentMcpArguments(provider,'/app data/bridge.cjs').join(' ')).toContain('/app data/bridge.cjs')
  }
})
