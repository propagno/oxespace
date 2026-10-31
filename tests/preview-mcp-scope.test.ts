import { describe, expect, test, vi } from 'vitest'
import { ExecutionRegistry } from '../electron/main/services/execution-registry'
import { findTool } from '../electron/main/mcp-internal/tool-registry'
import { handleDocumentation } from '../electron/main/mcp-internal/documentation-handler'
import type { ToolContext } from '../electron/main/mcp-internal/tool-registry'
import { AgentActions } from '../electron/main/services/agent-actions/agent-actions'
import { ApprovalBroker, type ApprovalDecision, type ApprovalPrompter, type ApprovalRequest } from '../electron/main/services/agent-actions/approval-broker'

function context(owner: {kind:'pane'|'thread';id:string}, workspaceId: string, panePresent: boolean) {
  const executions = new ExecutionRegistry()
  const env = executions.register({ owner, workspaceId, cwd: process.cwd() })
  const emitPreview = vi.fn()
  const ctx = {
    executions, executionId:env.OXESPACE_EXECUTION_ID, executionToken:env.OXESPACE_EXECUTION_TOKEN,
    workspaceId, workspaceServ:{ get:() => panePresent ? { id:workspaceId, panes:[{id:owner.id}] } : undefined },
    webPreview:{emitPreview}
  } as unknown as ToolContext
  return { ctx, emitPreview, executions }
}

describe('Web Preview MCP execution scope', () => {
  const openPreview = (ctx: ToolContext) => findTool('oxespace_open_web_preview')!.handler({url:'http://localhost:5173'},ctx)
  test('a Thread opens its own preview without a Code workspace', async () => {
    const {ctx,emitPreview} = context({kind:'thread',id:'thread-a'},'thread:project-a',false)
    const result = await openPreview(ctx)
    expect(result.isError).not.toBe(true)
    expect(emitPreview).toHaveBeenCalledWith(expect.objectContaining({workspaceId:'thread:project-a',threadId:'thread-a'}))
  })

  test('a Code pane must still exist and an ended execution cannot open a preview', async () => {
    const missing = context({kind:'pane',id:'pane-a'},'workspace-a',false)
    await expect(openPreview(missing.ctx)).rejects.toThrow('no longer available')
    const live = context({kind:'pane',id:'pane-a'},'workspace-a',true)
    await openPreview(live.ctx)
    expect(live.emitPreview).toHaveBeenCalledWith(expect.objectContaining({workspaceId:'workspace-a',threadId:undefined}))
    live.executions.endOwner({kind:'pane',id:'pane-a'})
    await expect(openPreview(live.ctx)).rejects.toThrow('live OXESpace terminal')
  })

  test('a Thread browser action uses its live owner without requiring a Code pane', async () => {
    const {ctx} = context({kind:'thread',id:'thread-a'},'thread:project-a',false)
    const run = vi.fn().mockResolvedValue({sessionId:'browser-session'})
    ctx.documentation = async () => ({preview:{run}}) as never
    const result = await handleDocumentation({name:'oxespace_preview_interact',properties:{action:{}},required:['action']},{action:'status'},ctx)
    expect(result.isError).not.toBe(true)
    expect(run).toHaveBeenCalledWith('thread:project-a',{action:'status'},expect.any(Function),{kind:'thread',id:'thread-a'})
  })
})

describe('Web Preview URL level (B15)', () => {
  /** A broker whose person answers when the test says so; the call waits 10 ms before reporting pending. */
  function approvals() {
    const asked: ApprovalRequest[] = []
    let answer: (decision: ApprovalDecision) => void = () => undefined
    const prompter: ApprovalPrompter = { ask: request => { asked.push(request); return new Promise(resolve => { answer = resolve }) } }
    return { asked, answer: (decision: ApprovalDecision) => answer(decision), actions: new AgentActions({ broker: new ApprovalBroker(prompter, Date.now, 10) }) }
  }
  const open = (ctx: ToolContext, url: string) => findTool('oxespace_open_web_preview')!.handler({ url }, ctx)
  const reply = (result: Awaited<ReturnType<typeof open>>) => JSON.parse((result.content[0] as { text: string }).text) as { code?: string }

  test('an external page raises an approval request and nothing opens until it is approved', async () => {
    const { ctx, emitPreview } = context({ kind: 'thread', id: 'thread-a' }, 'thread:project-a', false)
    const broker = approvals()
    ctx.agentActions = broker.actions
    const first = await open(ctx, 'https://example.com')
    expect(first.isError).toBe(true)
    expect(reply(first).code).toBe('approval-pending')
    expect(broker.asked).toHaveLength(1)
    expect(broker.asked[0]).toMatchObject({ tool: 'oxespace_open_web_preview.call', text: 'Open in the Web Preview:\nhttps://example.com/' })
    expect(emitPreview).not.toHaveBeenCalled()
    broker.answer('allow-once')
    await new Promise(resolve => setTimeout(resolve, 0))
    const second = await open(ctx, 'https://example.com')
    expect(second.isError).not.toBe(true)
    expect(emitPreview).toHaveBeenCalledTimes(1)
    expect(emitPreview).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://example.com/', threadId: 'thread-a' }))
    // The grant was for that call: another external page asks again.
    expect(reply(await open(ctx, 'https://example.org')).code).toBe('approval-pending')
    expect(emitPreview).toHaveBeenCalledTimes(1)
  })

  test('a declined page never opens', async () => {
    const { ctx, emitPreview } = context({ kind: 'thread', id: 'thread-a' }, 'thread:project-a', false)
    const broker = approvals()
    ctx.agentActions = broker.actions
    await open(ctx, 'file:///etc/passwd')
    expect(broker.asked[0]?.reasons[0]).toMatch(/file on this computer/)
    broker.answer('deny')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(reply(await open(ctx, 'file:///etc/passwd')).code).toBe('denied')
    expect(emitPreview).not.toHaveBeenCalled()
  })

  test('localhost opens directly, without asking', async () => {
    const { ctx, emitPreview } = context({ kind: 'thread', id: 'thread-a' }, 'thread:project-a', false)
    const broker = approvals()
    ctx.agentActions = broker.actions
    for (const url of ['http://localhost:5173', 'http://127.0.0.1:4178/x', 'http://[::1]:3000', 'http://app.localhost:8080']) expect((await open(ctx, url)).isError, url).not.toBe(true)
    expect(broker.asked).toHaveLength(0)
    expect(emitPreview).toHaveBeenCalledTimes(4)
  })

  test.each(['http://localhost.evil.com', 'http://127.0.0.1@evil.com', 'http://[::ffff:7f00:1]', 'http://2130706433', 'http://0177.0.0.1', 'http://LOCALHOST:5173'])('%s is treated as external', async url => {
    const { ctx, emitPreview } = context({ kind: 'thread', id: 'thread-a' }, 'thread:project-a', false)
    const broker = approvals()
    ctx.agentActions = broker.actions
    expect(reply(await open(ctx, url)).code).toBe('approval-pending')
    expect(broker.asked).toHaveLength(1)
    expect(emitPreview).not.toHaveBeenCalled()
  })

  test.each(['javascript:alert(1)', 'data:text/html,<b>x</b>', 'blob:http://localhost/1', 'about:blank', 'chrome://settings', 'devtools://devtools', 'mailto:a@b.c', 'oxespace://x'])('%s is refused without asking', async url => {
    const { ctx, emitPreview } = context({ kind: 'thread', id: 'thread-a' }, 'thread:project-a', false)
    const broker = approvals()
    ctx.agentActions = broker.actions
    const result = await open(ctx, url)
    expect(result.isError).toBe(true)
    expect(broker.asked).toHaveLength(0)
    expect(emitPreview).not.toHaveBeenCalled()
  })
})
