import { describe, expect, test, vi } from 'vitest'
import { findTool } from '../../electron/main/mcp-internal/tool-registry'
import { ExecutionRegistry } from '../../electron/main/services/execution-registry'
import type { ToolContext } from '../../electron/main/mcp-internal/tool-registry'

// R9 removed the documentation tools; the browser preview tool they shared a module with stays, with the same authorization.
describe('browser preview MCP authorization after R9', () => {
  function fixture() {
    const executions = new ExecutionRegistry()
    const env = executions.register({paneId:'pane',workspaceId:'workspace',cwd:process.cwd()})
    const run = vi.fn(async () => ({title:'Preview fixture'}))
    const documentation = vi.fn(async () => ({preview:{run}}))
    const context = {executions, executionId:env.OXESPACE_EXECUTION_ID, executionToken:env.OXESPACE_EXECUTION_TOKEN,
      workspaceId:'workspace', workspaceServ:{get:() => ({panes:[{id:'pane'}]})}, documentation} as unknown as ToolContext
    return {context,run,documentation,executions}
  }
  const interact = () => findTool('oxespace_preview_interact')!

  test('the documentation tools are gone and oxespace_preview_interact is still registered', () => {
    for (const name of ['create','get','list','capture','checkpoint','image','export']) expect(findTool(`oxespace_documentation_${name}`)).toBeNull()
    expect(findTool('oxespace_preview_interact')).not.toBeNull()
  })
  test('runs the preview action and does not expose execution tokens', async () => {
    const f = fixture(), result = await interact().handler({action:'status'},f.context)
    expect(result.isError).toBeUndefined()
    expect(f.run).toHaveBeenCalledOnce()
    expect(JSON.stringify(result)).toContain('Preview fixture')
    expect(JSON.stringify(result)).not.toContain(f.context.executionToken)
  })
  test('rejects a foreign workspace, unknown arguments and unknown actions before loading the service', async () => {
    const f = fixture()
    expect((await interact().handler({action:'status'}, {...f.context,workspaceId:'foreign'})).isError).toBe(true)
    expect((await interact().handler({action:'status',project:'foreign'},f.context)).isError).toBe(true)
    expect((await interact().handler({action:'delete'},f.context)).isError).toBe(true)
    expect(f.documentation).not.toHaveBeenCalled()
  })
  test('rejects ended executions', async () => {
    const f = fixture(); f.executions.end('pane')
    expect((await interact().handler({action:'status'},f.context)).isError).toBe(true)
    expect(f.documentation).not.toHaveBeenCalled()
  })
})
