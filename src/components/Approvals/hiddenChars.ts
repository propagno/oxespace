/**
 * Characters in an agent's text that change how it reads without being seen: bidi controls (an RLO can show
 * `rm -rf /tmp/x` while `/x/pmt/ fr- mr` is what runs), zero-width and other invisible format characters, and the
 * tag characters that can smuggle a whole hidden message. The approval window never lets one take effect: each is
 * replaced by a visible marker such as ⟨U+202E⟩, in the text and in what is copied from it.
 */

/**
 * Bidi controls (U+202A–202E, U+2066–2069, U+200E/200F, U+061C), zero-width and invisible characters (U+200B–200D,
 * U+2060, U+FEFF, U+00AD), every tag character (U+E0000–E007F, assigned or not), the Hangul fillers that render
 * blank, and any other format character (Cf).
 */
const HIDDEN = /[‪-‮⁦-⁩‎‏؜​-‍⁠﻿­ᅟᅠㅤﾠ\u{E0000}-\u{E007F}\p{Cf}]/u
const HIDDEN_ALL = new RegExp(HIDDEN.source, 'gu')

export type TextPiece = { kind: 'text'; text: string } | { kind: 'hidden'; code: string }

/** `U+202E` for an RLO. */
export function codePointLabel(char: string): string {
  return `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`
}

export function hasHiddenChars(text: string): boolean {
  return HIDDEN.test(text)
}

/** The text cut around each hidden character; the hidden ones carry only their code point, never the character. */
export function revealHidden(text: string): TextPiece[] {
  const pieces: TextPiece[] = []
  let last = 0
  for (const match of text.matchAll(HIDDEN_ALL)) {
    const at = match.index ?? 0
    if (at > last) pieces.push({ kind: 'text', text: text.slice(last, at) })
    pieces.push({ kind: 'hidden', code: codePointLabel(match[0]) })
    last = at + match[0].length
  }
  if (last < text.length || !pieces.length) pieces.push({ kind: 'text', text: text.slice(last) })
  return pieces
}
