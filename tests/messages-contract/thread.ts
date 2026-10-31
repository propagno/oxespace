import type { ThreadMessageParams } from '../../shared/messages/thread'

/** The parameter names each thread code carries, as the catalogs must interpolate them (C3 contract, S0.1 part 2b). */
export const THREAD_PARAMETERS: Record<keyof ThreadMessageParams, string[]> = {
  'thread.request.notPending': [],
  'thread.request.staleGeneration': [],
  'thread.request.alreadyResponding': [],
  'thread.request.unanswered': [],
  'thread.request.guardedDecision': [],
  'thread.protectedConfig.instructions': ['path'],
  'thread.protectedConfig.mcp': ['path'],
  'thread.protectedConfig.hooks': ['path'],
  'thread.protectedConfig.warning': [],
  'thread.protectedConfig.rewritesTracked': ['command'],
  'thread.side.unavailable': [],
  'thread.side.noSession': [],
  'thread.sections.invalid': [],
  'thread.sections.tooMany': ['assignments', 'sections'],
  'thread.sections.nameEmpty': [],
  'thread.sections.nameTooLong': ['max'],
  'thread.sections.nameHidden': [],
  'thread.sections.nameDuplicate': ['name'],
  'thread.sections.unknownWorkspace': [],
  'thread.commands.configure': [],
  'thread.commands.busy': [],
  'thread.commands.claudeFailed': [],
  'thread.commands.codexFailed': [],
  'thread.capability.readOnly': [],
  'thread.capability.mcpReadOnly': [],
  'thread.observe.unsupported': [],
  'thread.observe.changed': [],
  'thread.queue.deliveryUnconfirmed': []
}
