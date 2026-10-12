import { describe, expect, test, vi } from 'vitest'
import { DOCUMENTATION_TOOLS } from '../../electron/main/mcp-internal/documentation-tools'
import { ExecutionRegistry } from '../../electron/main/services/execution-registry'
import type { ToolContext } from '../../electron/main/mcp-internal/tool-registry'

describe('documentation MCP authorization', () => {
  function fixture() {
    const executions = new ExecutionRegistry()
    const env = executions.register({paneId:'pane',workspaceId:'workspace',cwd:process.cwd()})
    const documents = {list:vi.fn(() => [])}
    const documentation = vi.fn(async () => ({documents,preview:{}}))
    const context = {executions, executionId:env.OXESPACE_EXECUTION_ID, executionToken:env.OXESPACE_EXECUTION_TOKEN,
      workspaceId:'workspace', workspaceServ:{get:() => ({panes:[{id:'pane'}]})}, documentation} as unknown as ToolContext
    return {context,documents,documentation,executions}
  }
  const list = DOCUMENTATION_TOOLS.find(t => t.descriptor.name === 'oxespace_documentation_list')!
  test('works without AI Memory and does not expose execution tokens', async () => {
    const f = fixture(), result = await list.handler({},f.context)
    expect(result.isError).toBeUndefined()
    expect(f.documents.list).toHaveBeenCalledOnce()
    expect(JSON.stringify(result)).not.toContain(f.context.executionToken)
  })
  test('rejects foreign workspace and argument scope overrides before loading service', async () => {
    const f = fixture()
    expect((await list.handler({}, {...f.context,workspaceId:'foreign'})).isError).toBe(true)
    expect((await list.handler({project:'foreign'},f.context)).isError).toBe(true)
    expect(f.documentation).not.toHaveBeenCalled()
  })
  test('rejects ended executions', async () => {
    const f = fixture(); f.executions.end('pane')
    expect((await list.handler({},f.context)).isError).toBe(true)
    expect(f.documentation).not.toHaveBeenCalled()
  })
})
