import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ToolEntry } from './tool-registry'
import { projectIdentity } from '../services/memory/memory-project.service'

const exec = promisify(execFile)

/** Discovery is read-only and authenticated independently of optional memory. */
export function automationTools(catalogue: () => ToolEntry[]): ToolEntry[] {
  return ['oxespace_capabilities', 'oxespace_execution_context', 'oxespace_memory_diagnostics'].map(name => ({
    descriptor: { name, description: name === 'oxespace_capabilities'
      ? 'Discover registered OXESpace tools and execution requirements. Availability is not authorization.'
      : name === 'oxespace_execution_context'
        ? 'Read your authenticated launch workspace, pane and Git checkout. Does not infer your shell current directory.'
        : 'Inspect memory binding and observed hook metadata. A received hook does not prove native persistence or consolidation.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    requiresWorkspace: true,
    handler: async (args, ctx) => {
      const requestId = randomUUID()
      const reply = (status: string, data: unknown, isError = false) => ({ content: [{ type: 'text' as const,
        text: JSON.stringify({ schemaVersion: 1, requestId, status, ...(isError ? { error: data } : { data }) }) }], ...(isError ? { isError: true } : {}) })
      if (args !== undefined && (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length)) {
        return reply('error', { code: 'INVALID_ARGUMENTS', message: 'This tool takes an empty object.', retryable: false }, true)
      }
      let execution
      try { execution = ctx.executions?.authenticate(ctx.executionId, ctx.executionToken, ctx.workspaceId) }
      catch { /* Never return credential-bearing errors. */ }
      if (!execution) return reply('error', { code: 'EXECUTION_REQUIRED', message: 'Open a new OXESpace agent terminal.', retryable: false }, true)
      const workspace = ctx.workspaceServ.get(execution.workspaceId)
      const pane = workspace?.panes.find(p => p.id === execution.paneId)
      if (!pane) return reply('error', { code: 'PANE_UNAVAILABLE', message: 'The execution pane no longer exists.', retryable: false }, true)
      if (name === 'oxespace_capabilities') return reply('ok', {
        tools: catalogue().map(t => ({ name: t.descriptor.name, requiresWorkspace: t.requiresWorkspace })),
        workspaceId: execution.workspaceId,
        memoryBound: Boolean(ctx.memory && ctx.memoryRunId),
        delegationServiceAvailable: Boolean(ctx.delegation),
        delegation: ctx.delegation ? await ctx.delegation.capabilities(execution).catch(() => ({ status: 'unavailable' })) : { status: 'unavailable' },
        policy: 'Every action revalidates scope, ownership and project opt-in. Listed tools may require additional setup.',
        limits: { concurrentDelegationsPerProject: 4, recursiveDelegation: false }
      })
      if (name === 'oxespace_memory_diagnostics') {
        if (!ctx.memory || !ctx.memoryRunId) return reply('ok', { binding: 'unbound', suggestedAction: 'Enable/configure memory and open a new terminal.', nativePersistence: 'not_observable', consolidation: 'not_observable' })
        try {
          const observations = ctx.memory.observations(ctx.memoryRunId, execution.workspaceId, execution.paneId)
          const context = await ctx.memory.contextForRun(ctx.memoryRunId, execution.workspaceId)
          const health = await ctx.memory.manager.run(context, provider => provider.health())
          return reply('ok', { binding: 'bound', projectId: context.projectId,
            settings: ctx.memory.projects.settings(context.projectId),
            runtime: health.status === 'ok' ? health.value.status : health.status,
            observations, providerReplies: ctx.memory.manager.observations(context.projectId),
            nativePersistence: 'not_observable', consolidation: 'not_observable', spool: 'not_observable' })
        } catch { return reply('error', { code: 'MEMORY_BINDING_UNAVAILABLE', message: 'Memory binding cannot be verified. Terminal execution can continue.', retryable: true }, true) }
      }
      let git: unknown = { status: 'unavailable' }
      let repositoryIdentity: string | null = null
      try {
        repositoryIdentity = `local-project-sha256:${createHash('sha256').update(await projectIdentity(execution.cwd)).digest('hex')}`
        const result = await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: execution.cwd, windowsHide: true, timeout: 2000, maxBuffer: 8192 })
        const head = await exec('git', ['rev-parse', '--verify', 'HEAD'], { cwd: execution.cwd, windowsHide: true, timeout: 2000, maxBuffer: 8192 })
        git = { status: 'ok', branch: result.stdout.trim(), head: head.stdout.trim(), sampledAt: Date.now() }
      } catch { /* A non-Git or unavailable checkout still has execution context. */ }
      return reply('ok', { workspaceId: execution.workspaceId, paneId: execution.paneId, executionId: execution.id,
        repositoryIdentity,
        launchCwd: execution.cwd, currentShellCwd: 'unknown', agentProfileId: pane.agentProfileId,
        originPaneId: pane.originPaneId ?? null, git })
    }
  }))
}
