/**
 * F13 · The one validator of a sections save, pure, used by the main process and by the E2E mock.
 * Anything that is not exactly a `ThreadSections` is refused with a C3 code; nothing is guessed or repaired,
 * except the normalization the contract names (trim, renumbering, dropping assignments of gone conversations).
 */
import { hasHiddenCharacters } from './hidden-characters'
import { mainMessage, type MainMessage } from './messages'
import { THREAD_SECTIONS_LIMITS as LIMITS, type ThreadSection, type ThreadSections, type ThreadSectionsRefusal, type ThreadSectionsSaveResult } from './types/thread-sections'

/** C0 and C1 control characters (tab and newline included: a name is one line). */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/
const SECTION_KEYS = new Set(['id', 'name', 'order', 'collapsed'])
const STATE_KEYS = new Set(['sections', 'assignments'])

export function threadSectionsRefusal(refusal: ThreadSectionsRefusal, name?: string): Extract<ThreadSectionsSaveResult, { ok: false }> {
  const message: MainMessage = refusal === 'nameTooLong' ? mainMessage('thread.sections.nameTooLong', { max: LIMITS.name })
    : refusal === 'tooMany' ? mainMessage('thread.sections.tooMany', { sections: LIMITS.sections, assignments: LIMITS.assignments })
      : refusal === 'nameDuplicate' ? mainMessage('thread.sections.nameDuplicate', { name: name ?? '' })
        : mainMessage(`thread.sections.${refusal}`, {})
  return { ok: false, refusal, message }
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function identifier(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !CONTROL.test(value) && !hasHiddenCharacters(value)
}

/** A workspace id the store may look up: non-empty, at most 200 characters, no control or hidden characters. */
export function isThreadSectionsWorkspaceId(value: unknown): value is string {
  return identifier(value, LIMITS.workspaceId)
}

/** The key two names are compared by: the same name ignoring case and Unicode form. */
export function sectionNameKey(name: string): string {
  return name.trim().normalize('NFC').toLowerCase()
}

type NameCheck = { ok: true; name: string } | { ok: false; refusal: ThreadSectionsRefusal }

function sectionName(value: unknown): NameCheck {
  if (typeof value !== 'string') return { ok: false, refusal: 'invalid' }
  const name = value.trim()
  if (!name) return { ok: false, refusal: 'nameEmpty' }
  if (CONTROL.test(name) || hasHiddenCharacters(name)) return { ok: false, refusal: 'nameHidden' }
  if ([...name].length > LIMITS.name) return { ok: false, refusal: 'nameTooLong' }
  return { ok: true, name }
}

/**
 * Checks a whole sections state and returns it normalized: names trimmed, sections sorted by `order` (ties keep
 * the payload's order) and renumbered from 0, `collapsed` false when absent, and assignments kept only for the
 * conversations `conversationExists` knows. The first rule broken, in payload order, is the refusal.
 */
export function normalizeThreadSections(input: unknown, conversationExists: (conversationId: string) => boolean): ThreadSectionsSaveResult {
  if (!plainObject(input) || Object.keys(input).some(key => !STATE_KEYS.has(key))) return threadSectionsRefusal('invalid')
  const { sections, assignments } = input
  if (!Array.isArray(sections) || !plainObject(assignments)) return threadSectionsRefusal('invalid')
  const assigned = Object.keys(assignments)
  if (sections.length > LIMITS.sections || assigned.length > LIMITS.assignments) return threadSectionsRefusal('tooMany')

  const ids = new Set<string>()
  const names = new Set<string>()
  const checked: (Required<ThreadSection> & { index: number })[] = []
  for (const [index, section] of sections.entries()) {
    if (!plainObject(section) || Object.keys(section).some(key => !SECTION_KEYS.has(key))) return threadSectionsRefusal('invalid')
    const { id, order, collapsed } = section
    if (!identifier(id, LIMITS.sectionId) || ids.has(id)) return threadSectionsRefusal('invalid')
    if (!Number.isSafeInteger(order) || (order as number) < 0) return threadSectionsRefusal('invalid')
    if (collapsed !== undefined && typeof collapsed !== 'boolean') return threadSectionsRefusal('invalid')
    const name = sectionName(section.name)
    if (!name.ok) return threadSectionsRefusal(name.refusal)
    const key = sectionNameKey(name.name)
    if (names.has(key)) return threadSectionsRefusal('nameDuplicate', name.name)
    ids.add(id)
    names.add(key)
    checked.push({ id, name: name.name, order: order as number, collapsed: collapsed ?? false, index })
  }

  const kept: [string, string][] = []
  for (const conversationId of assigned) {
    const sectionId = assignments[conversationId]
    if (!identifier(conversationId, LIMITS.conversationId) || typeof sectionId !== 'string' || !ids.has(sectionId)) return threadSectionsRefusal('invalid')
    if (conversationExists(conversationId)) kept.push([conversationId, sectionId])
  }

  const ordered = checked.sort((a, b) => a.order - b.order || a.index - b.index)
    .map(({ id, name, collapsed }, order): Required<ThreadSection> => ({ id, name, order, collapsed }))
  const state: ThreadSections = { sections: ordered, assignments: Object.fromEntries(kept.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) }
  return { ok: true, state }
}

export function emptyThreadSections(): ThreadSections {
  return { sections: [], assignments: {} }
}
