import { codePointLabel, findHiddenCharacters, hasHiddenCharacters } from '../../../shared/hidden-characters'

/**
 * Characters in an agent's text that change how it reads without being seen (an RLO can show `rm -rf /tmp/x` while
 * `/x/pmt/ fr- mr` is what runs). Which ones count is shared with main (shared/hidden-characters.ts, B10 S2), so the
 * window marks exactly what main flags. The window never lets one take effect: each is replaced by a visible marker
 * such as ⟨U+202E⟩, in the text and in what is copied from it.
 */

export type TextPiece = { kind: 'text'; text: string } | { kind: 'hidden'; code: string }

export { codePointLabel }

export function hasHiddenChars(text: string): boolean {
  return hasHiddenCharacters(text)
}

/** The text cut around each hidden character; the hidden ones carry only their code point, never the character. */
export function revealHidden(text: string): TextPiece[] {
  const pieces: TextPiece[] = []
  let last = 0
  for (const { index, codePoint } of findHiddenCharacters(text)) {
    if (index > last) pieces.push({ kind: 'text', text: text.slice(last, index) })
    pieces.push({ kind: 'hidden', code: codePointLabel(codePoint) })
    last = index + String.fromCodePoint(codePoint).length
  }
  if (last < text.length || !pieces.length) pieces.push({ kind: 'text', text: text.slice(last) })
  return pieces
}
