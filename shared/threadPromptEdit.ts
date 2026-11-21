import type { ThreadSnapshot } from './types/thread'

/** The prompt the person may edit: the latest turn's, named by the turn and by its user message (the same id). */
export interface EditablePrompt { turnId: string; messageId: string }

/**
 * The prompt of the latest turn, once that turn ended, while the conversation is neither running nor waiting, the native
 * CLI does not own it and that turn was not edited already; otherwise null. The window shows "Editar" from this same
 * function and main refuses an edit with it (OXE-167, AG-10 §2.1). An edit is a new turn: the agent's session is never
 * rewound (Rewind left 1.5.0), and the edited turn stays in the history, marked with `editedInto`.
 */
export function editablePrompt(snapshot: Pick<ThreadSnapshot, 'thread' | 'turns'> | null | undefined): EditablePrompt | null {
  const thread = snapshot?.thread, turn = snapshot?.turns?.at(-1)
  if (!thread || !turn || turn.status === 'running' || turn.editedInto) return null
  if (thread.status !== 'idle' && thread.status !== 'failed' && thread.status !== 'interrupted') return null
  if (thread.cliActive) return null
  return { turnId: turn.id, messageId: turn.id }
}
