/**
 * F13 · Sections of the conversation list, stored by the main process per workspace.
 *
 * The window saves the whole state at once (`thread.saveSections`) and gets back what was stored: names trimmed,
 * sections renumbered 0…n-1 in their order, and assignments of conversations that no longer exist dropped.
 */
import type { MainMessage } from '../messages'

export interface ThreadSection {
  id: string
  name: string
  /** Position in the list, from 0. Stored values are always 0…n-1. */
  order: number
  /** Whether the list shows the section folded. Optional on save (false); always present when read. */
  collapsed?: boolean
}

export interface ThreadSections {
  sections: ThreadSection[]
  /** Conversation id → section id. A conversation in no section has no entry. */
  assignments: Record<string, string>
}

/** Why a save was refused; each is also a message code (`thread.sections.<reason>`, C3). */
export const THREAD_SECTIONS_REFUSALS = ['invalid', 'tooMany', 'nameEmpty', 'nameTooLong', 'nameHidden', 'nameDuplicate', 'unknownWorkspace'] as const
export type ThreadSectionsRefusal = typeof THREAD_SECTIONS_REFUSALS[number]

/** A refused save stores nothing: the state stays what it was. */
export type ThreadSectionsSaveResult =
  | { ok: true; state: ThreadSections }
  | { ok: false; refusal: ThreadSectionsRefusal; message: MainMessage }

export const THREAD_SECTIONS_LIMITS = {
  workspaceId: 200,
  sectionId: 100,
  conversationId: 200,
  /** Characters (code points) of a name after trimming. */
  name: 60,
  sections: 100,
  assignments: 10_000
} as const
