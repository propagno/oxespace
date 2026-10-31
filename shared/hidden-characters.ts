/**
 * B10 S2 · The ONE list of characters that make shown text differ from what runs: every format character (`\p{Cf}`,
 * which includes the bidi controls and the zero-width ones), the variation selectors (U+FE00–FE0F, U+E0100–E01EF), the
 * whole Tags block (U+E0000–E007F: its unassigned code points are not `Cf` yet render invisibly), and, named explicitly
 * so a reader sees them, U+202A–202E, U+2066–2069, U+200B–200F, U+2060–2064, U+FEFF, U+00AD, U+061C
 * and U+180E.
 *
 * Main uses it to add `approvals.note.hiddenCharacters` and raise the risk (R2); the window uses the same module to make
 * each one visible. Pure, no DOM, no Electron.
 */

/** The character class body, shared by the patterns below. */
const CLASS = '\\p{Cf}\\uFE00-\\uFE0F\\u{E0000}-\\u{E007F}\\u{E0100}-\\u{E01EF}\\u202A-\\u202E\\u2066-\\u2069\\u200B-\\u200F\\u2060-\\u2064\\uFEFF\\u00AD\\u061C\\u180E'

/** Matches one hidden character (no `g` flag, so `.test` keeps no state). */
export const HIDDEN_CHARACTERS = new RegExp(`[${CLASS}]`, 'u')

export function hasHiddenCharacters(text: string): boolean {
  return HIDDEN_CHARACTERS.test(text)
}

export interface HiddenCharacter {
  /** UTF-16 offset in the text, as `String.prototype.slice` counts. */
  index: number
  /** The code point, for a visible label such as `U+202E`. */
  codePoint: number
}

/** Every hidden character in the text, in order; the window draws a visible marker for each. */
export function findHiddenCharacters(text: string): HiddenCharacter[] {
  return [...text.matchAll(new RegExp(`[${CLASS}]`, 'gu'))].map(match => ({ index: match.index ?? 0, codePoint: match[0].codePointAt(0)! }))
}

/** `U+202E`-style label for a code point. */
export function codePointLabel(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`
}
