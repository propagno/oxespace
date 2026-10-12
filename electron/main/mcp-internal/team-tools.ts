import type { ToolEntry } from './tool-registry'
import type { TeamMessageKind } from '../../../shared/types/team'
const string = { type: 'string', minLength: 1, maxLength: 16384 }
function tool(name: string, description: string, properties: Record<string, unknown>, required: string[] = []): ToolEntry {
  return { descriptor: { name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false } }, requiresWorkspace: true,
    handler: async (args, ctx) => {
      if (!ctx.team || !ctx.executions) throw Error('Team is unavailable')
      const execution = ctx.executions.authenticate(ctx.executionId, ctx.executionToken, ctx.workspaceId)
      const { team, member } = await ctx.team.authorize(execution)
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw Error('Invalid team arguments')
      const input = args as Record<string, unknown>
      if (Object.keys(input).some(key => !(key in properties))) throw Error('Unknown team argument')
      for (const key of required) if (typeof input[key] !== 'string' || !(input[key] as string).trim()) throw Error(`Invalid ${key}`)
      const repository = ctx.team.repository
      let value: unknown
      if (name === 'oxespace_team_status') value = { team, currentMemberId: member.id, delivery: 'Read the inbox at checkpoints. Optional UI-authorized delivery wakes connected idle Thread sessions; Code sessions read the inbox through MCP.' }
      if (name === 'oxespace_team_inbox') value = repository.inbox(team.id, member.id, input.after as number | undefined, input.limit as number | undefined)
      if (name === 'oxespace_team_message') value = repository.send({ teamId: team.id, senderId: member.id, recipientId: input.recipientId as string, key: input.key as string, kind: input.kind as TeamMessageKind, body: input.body as string, replyTo: input.replyTo as string | undefined })
      if (name === 'oxespace_team_acknowledge') { repository.acknowledge(team.id, member.id, input.messageId as string); value = { received: true } }
      return { content: [{ type: 'text', text: JSON.stringify(value) }] }
    } }
}
export const TEAM_TOOLS = [
  tool('oxespace_team_status', 'Read the team and your authenticated role. Requires an explicit live session connection in Team. Does not start sessions.', {}),
  tool('oxespace_team_inbox', 'Read your durable inbox in sequence order. Reading does not acknowledge receipt. Check at milestones; automatic delivery depends on explicit UI authorization for the recipient Thread.', { after: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }),
  tool('oxespace_team_message', 'Persist a message to a member of your team. Reuse key for retries of identical content. Sender comes from authenticated execution; no terminal input is injected.', { recipientId: string, key: string, kind: { type: 'string', enum: ['request','progress','question','answer','result','decision'] }, body: string, replyTo: string }, ['recipientId','key','kind','body']),
  tool('oxespace_team_acknowledge', 'Confirm receipt of one message addressed to you; does not mark its task complete.', { messageId: string }, ['messageId'])
]
