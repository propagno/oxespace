/**
 * F13 · Sections in the conversation list: the approved contract, renderer side.
 *
 * TODO(CCR F13): `ThreadSection`, `ThreadSectionsApi`, the `sectionId` / `parentThreadId` summary fields and the
 * `thread.section.*` codes move to shared/types/thread.ts, shared/types/ipc.ts (preload) and shared/messages.ts when
 * the contract PR lands. Then delete this file's types, import those, and drop the localStorage mock in sectionsMock.ts.
 */
import type { ConversationThread } from '../../../../shared/types/thread'

export interface ThreadSection {
  id: string
  projectId: string
  name: string
  /** Position inside the project, from 0. */
  order: number
  collapsed: boolean
  createdAt: number
}

/** A conversation as the list sees it once the contract lands. */
export type SectionedThread = ConversationThread & {
  /** null or absent: no section. A child reports its parent's section. */
  sectionId?: string | null
  /** TODO(CCR F13): field name of nested conversations (B1.3); children follow their parent's section. */
  parentThreadId?: string | null
}

/** The methods the contract adds to `window.oxe.thread`. */
export interface ThreadSectionsApi {
  listSections(projectId: string): Promise<ThreadSection[]>
  createSection(input: { projectId: string; name: string }): Promise<ThreadSection>
  renameSection(input: { id: string; name: string }): Promise<ThreadSection>
  /** The section's conversations go back to no section; conversations are never deleted. */
  deleteSection(input: { id: string }): Promise<void>
  /** `ids` must be exactly the project's sections. */
  reorderSections(input: { projectId: string; ids: string[] }): Promise<ThreadSection[]>
  setSectionCollapsed(input: { id: string; collapsed: boolean }): Promise<ThreadSection>
  moveToSection(input: { threadId: string; sectionId: string | null }): Promise<void>
  /** `thread:sections-changed`. Returns the unsubscribe function. */
  onSectionsChanged(listener: (event: { projectId: string }) => void): () => void
}

/** Longest section name, in characters, after trimming. Same limit as the main process. */
export const SECTION_NAME_MAX = 60

export type SectionErrorCode = 'thread.section.invalidName' | 'thread.section.notFound' | 'thread.section.childFollowsParent'
export const SECTION_ERROR_CODES: readonly SectionErrorCode[] = ['thread.section.invalidName', 'thread.section.notFound', 'thread.section.childFollowsParent']

/** A C3 code with its parameters, thrown by the mock the way the main process rejects. */
export class SectionError extends Error {
  constructor(readonly code: SectionErrorCode, readonly params: { max?: number } = {}) {
    super(code)
    this.name = 'SectionError'
  }
}

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/

/** The name to store, or null when it breaks the rules (empty, longer than SECTION_NAME_MAX, control characters). */
export function normalizeSectionName(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed || [...trimmed].length > SECTION_NAME_MAX || CONTROL.test(trimmed)) return null
  return trimmed
}

/** The section code an error carries: a SectionError, a `{ code }` object from IPC, or the code inside an IPC message. */
export function sectionErrorCode(cause: unknown): SectionErrorCode | null {
  const code = cause && typeof cause === 'object' ? (cause as { code?: unknown }).code : undefined
  if (typeof code === 'string' && (SECTION_ERROR_CODES as readonly string[]).includes(code)) return code as SectionErrorCode
  const message = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : ''
  return SECTION_ERROR_CODES.find(known => message.includes(known)) ?? null
}
