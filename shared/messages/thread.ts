/** C3 message codes of the thread domain (`thread.*`); merged into `MessageParams` and `MESSAGE_CODES` by shared/messages.ts. */

export interface ThreadMessageParams {
  /** A pending request was answered, cancelled or expired before this answer arrived. */
  'thread.request.notPending': Record<string, never>
  /** The conversation restarted since the request was listed; the answer belongs to an older generation. */
  'thread.request.staleGeneration': Record<string, never>
  /** Another answer to the same request is being delivered (a second window or device). */
  'thread.request.alreadyResponding': Record<string, never>
  /** A question was answered without an answer for every required question. */
  'thread.request.unanswered': Record<string, never>
  /** A guarded request (agent instructions, MCP settings, hooks) was answered "for the session": it is approved once or declined. */
  'thread.request.guardedDecision': Record<string, never>
  /** Why a change needs the person each time; `path` is the file as the request names it. */
  'thread.protectedConfig.instructions': { path: string }
  'thread.protectedConfig.mcp': { path: string }
  'thread.protectedConfig.hooks': { path: string }
  'thread.protectedConfig.warning': Record<string, never>
  /** B16: `command` rewrites tracked files without naming them (git checkout, tar x…), so it needs the person each time. */
  'thread.protectedConfig.rewritesTracked': { command: string }
  /** The provider cannot fork its session into a side chat (B1.2). */
  'thread.side.unavailable': Record<string, never>
  /** The conversation has no native session to copy yet: send a message first. */
  'thread.side.noSession': Record<string, never>
  /** F13 · Refusals of a sections save (THREAD_SECTIONS_REFUSALS); a refused save stores nothing. */
  'thread.sections.invalid': Record<string, never>
  'thread.sections.tooMany': { sections: number; assignments: number }
  'thread.sections.nameEmpty': Record<string, never>
  'thread.sections.nameTooLong': { max: number }
  'thread.sections.nameHidden': Record<string, never>
  /** `name` is the second section's name, trimmed, as the person typed it. */
  'thread.sections.nameDuplicate': { name: string }
  'thread.sections.unknownWorkspace': Record<string, never>
  'thread.commands.configure': Record<string, never>
  'thread.commands.busy': Record<string, never>
  'thread.commands.claudeFailed': Record<string, never>
  'thread.commands.codexFailed': Record<string, never>
  'thread.capability.readOnly': Record<string, never>
  'thread.capability.mcpReadOnly': Record<string, never>
  'thread.observe.unsupported': Record<string, never>
  'thread.observe.changed': Record<string, never>
  'thread.queue.deliveryUnconfirmed': Record<string, never>
}

export const THREAD_MESSAGE_CODES = [
  'thread.request.notPending',
  'thread.request.staleGeneration',
  'thread.request.alreadyResponding',
  'thread.request.unanswered',
  'thread.request.guardedDecision',
  'thread.protectedConfig.instructions',
  'thread.protectedConfig.mcp',
  'thread.protectedConfig.hooks',
  'thread.protectedConfig.warning',
  'thread.protectedConfig.rewritesTracked',
  'thread.side.unavailable',
  'thread.side.noSession',
  'thread.sections.invalid',
  'thread.sections.tooMany',
  'thread.sections.nameEmpty',
  'thread.sections.nameTooLong',
  'thread.sections.nameHidden',
  'thread.sections.nameDuplicate',
  'thread.sections.unknownWorkspace',
  'thread.commands.configure',
  'thread.commands.busy',
  'thread.commands.claudeFailed',
  'thread.commands.codexFailed',
  'thread.capability.readOnly',
  'thread.capability.mcpReadOnly',
  'thread.observe.unsupported',
  'thread.observe.changed',
  'thread.queue.deliveryUnconfirmed'
] as const satisfies readonly (keyof ThreadMessageParams)[]
