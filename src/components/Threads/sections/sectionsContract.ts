/**
 * F13 · Sections in the conversation list, as the list works with them: one change at a time, over the main
 * process's whole-state channel (shared/types/thread-sections.ts; the adapter is sectionsApi.ts).
 */
import { hasHiddenCharacters } from '../../../../shared/hidden-characters'
import { THREAD_SECTIONS_LIMITS } from '../../../../shared/types/thread-sections'
import type { ConversationThread } from '../../../../shared/types/thread'

export interface ThreadSection {
  id: string
  projectId: string
  name: string
  /** Position inside the project, from 0. */
  order: number
  collapsed: boolean
}

/** A conversation as the list sees it. */
export type SectionedThread = ConversationThread & {
  /** TODO(B1.3): field name of nested conversations; children follow their parent's section. */
  parentThreadId?: string | null
}

/** The changes the list makes, one at a time (sectionsApi.ts saves each as main's whole state). */
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
  /** After a change saved from this window. Returns the unsubscribe function. */
  onSectionsChanged(listener: (event: { projectId: string }) => void): () => void
}

/** Longest section name, in characters, after trimming. Same limit as the main process. */
export const SECTION_NAME_MAX = THREAD_SECTIONS_LIMITS.name

export type SectionErrorCode = 'thread.section.invalidName' | 'thread.section.duplicateName' | 'thread.section.notFound' | 'thread.section.childFollowsParent'
export const SECTION_ERROR_CODES: readonly SectionErrorCode[] = ['thread.section.invalidName', 'thread.section.duplicateName', 'thread.section.notFound', 'thread.section.childFollowsParent']

/** A section failure with its parameters, for the list to word. */
export class SectionError extends Error {
  constructor(readonly code: SectionErrorCode, readonly params: { max?: number } = {}) {
    super(code)
    this.name = 'SectionError'
  }
}

// Control characters; the bidirectional, format and other hidden characters are the shared check main uses.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/

/** The name to store, or null when it breaks the rules (empty, longer than SECTION_NAME_MAX, hidden characters). */
export function normalizeSectionName(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed || [...trimmed].length > SECTION_NAME_MAX || CONTROL.test(trimmed) || hasHiddenCharacters(trimmed)) return null
  return trimmed
}

/** True when two names are the same section name: trimmed, ignoring case, in the same Unicode form. */
export function sameSectionName(a: string, b: string): boolean {
  const key = (name: string): string => name.trim().normalize('NFC').toLocaleLowerCase()
  return key(a) === key(b)
}

/** The section code an error carries: a SectionError, a `{ code }` object from IPC, or the code inside an IPC message. */
export function sectionErrorCode(cause: unknown): SectionErrorCode | null {
  const code = cause && typeof cause === 'object' ? (cause as { code?: unknown }).code : undefined
  if (typeof code === 'string' && (SECTION_ERROR_CODES as readonly string[]).includes(code)) return code as SectionErrorCode
  const message = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : ''
  return SECTION_ERROR_CODES.find(known => message.includes(known)) ?? null
}
