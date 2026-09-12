import type { ToolEntry } from './tool-registry'
import type { DelegationInput } from '../../../shared/types/delegation'
const string = { type: 'string', minLength: 1, maxLength: 16000 }
function tool(name: string, description: string, properties: Record<string, unknown>, required: string[] = []): ToolEntry {
  return { descriptor: { name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false } }, requiresWorkspace: true,
    handler: async (args, ctx) => {
      const service = ctx.delegation
      if (!service || !ctx.executions) throw new Error('Agent delegation is unavailable')
      const origin = ctx.executions.authenticate(ctx.executionId, ctx.executionToken, ctx.workspaceId)
      if (!args || typeof args !== 'object' || Array.isArray(args)) args = {}
      const a = args as Record<string, unknown>
      for (const key of required) if (typeof a[key] !== 'string' || !(a[key] as string).trim() || (a[key] as string).length > 16000) throw new Error(`Invalid ${key}`)
      let value: unknown
      switch (name) {
        case 'oxespace_list_agents': value = ctx.delegationAgents?.(); break
        case 'oxespace_delegate_task': value = await service.create(origin, a as unknown as DelegationInput); break
        case 'oxespace_delegation_inbox': value = service.inbox(origin, a.after === undefined ? 0 : a.after as number); break
        default: {
          const t = await service.authorize(origin, a.taskId as string)
          if (name === 'oxespace_delegation_status') value = t
          if (name === 'oxespace_delegation_context') value = { taskId: t.id, context: t.context ?? 'Context is still being prepared.' }
          if (name === 'oxespace_delegation_update') await service.update(origin,t.id,a.state as string,a.text as string)
          if (name === 'oxespace_delegation_message') await service.message(origin,t.id,a.text as string)
          if (name === 'oxespace_delegation_control') {
            if (origin.id !== t.originExecutionId) throw new Error('Only the origin can control this delegation')
            await service.control(t.workspaceId,t.id,a.action as string)
          }
          value ??= { ok: true }
        }
      }
      return { content: [{ type: 'text', text: JSON.stringify(value ?? []) }] }
    } }
}
export const DELEGATION_TOOLS: ToolEntry[] = [
  tool('oxespace_list_agents','List configured Claude/Codex profiles eligible for delegation.',{}),
  tool('oxespace_delegate_task','Delegate parallel work to a new worktree and agent terminal. Requires user-enabled automation. Reuse key when retrying the same request; call inbox at checkpoints. No uncommitted files are copied.',{ key: string, agentProfileId: string, objective: string, handoff: string, acceptance: string },['key','agentProfileId','objective','handoff','acceptance']),
  tool('oxespace_delegation_status','Read provisioning, acceptance and result state. A running process is not task completion.',{taskId:string},['taskId']),
  tool('oxespace_delegation_context','Read the task-specific handoff and bounded optional memory/code evidence. Verify historical claims against the checkout.',{taskId:string},['taskId']),
  tool('oxespace_delegation_update','Delegated agent: acknowledge with accepted, report blocked, or submit result and test evidence with review.',{taskId:string,state:{enum:['accepted','blocked','review'],type:'string'},text:string},['taskId','state','text']),
  tool('oxespace_delegation_message','Send a question, answer or clarification to the other participant. Does not type into terminals.',{taskId:string,text:string},['taskId','text']),
  tool('oxespace_delegation_inbox','Read your delegation events after cursor. Check at milestones and while awaiting parallel work. Reads do not consume messages.',{after:{type:'integer',minimum:0}}),
  tool('oxespace_delegation_control','Origin only: retry failed/interrupted provisioning, cancel preserving code, or approve a submitted result. Never merges.',{taskId:string,action:{type:'string',enum:['retry','cancel','approve']}},['taskId','action'])
]
