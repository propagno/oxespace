import { describe, expect, test, vi } from 'vitest'
import { ExecutionRegistry } from '../electron/main/services/execution-registry'
import { findTool } from '../electron/main/mcp-internal/tool-registry'
import { handleDocumentation } from '../electron/main/mcp-internal/documentation-handler'
import type { ToolContext } from '../electron/main/mcp-internal/tool-registry'

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
