import type { AppDatabase } from '../../db/index'
import type { AgentHookLocationEvent, AgentHookStatusEvent, SessionLocation } from '../../../../shared/types/agent-hooks'
import type { AgentHookServerOptions } from './server'
import type { HttpAuditLog } from '../http-audit/store'
import { summarizeEdits } from './edit-capture'

export interface HookPipelineDeps {
  db: AppDatabase
  authenticate(input: { executionId?: string; token: string; workspaceId?: string }): { paneId: string; workspaceId: string; launchRoot?: string } | null
  onStatus(event: AgentHookStatusEvent): void
  resolveLocation?(cwd: string, launchRoot: string): SessionLocation | null
  onLocation?(event: AgentHookLocationEvent): void
  now?: () => number
}

export function hookServerOptionsFor(deps: HookPipelineDeps): AgentHookServerOptions {
  // The HTTP audit's writer and its command parser load with the first hook event, not at start (main's entry budget).
  // One log per pipeline, as before; events keep their order, since each one waits on the same load.
  let httpAuditLog: Promise<HttpAuditLog | null> | null = null
  const audit = (): Promise<HttpAuditLog | null> => (httpAuditLog ??= import('../http-audit/store').then(
    module => new module.HttpAuditLog(deps.db, deps.now),
    () => { httpAuditLog = null; return null }
  ))

  return {
    authenticate: deps.authenticate,
    onStatus: deps.onStatus,
    resolveLocation: deps.resolveLocation,
    onLocation: deps.onLocation,
    now: deps.now,
    httpAudit: {
      ingest: (input) => {
        void audit().then(log => {
          try {
            log?.ingest({
              paneId: input.paneId,
              workspaceId: input.workspaceId,
              agent: input.agent,
              sessionId: input.sessionId,
              at: input.at,
              record: input.record
            })
          } catch {
            /* fail-open */
          }
        })
        try {
          const edits = summarizeEdits(input.record)
          if (edits.length > 0) {
            const actor = input.paneId ? `pane:${input.paneId}` : 'agent'
            const isFailure = input.record?.hook_event_name === 'PostToolUseFailure'
            const outcome = isFailure ? 'error' : 'ok'
            const insert = deps.db.prepare(
              `INSERT INTO agent_action_audit (ts, actor, workspace_id, tool, action, level, text, decision, outcome, path, line, added, removed)
               VALUES (?, ?, ?, ?, 'edit', 'write', ?, 'hook', ?, ?, ?, ?, ?)`
            )
            for (const edit of edits) {
              insert.run(
                input.at,
                actor,
                input.workspaceId,
                edit.tool,
                edit.path,
                outcome,
                edit.path,
                edit.line,
                edit.added,
                edit.removed
              )
            }
          }
        } catch {
          /* fail-open */
        }
      }
    }
  }
}
