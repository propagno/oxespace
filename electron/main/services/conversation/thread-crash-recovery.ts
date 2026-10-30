import type { ThreadCommandResult, ThreadEvent, ThreadSnapshot } from '../../../../shared/types/thread'

/**
 * Crash recovery for tools. A tool event is journaled as `running` when the
 * provider starts it, so a kill between start and finish leaves a durable trace.
 * On the next launch such a tool is marked `interrupted`, never completed, and
 * is never executed again by the app: the person decides whether to continue.
 */
export type ToolEvent = Extract<ThreadEvent, { type: 'tool' }>

export const INTERRUPTED_TOOL_NOTE = 'Interrupted: the app closed while this was running'

/** Marks a tool that was still running when the process went away. */
export function interruptTool(event: ToolEvent, completedAt: number): void {
  event.state = 'unknown'
  event.interrupted = true
  event.completedAt = completedAt
  event.output = event.output ? `${event.output}\n\n${INTERRUPTED_TOOL_NOTE}` : INTERRUPTED_TOOL_NOTE
}

/** Interrupted tools still waiting for the person's choice. */
export function pendingInterruptedTools(snapshot: ThreadSnapshot): ToolEvent[] {
  return snapshot.events.filter((event): event is ToolEvent => event.type === 'tool' && event.interrupted === true && !event.interruptedHandled)
}

/** The explicit note sent to the provider. It never asks to redo the tool. */
export function continuePrompt(tools: ToolEvent[]): string {
  const list = tools.slice(0, 10).map(tool => `- ${tool.name}${tool.detail ? `: ${tool.detail.replace(/\s+/g, ' ').slice(0, 200)}` : ''}`).join('\n')
  return [
    'OXESpace closed while the following tool call(s) were running. Each one may or may not have taken effect.',
    list,
    'Before doing anything else, check the current state (files, git status, processes) to find out what actually happened. Do not repeat these actions blindly; only redo what is verifiably missing, then continue the previous task.'
  ].join('\n')
}

export interface CrashRecoveryHost {
  read(id: string): ThreadSnapshot
  save(snapshot: ThreadSnapshot, options?: { eventsFrom: number }): void
  send(id: string, text: string): Promise<void>
}

export const CONTINUE_INTERRUPTED = '/continue-interrupted'
export const DISMISS_INTERRUPTED = '/dismiss-interrupted'

function handle(snapshot: ThreadSnapshot, ids: string[] | undefined, how: 'continued' | 'dismissed', host: CrashRecoveryHost): ToolEvent[] {
  const tools = pendingInterruptedTools(snapshot).filter(tool => !ids || ids.includes(tool.id))
  const first = tools.length ? snapshot.events.indexOf(tools[0]) : -1
  for (const tool of tools) tool.interruptedHandled = how
  if (first >= 0) host.save(snapshot, { eventsFrom: first })
  return tools
}

/**
 * Handles the two person-only commands behind the Continue and Dismiss buttons.
 * Returns undefined for any other text. Approvals are never touched here.
 */
export async function runCrashRecoveryCommand(host: CrashRecoveryHost, threadId: string, text: string): Promise<ThreadCommandResult | undefined> {
  const [name, ...rest] = text.trim().split(/\s+/)
  if (name !== CONTINUE_INTERRUPTED && name !== DISMISS_INTERRUPTED) return undefined
  const ids = rest.length ? rest : undefined
  const snapshot = host.read(threadId)
  if (name === DISMISS_INTERRUPTED) { handle(snapshot, ids, 'dismissed', host); return { kind: 'applied' } }
  const prompt = continuePrompt(pendingInterruptedTools(snapshot).filter(tool => !ids || ids.includes(tool.id)))
  if (!pendingInterruptedTools(snapshot).some(tool => !ids || ids.includes(tool.id))) return { kind: 'applied' }
  handle(snapshot, ids, 'continued', host)
  await host.send(threadId, prompt)
  return { kind: 'applied' }
}
