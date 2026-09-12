import { describe, expect, test } from 'vitest'
import { automationTools } from '../../electron/main/mcp-internal/automation-tools'
import { ExecutionRegistry } from '../../electron/main/services/execution-registry'
import type { ToolContext } from '../../electron/main/mcp-internal/tool-registry'

describe('automation discovery', () => {
  const tools = automationTools(() => tools)
  const registry = new ExecutionRegistry()
  const env = registry.register({ paneId: 'pane', workspaceId: 'workspace', cwd: '/checkout' })
  const context = { executions: registry, executionId: env.OXESPACE_EXECUTION_ID,
    executionToken: env.OXESPACE_EXECUTION_TOKEN, workspaceId: 'workspace',
    workspaceServ: { get: () => ({ panes: [{ id: 'pane' }] }) } } as unknown as ToolContext
  test('discovers tools without memory and does not disclose execution tokens', async () => {
    const result = await tools[0].handler({}, context)
    const serialized = JSON.stringify(result)
    expect(result.isError).toBeUndefined()
    expect(serialized).toContain('oxespace_execution_context')
    expect(serialized).not.toContain(env.OXESPACE_EXECUTION_TOKEN)
  })
  test('rejects foreign workspace and argument overrides', async () => {
    expect((await tools[0].handler({}, { ...context, workspaceId: 'foreign' })).isError).toBe(true)
    expect((await tools[0].handler({ workspaceId: 'foreign' }, context)).isError).toBe(true)
  })
  test('unbound memory is not reported as captured data', async () => {
    const result = await tools[2].handler({}, context)
    expect(JSON.stringify(result)).toContain('not_observable')
    expect(JSON.stringify(result)).toContain('unbound')
  })
  test('revoked executions cannot discover capabilities', async () => {
    const executions = new ExecutionRegistry()
    const credentials = executions.register({ paneId: 'pane', workspaceId: 'workspace', cwd: '/checkout' })
    executions.end('pane')
    const result = await tools[0].handler({}, { ...context, executions,
      executionId: credentials.OXESPACE_EXECUTION_ID, executionToken: credentials.OXESPACE_EXECUTION_TOKEN })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('EXECUTION_REQUIRED')
  })
})
