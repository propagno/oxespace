import type { ToolContext } from './tool-registry'
import type { InternalMcpToolCallResult } from '../../../shared/types/mcp-internal'
import { codeWorkspace, int, resolveScope, service, str, type ActionScope, type Approval, type Args, type Gate } from './domain-tool'
import { ActionRefused, AgentActions } from '../services/agent-actions/agent-actions'
import { mainMessage } from '../../../shared/messages'
import { policyStore } from '../services/policy'
import { SemanticProjects } from '../services/semantic-projects'
import { SessionService } from '../services/session.service'

/**
 * What the X21 actions do. Loaded on first call, so the main entry carries only
 * their descriptions (see app-settings-tools.ts). Nothing here changes settings,
 * and nothing returns secrets, sign-in state or file paths of the person's history.
 */

const workspaceInput = (scope: ActionScope) => ({ workspaceId: scope.workspaceId ?? 'mcp', rootPath: scope.rootPath })

/** A checkpoint of the caller's workspace, never one of another workspace by id. */
function ownCheckpoint(args: Args, scope: ActionScope, ctx: ToolContext) {
  const checkpointId = str(args, 'checkpointId', 200)
  const checkpoint = service(ctx, 'github').listCheckpoints(workspaceInput(scope)).find(item => item.id === checkpointId)
  if (!checkpoint) throw new ActionRefused('No checkpoint with that id here.', 'not-found')
  return checkpoint
}

async function integration(ctx: ToolContext) {
  if (!ctx.db) throw new ActionRefused('Integration groups are unavailable right now.', 'unavailable')
  const { IntegrationService } = await import('../services/integration.service')
  return new IntegrationService(ctx.db)
}

type Run = (args: Args, scope: ActionScope, ctx: ToolContext) => Promise<unknown>

export const ACTIONS: Record<string, Run> = {
  async settings_workspace(_args, scope, ctx) {
    const workspace = ctx.workspaceServ.get(codeWorkspace(scope))
    if (!workspace) throw new ActionRefused('The workspace is gone.', 'not-found')
    const { id, name, rootPath, layout, layoutPreset, themeId, uiDensity, defaultShellProfileId, autoStart, panes } = workspace
    return { id, name, rootPath, layout, layoutPreset, themeId, uiDensity, defaultShellProfileId, autoStart, paneCount: panes.length }
  },
  async settings_policy(_args, scope) {
    const store = policyStore()
    if (!store) return { sources: [], problems: [] }
    const { sources, problems } = store.load(scope.rootPath)
    return { sources: sources.map(({ layer, organization, rules }) => ({ layer, organization: organization ?? null, rules })), problems }
  },
  async settings_semantic(_args, scope, ctx) {
    // A Code workspace keeps its own index id; a Thread project uses its root's.
    const id = scope.workspaceId && !scope.workspaceId.startsWith('thread:') ? scope.workspaceId : SemanticProjects.idFor(scope.rootPath)
    const { lastQuery: _lastQuery, lastError, ...status } = ctx.semantic.getStatus(id)
    return { ...status, lastError: lastError ? lastError.slice(0, 300) : null }
  },
  async integration_groups(_args, scope, ctx) {
    return (await integration(ctx)).listGroups(codeWorkspace(scope))
  },
  async integration_handoffs(args, scope, ctx) {
    const groups = await integration(ctx)
    const groupId = str(args, 'groupId', 200)
    if (!groups.listGroups(codeWorkspace(scope)).some(group => group.id === groupId)) throw new ActionRefused('No group with that id for this workspace. Use action groups.', 'not-found')
    return groups.listHandoffs(groupId!)
  },
  async native_sessions(args, scope, ctx) {
    if (!ctx.db) throw new ActionRefused('Sessions are unavailable right now.', 'unavailable')
    const provider = str(args, 'provider', 10) === 'codex' ? 'codex' : 'claude'
    const sessions = new SessionService(ctx.db).listSessions(scope.workspaceId ?? 'mcp', scope.rootPath, provider).sort((a, b) => b.lastUpdatedMs - a.lastUpdatedMs)
    const limit = int(args, 'limit', 30, 1, 100)
    return { items: sessions.slice(0, limit).map(({ filePath: _path, ...session }) => session), total: sessions.length, ...(sessions.length > limit ? { truncated: true } : {}) }
  },
  async checkpoints(_args, scope, ctx) {
    return service(ctx, 'github').listCheckpoints(workspaceInput(scope))
      .map(({ patch, untrackedFiles, workspaceId: _workspace, ...checkpoint }) => ({ ...checkpoint, patchChars: patch.length, untrackedFiles: untrackedFiles.length }))
  },
  async delete_checkpoint(args, scope, ctx) {
    return service(ctx, 'github').deleteCheckpoint({ checkpointId: ownCheckpoint(args, scope, ctx).id })
  }
}

export function deleteCheckpointApproval(args: Args, scope: ActionScope, ctx: ToolContext): Approval {
  const { name } = ownCheckpoint(args, scope, ctx)
  return { summary: `delete checkpoint "${name}"`, text: `Delete checkpoint "${name}"\nin ${scope.rootPath}` }
}

const fallbackActions = new AgentActions()

/** The body of `gated` (domain-tool.ts): the policy door for a tool that predates domainTool. */
export async function runGated(gate: Gate, raw: unknown, ctx: ToolContext): Promise<InternalMcpToolCallResult> {
  const args = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Args
  try {
    const scope = await resolveScope(ctx)
    const approval = gate.level === 'confirm' ? await gate.confirm?.(args, scope) : undefined
    return await (ctx.agentActions ?? fallbackActions).run(scope.actor, {
      tool: gate.tool, action: 'call', level: gate.level, target: scope.rootPath, summary: approval?.summary, text: approval?.text, notes: approval?.notes
    }, () => gate.handler(raw, ctx))
  } catch (error) {
    if (!(error instanceof ActionRefused)) throw error
    return { content: [{ type: 'text', text: JSON.stringify({ schemaVersion: 1, ok: false, code: error.code, message: error.message }) }], isError: true }
  }
}

export function removeWorktreeApproval(args: Args, scope: ActionScope): Approval {
  const force = args.force === true
  return {
    summary: `remove the worktree ${String(args.path)}`,
    text: `git worktree remove${force ? ' --force' : ''} ${String(args.path)}\nfrom ${scope.rootPath}`,
    notes: [mainMessage('approvals.note.worktree.folderDeleted', {}), ...(force ? [mainMessage('approvals.note.worktree.forceDiscards', {})] : [])]
  }
}
