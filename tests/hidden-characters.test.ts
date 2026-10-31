import { describe, expect, it } from 'vitest'
import { codePointLabel, findHiddenCharacters, hasHiddenCharacters, HIDDEN_CHARACTERS } from '../shared/hidden-characters'
import { hasHiddenCharacters as fromRules } from '../shared/approval-rules'

/** B10 S2 · One list for main (R2) and the window; a sample from each range. */
describe('hidden characters', () => {
  it.each([
    ['U+202A–202E bidi embeddings and overrides', [0x202a, 0x202c, 0x202e]],
    ['U+2066–2069 bidi isolates', [0x2066, 0x2069]],
    ['U+200B–200F zero-width and direction marks', [0x200b, 0x200d, 0x200f]],
    ['U+2060–2064 word joiner and invisible operators', [0x2060, 0x2064]],
    ['U+FEFF byte order mark', [0xfeff]],
    ['U+00AD soft hyphen', [0x00ad]],
    ['U+061C Arabic letter mark', [0x061c]],
    ['U+180E Mongolian vowel separator', [0x180e]],
    ['other \\p{Cf}: U+0600 Arabic number sign, U+206A, U+E0001 language tag, U+E0041 tag A', [0x0600, 0x206a, 0xe0001, 0xe0041]],
    ['U+FE00–FE0F variation selectors', [0xfe00, 0xfe0f]],
    ['U+E0100–E01EF supplementary variation selectors', [0xe0100, 0xe01ef]]
  ])('finds %s', (_name, codePoints) => {
    for (const codePoint of codePoints) {
      const text = `SELECT 1${String.fromCodePoint(codePoint)}; -- ok`
      expect(hasHiddenCharacters(text), codePointLabel(codePoint)).toBe(true)
      expect(findHiddenCharacters(text), codePointLabel(codePoint)).toEqual([{ index: 8, codePoint }])
    }
  })

  it('leaves ordinary text alone, including accents, CJK and emoji without joiners', () => {
    for (const text of ['SELECT 1', 'Ação é válida', '日本語のテキスト', 'tab\tand\nnewline', '😀 done', '']) expect(hasHiddenCharacters(text), text).toBe(false)
  })

  it('lists every one, in order, with UTF-16 offsets the window can slice by', () => {
    const text = `a‮b\u{E0100}c​d`
    expect(findHiddenCharacters(text)).toEqual([{ index: 1, codePoint: 0x202e }, { index: 3, codePoint: 0xe0100 }, { index: 6, codePoint: 0x200b }])
    expect(findHiddenCharacters(text).map(found => codePointLabel(found.codePoint))).toEqual(['U+202E', 'U+E0100', 'U+200B'])
  })

  it('keeps no state between calls, and approval-rules re-exports the same helper', () => {
    expect(HIDDEN_CHARACTERS.flags).not.toContain('g')
    for (let index = 0; index < 3; index++) expect(hasHiddenCharacters('x‮y')).toBe(true)
    expect(fromRules).toBe(hasHiddenCharacters)
  })
})
