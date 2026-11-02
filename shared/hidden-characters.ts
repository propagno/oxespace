/**
 * B10 S2 · The ONE list of characters that make shown text differ from what runs: every format character (`\p{Cf}`,
 * which includes the bidi controls and the zero-width ones), the variation selectors (U+FE00–FE0F, U+E0100–E01EF), the
 * whole Tags block (U+E0000–E007F: its unassigned code points are not `Cf` yet render invisibly), and, named explicitly
 * so a reader sees them, U+202A–202E, U+2066–2069, U+200B–200F, U+2060–2064, U+FEFF, U+00AD, U+061C
 * and U+180E, and the Hangul fillers U+115F, U+1160, U+3164 and U+FFA0, which are letters yet render blank.
 *
 * Main uses it to add `approvals.note.hiddenCharacters` and raise the risk (R2); the window uses the same module to make
 * each one visible. Pure, no DOM, no Electron.
 */

/** The code points named above, as inclusive ranges (a single one is its own range). */
const RANGES: ReadonlyArray<readonly [number, number]> = [
  [0xfe00, 0xfe0f], [0xe0000, 0xe007f], [0xe0100, 0xe01ef],
  [0x202a, 0x202e], [0x2066, 0x2069], [0x200b, 0x200f], [0x2060, 0x2064],
  [0xfeff, 0xfeff], [0x00ad, 0x00ad], [0x061c, 0x061c], [0x180e, 0x180e],
  [0x115f, 0x115f], [0x1160, 0x1160], [0x3164, 0x3164], [0xffa0, 0xffa0]
]

/**
 * Also hidden (homologation of #238): every Unicode Default_Ignorable_Code_Point (U+034F grapheme joiner among them),
 * the C0 and C1 controls but tab, line feed and carriage return (NUL, backspace, ESC of an ANSI sequence), the line and
 * paragraph separators U+2028 and U+2029, and U+2800, the braille blank that reads as a space.
 */
const CONTROLS: ReadonlyArray<readonly [number, number]> = [[0x00, 0x08], [0x0b, 0x0c], [0x0e, 0x1f], [0x7f, 0x9f]]
const SEPARATORS: ReadonlyArray<readonly [number, number]> = [[0x2028, 0x2029], [0x2800, 0x2800]]

const escape = (codePoint: number): string => `\\u{${codePoint.toString(16)}}`
const ranges = (list: ReadonlyArray<readonly [number, number]>): string =>
  list.map(([from, to]) => from === to ? escape(from) : `${escape(from)}-${escape(to)}`).join('')

/**
 * The character class body, shared by the patterns below. It is built from the ranges, each code point an escape, so
 * the variation selectors are members on their own and never combine with the character before them.
 */
const CLASS = '\\p{Cf}\\p{Default_Ignorable_Code_Point}' + ranges([...RANGES, ...CONTROLS, ...SEPARATORS])

/**
 * The pattern, one hidden character per match. Three characters are told apart by what surrounds them, so a plain
 * emoji is not a warning: U+FE0E/FE0F right after a pictograph ("❤️") picks its style, and U+200D between two
 * pictographs ("👨‍👩‍👧") joins them; anywhere else they are hidden. A carriage return is hidden alone ("echo safe\rrm -rf /"
 * redraws the line), not as part of a CRLF line ending.
 */
const PATTERN = [
  `(?![\\u{fe0e}\\u{fe0f}\\u{200d}])[${CLASS}]`,
  '(?<!\\p{Extended_Pictographic})[\\u{fe0e}\\u{fe0f}]',
  '(?!(?<=\\p{Extended_Pictographic}\\u{fe0f}?)\\u{200d}\\p{Extended_Pictographic})\\u{200d}',
  '\\r(?!\\n)'
].join('|')

/** Matches one hidden character (no `g` flag, so `.test` keeps no state). */
export const HIDDEN_CHARACTERS = new RegExp(PATTERN, 'u')

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
  return [...text.matchAll(new RegExp(PATTERN, 'gu'))].map(match => ({ index: match.index ?? 0, codePoint: match[0].codePointAt(0)! }))
}

/** `U+202E`-style label for a code point. */
export function codePointLabel(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`
}
