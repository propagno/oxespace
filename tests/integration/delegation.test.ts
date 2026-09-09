import { afterEach, describe, expect, test, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
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
    await f.service.message(child,a.id,'Which JWT issuer?')
    const inbox = f.service.inbox(f.origin)
    expect(inbox.some(e => e.text === 'Which JWT issuer?')).toBe(true)
    expect(f.service.inbox(f.origin)).toEqual(inbox)
    expect(f.service.inbox(f.origin,inbox.at(-1)!.cursor)).toEqual([])
    await f.service.update(child,a.id,'review','Tests passed; implementation ready for review')
    await f.service.control(f.ws.id,a.id,'approve')
    expect(f.service.get(a.id).state).toBe('approved')
    expect(f.service.get(b.id).state).toBe('starting')
    await expect(f.service.create(child,{...f.input,key:'recursive'})).rejects.toThrow('Recursive')
    await expect(f.service.create(f.origin,{...f.input,handoff:'Different'})).rejects.toThrow('Idempotency')
  },30000)
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
    await restarted.control(f.ws.id,a.id,'cancel'); expect(restarted.get(a.id).state).toBe('cancelled')
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
