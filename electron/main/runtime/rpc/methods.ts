import type { AppDatabase } from '../../db/index'
import type { GitHubService } from '../../services/github.service'
import type { ExecutionHost } from '../execution-host'
import {
  expectParamString,
  expectParamsRecord,
  optionalParamString,
  RpcInvalidParams,
  type RpcDispatcher,
  type RpcMethod
} from './dispatcher'

interface WorkspaceRow {
  id: string
  name: string
  root_path: string
  is_active: number
}

export interface RpcMethodDeps {
  db: AppDatabase
  gitHubService: GitHubService
  executionHost: ExecutionHost
  appVersion: string
  listMethods: () => string[]
}

/**
 * F3 · The RPC surface. Every method delegates to a service that the IPC layer
 * already uses — the bus is a second door onto the same rooms, not a second
 * implementation.
 */
export function buildRpcMethods(deps: RpcMethodDeps): Record<string, RpcMethod> {
  return {
    ping: () => ({ ok: true, appVersion: deps.appVersion, host: deps.executionHost.id }),

    'rpc.methods': () => ({ methods: deps.listMethods() }),

    'workspace.list': () => {
      const rows = deps.db
        .prepare('SELECT id, name, root_path, is_active FROM workspaces ORDER BY created_at ASC')
        .all() as WorkspaceRow[]
      return {
        workspaces: rows.map((row) => ({
          id: row.id,
          name: row.name,
          rootPath: row.root_path,
          isActive: row.is_active === 1
        }))
      }
    },

    'worktree.list': async (params) => {
      const record = expectParamsRecord(params, 'worktree.list')
      const workspaceId = expectParamString(record, 'workspaceId')
      const rootPath = resolveWorkspaceRoot(deps.db, workspaceId)
      const worktrees = await deps.gitHubService.listWorktrees({ workspaceId, rootPath })
      return { worktrees }
    },

    'worktree.create': async (params) => {
      const record = expectParamsRecord(params, 'worktree.create')
      const workspaceId = expectParamString(record, 'workspaceId')
      const branch = expectParamString(record, 'branch')
      const path = expectParamString(record, 'path')
      const rootPath = resolveWorkspaceRoot(deps.db, workspaceId)
      const result = await deps.gitHubService.createWorktree({
        rootPath,
        branch,
        path,
        createBranch: record.createBranch === true
      })
      return { ok: result.ok, message: result.message, branch, path }
    },

    /** Runs a command on the execution host inside a workspace root. */
    'host.exec': async (params) => {
      const record = expectParamsRecord(params, 'host.exec')
      const workspaceId = expectParamString(record, 'workspaceId')
      const command = expectParamString(record, 'command')
      const rawArgs = record.args ?? []
      if (!Array.isArray(rawArgs) || rawArgs.some((arg) => typeof arg !== 'string')) {
        throw new RpcInvalidParams('args must be an array of strings')
      }
      const cwd = optionalParamString(record, 'cwd') ?? resolveWorkspaceRoot(deps.db, workspaceId)
      const result = await deps.executionHost.exec(command, rawArgs as string[], { cwd })
      return result
    }
  }
}

export function registerRpcMethods(dispatcher: RpcDispatcher, deps: Omit<RpcMethodDeps, 'listMethods'>): RpcDispatcher {
  return dispatcher.registerAll(buildRpcMethods({ ...deps, listMethods: () => dispatcher.list() }))
}

function resolveWorkspaceRoot(db: AppDatabase, workspaceId: string): string {
  const row = db.prepare('SELECT root_path FROM workspaces WHERE id = ?').get(workspaceId) as
    | { root_path: string }
    | undefined
  if (!row) throw new RpcInvalidParams(`Unknown workspace: ${workspaceId}`)
  return row.root_path
}
