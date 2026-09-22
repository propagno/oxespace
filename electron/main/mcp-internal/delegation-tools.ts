import type { ToolEntry } from './tool-registry'
import type { DelegationInput } from '../../../shared/types/delegation'
import { projectIdentity } from '../services/memory/memory-project.service'
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
        case 'oxespace_delegation_targets': value = service.coordinator.targets(await projectIdentity(origin.cwd)); break
        case 'oxespace_delegation_preflight': value = await service.preflight(origin, {
          targetWorkspaceId: a.targetWorkspaceId as string | undefined,
          objective: a.objective as string | undefined,
          branchIntent: a.branchIntent as DelegationInput['branchIntent']
        }); break
        case 'oxespace_delegation_inbox': value = await service.inbox(origin, a.after as number | undefined); break
        case 'oxespace_delegation_result': value = await service.details(origin, a.taskId as string); break
        default: {
          const t = await service.authorize(origin, a.taskId as string,
            name === 'oxespace_delegation_control' ? { reconnectRequester: true } : undefined)
          if (name === 'oxespace_delegation_status') value = t
          if (name === 'oxespace_delegation_context') value = { taskId: t.id, context: t.context ?? 'Context is still being prepared.',
            bundle: t.knowledgeBundle ? { version: t.knowledgeBundle.version, revision: t.knowledgeBundle.revision, sha256: t.knowledgeBundle.sha256, sources: t.knowledgeBundle.sources } : null }
          if (name === 'oxespace_delegation_update') await service.update(origin,t.id,a.state as string,a.text as string)
          if (name === 'oxespace_delegation_checkpoint') await service.checkpoint(origin,t.id,a.text as string)
          if (name === 'oxespace_delegation_message') await service.message(origin,t.id,a.text as string)
          if (name === 'oxespace_delegation_acknowledge') service.coordinator.acknowledge(t, origin, a.cursor as number)
          if (name === 'oxespace_delegation_control') {
            if (origin.id !== t.originExecutionId) throw new Error('Only the origin can control this delegation')
            if (t.originWorkspaceId) await service.coordinator.authorize(t, origin, 'control')
            await service.control(t.originWorkspaceId ?? t.workspaceId,t.id,a.action as string)
          }
          value ??= { ok: true }
        }
      }
      return { content: [{ type: 'text', text: JSON.stringify(value ?? []) }] }
    } }
}
export const DELEGATION_TOOLS: ToolEntry[] = [
  tool('oxespace_delegation_preflight','Validate an authorized destination and resolve a branch/worktree preview without creating resources. Creation revalidates permissions, refs and repository identity.',{
    targetWorkspaceId:string, objective:string,
    branchIntent:{ type:'object', additionalProperties:false, required:['strategy'], properties:{
      strategy:{type:'string',enum:['existing','create','generated']}, name:{type:'string',maxLength:240},
      baseRef:{type:'string',maxLength:240}, remote:{type:'string',maxLength:120}, fetchBase:{type:'boolean'},
      reuseExistingWorktree:{type:'boolean'}, reference:{type:'string',maxLength:120}, workLabel:{type:'string',maxLength:240},
      template:{type:'string',maxLength:240}
    }}
  }),
  tool('oxespace_delegation_targets','List local destination workspaces explicitly authorized by the user. To register or authorize a repository, ask the user to add its path in Workspace settings > Agent delegation. No clone or permission bypass.',{}),
  tool('oxespace_delegation_result','Read authorized task results and provisioning receipts. Survives application restart; a replacement requester can first use delegation control from the exact original checkout.',{taskId:string},['taskId']),
  tool('oxespace_delegation_acknowledge','Persist your read cursor for a task without consuming another participant’s events.',{taskId:string,cursor:{type:'integer',minimum:0}},['taskId']),
  tool('oxespace_list_agents','List configured Claude/Codex profiles eligible for delegation.',{}),
  tool('oxespace_delegate_task','Delegate to an independent, persistent worktree. Choose an existing exact branch, create an exact branch, or use a local generated template. Optional targetWorkspaceId must be user-authorized. Reuse key for idempotency. No push or merge.',{ key: string, agentProfileId: string, objective: string, handoff: string, acceptance: string, targetWorkspaceId: string,
    schemaVersion:{type:'integer',enum:[2]}, surface:{type:'string',enum:['thread','terminal']}, mode:{type:'string',enum:['analysis','isolated-change']},
    branchIntent:{ type:'object', additionalProperties:false, required:['strategy'], properties:{
      strategy:{type:'string',enum:['existing','create','generated']}, name:{type:'string',maxLength:240},
      baseRef:{type:'string',maxLength:240}, remote:{type:'string',maxLength:120}, fetchBase:{type:'boolean'},
      reuseExistingWorktree:{type:'boolean'}, reference:{type:'string',maxLength:120}, workLabel:{type:'string',maxLength:240},
      template:{type:'string',maxLength:240}
    }}, evidenceFiles:{type:'array',maxItems:8,items:{type:'string',maxLength:512}} },['key','agentProfileId','objective','handoff','acceptance']),
  tool('oxespace_delegation_status','Read provisioning, acceptance and result state. A running process is not task completion.',{taskId:string},['taskId']),
  tool('oxespace_delegation_context','Read the task-specific handoff and bounded optional memory/code evidence. Verify historical claims against the checkout.',{taskId:string},['taskId']),
  tool('oxespace_delegation_update','Delegated agent: acknowledge with accepted, report blocked, or submit result and test evidence with review.',{taskId:string,state:{enum:['accepted','blocked','review'],type:'string'},text:string},['taskId','state','text']),
  tool('oxespace_delegation_checkpoint','Delegated agent: persist an append-only progress checkpoint that survives restart without changing task state.',{taskId:string,text:string},['taskId','text']),
  tool('oxespace_delegation_message','Send a question, answer or clarification to the other participant. Does not type into terminals.',{taskId:string,text:string},['taskId','text']),
  tool('oxespace_delegation_inbox','Read your delegation events after cursor. Check at milestones and while awaiting parallel work. Reads do not consume messages.',{after:{type:'integer',minimum:0}}),
  tool('oxespace_delegation_control','Requester control: resume an exact bound native Thread session, retry provisioning when no resumable session exists, explicitly start a new session from the latest handoff, cancel while preserving code, or approve a submitted result. If the creator execution changed, this explicit call securely reconnects a live session from the same original workspace, project and checkout. Never merges.',{taskId:string,action:{type:'string',enum:['resume','retry','new-session','cancel','approve']}},['taskId','action'])
]
