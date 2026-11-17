import type { ThreadAuditEntry, ThreadConfiguration, ThreadSnapshot } from '../../../../shared/types/thread'
import { executePlanPrompt, planExecution } from '../../../../shared/threadPlanExecution'

/** What running a plan needs from the orchestrator, and nothing more. */
export interface PlanExecuteHost {
  isStopping(): boolean
  /** A turn is starting, running or finishing, or the thread is being reconfigured. */
  isActive(id: string): boolean
  isFinalizing(id: string): boolean
  /** Waits for every turn that is capturing its diff and checkpoint. */
  settleFinalization(): Promise<void>
  read(id: string): ThreadSnapshot
  configure(id: string, input: ThreadConfiguration, revision: number): Promise<unknown>
  audit(id: string, entry: Omit<ThreadAuditEntry, 'id' | 'at' | 'threadId' | 'projectRoot'>): void
  /** Sends `text` as the next turn, stored exactly as given and marked with `origin`. */
  send(id: string, text: string, origin: 'execute-plan'): Promise<void>
  /** main's language (electron/main/i18n.ts mainLanguage). */
  language(): string
}

/**
 * Runs the plan the agent wrote in Plan mode (OXE-167, AG-11 §5.1): refuses, changing nothing, unless planExecution
 * allows it; otherwise moves the conversation from Plan to Agent (only the mode, through the existing configure, so
 * the access is never raised) and sends exactly the text the card shows as the next turn.
 */
export async function executePlan(host: PlanExecuteHost, id: string, turnId: string): Promise<void> {
  if (host.isStopping()) throw Error('Application is shutting down')
  if (host.isFinalizing(id)) await host.settleFinalization()
  if (host.isActive(id)) throw Error('Finish the active turn before running the plan.')
  const snapshot = host.read(id)
  const check = planExecution(snapshot, turnId)
  if (!check.available) throw Error(`This plan cannot run (${check.reason}).`)
  await host.configure(id, { mode: 'default' }, snapshot.thread.configurationRevision ?? 0)
  host.audit(id, { action: 'configuration', actor: 'user', summary: 'Ran the plan of a Plan turn' })
  await host.send(id, executePlanPrompt(host.language()), 'execute-plan')
}
