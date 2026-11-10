import type { AppDatabase } from '../../db/index'
import type { AgentHookLocationEvent, AgentHookStatusEvent, SessionLocation } from '../../../../shared/types/agent-hooks'
import type { AgentHookServerOptions } from './server'
import { HttpAuditLog } from '../http-audit/store'

export interface HookPipelineDeps {
  db: AppDatabase
  authenticate(input: { executionId?: string; token: string; workspaceId?: string }): { paneId: string; workspaceId: string; launchRoot?: string } | null
  onStatus(event: AgentHookStatusEvent): void
  resolveLocation?(cwd: string, launchRoot: string): SessionLocation | null
  onLocation?(event: AgentHookLocationEvent): void
  now?: () => number
}

export function hookServerOptionsFor(deps: HookPipelineDeps): AgentHookServerOptions {
  const httpAuditLog = new HttpAuditLog(deps.db, deps.now)

  return {
    authenticate: deps.authenticate,
    onStatus: deps.onStatus,
    resolveLocation: deps.resolveLocation,
    onLocation: deps.onLocation,
    now: deps.now,
    httpAudit: {
      ingest: (input) => {
        try {
          httpAuditLog.ingest({
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
      }
    }
  }
}
