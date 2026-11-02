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
    ['Hangul fillers U+115F, U+1160, U+3164, U+FFA0', [0x115f, 0x1160, 0x3164, 0xffa0]],
    ['other \\p{Cf}: U+0600 Arabic number sign, U+206A, U+E0001 language tag, U+E0041 tag A', [0x0600, 0x206a, 0xe0001, 0xe0041]],
    ['U+E0000–E007F Tags block, unassigned ones too: U+E0000, U+E0002, U+E001F, U+E007F', [0xe0000, 0xe0002, 0xe001f, 0xe007f]],
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

/** Homologation of #238 (e2e/homologation/probes/hidden-characters-probe.mts.txt): the probe's cases, each as a test. */
describe('hidden characters: the homologation probe', () => {
  it.each([
    ['RLO', 'rm -rf ~ #‮txt.etadpu'], ['LRO', 'a‭b'], ['RLI/PDI', 'a⁧b⁩'], ['LRM', 'a‎b'], ['RLM', 'a‏b'],
    ['ALM', 'a؜b'], ['ZWSP', 'DELETE​ FROM'], ['ZWNJ', 'a‌b'], ['ZWJ', 'a‍b'], ['WJ', 'a⁠b'], ['BOM', '﻿DROP TABLE'],
    ['soft hyphen', 'DE­LETE'], ['tag characters', 'ok\u{E0049}\u{E0047}\u{E004E}'], ['variation selector', 'a️b'],
    ['supplementary variation selector', 'a\u{E0100}b'], ['Hangul filler', 'aㅤb'], ['halfwidth filler', 'aﾠb'], ['Mongolian vowel separator', 'a᠎b'],
    ['interlinear annotation', 'a￹b'], ['line separator', 'a b'], ['paragraph separator', 'a b'], ['NUL', 'a\u0000b'],
    ['ESC of an ANSI sequence', 'a\u001b[31mred'], ['carriage return alone', 'echo safe\rrm -rf /'], ['backspace', 'safe\u0008\u0008\u0008rm'],
    ['combining grapheme joiner', 'a͏b'], ['braille blank', 'a⠀b'], ['a C1 control', 'a\u0085b'], ['a variation selector after a digit', '1️']
  ])('finds %s', (_name, text) => {
    expect(hasHiddenCharacters(text)).toBe(true)
    expect(findHiddenCharacters(text).length).toBeGreaterThan(0)
  })

  it.each([
    ['plain SQL', 'SELECT 1'], ['accents', 'ação São João'], ['emoji with a skin tone', 'ok 🔥👍🏽'], ['an emoji style selector', 'I ❤️ it'],
    ['an emoji family joined by ZWJ', '👨‍👩‍👧'], ['a CRLF line ending', 'line1\r\nline2'], ['tab and newline', 'a\tb\nc'],
    ['a no-break space (visible)', 'a b'], ['an ideographic space (visible)', 'a　b']
  ])('leaves %s alone', (_name, text) => {
    expect(hasHiddenCharacters(text)).toBe(false)
    expect(findHiddenCharacters(text)).toEqual([])
  })

  it('points at the hidden one inside an emoji-like run: a ZWJ before a letter, a lone carriage return', () => {
    expect(findHiddenCharacters('👨‍x')).toEqual([{ index: 2, codePoint: 0x200d }])
    expect(findHiddenCharacters('a\rb\r\nc')).toEqual([{ index: 1, codePoint: 0x0d }])
  })
})

describe('T46 · a ZWJ is part of an emoji only inside a recognized (RGI) sequence', () => {
  it.each([
    ['a family', '\u{1F468}‍\u{1F469}‍\u{1F467}'],
    ['the rainbow flag', '\u{1F3F3}️‍\u{1F308}'],
    ['a technologist', '\u{1F9D1}‍\u{1F4BB}'],
    ['a family in a sentence', 'ok \u{1F468}‍\u{1F469}‍\u{1F467} ok']
  ])('%s is not marked', (_name, text) => {
    expect(hasHiddenCharacters(text)).toBe(false)
    expect(findHiddenCharacters(text)).toEqual([])
  })

  it.each([
    ['two pictographs that form no emoji', '\u{1F525}‍\u{1F525}', 2],
    ['copyright and registered', '©‍®', 1],
    ['next to an unassigned code point', '\u{1F468}‍\u{1FAFF}', 2],
    ['next to a letter', '\u{1F468}‍x', 2],
    ['at the start of the text', '‍\u{1F468}', 0],
    ['at the end of the text', '\u{1F468}‍', 2]
  ])('a ZWJ %s is marked', (_name, text, index) => {
    expect(hasHiddenCharacters(text)).toBe(true)
    expect(findHiddenCharacters(text)).toEqual([{ index, codePoint: 0x200d }])
  })

  it('stays linear on emoji-heavy text, the size main checks before bounding agent text (SECURITY on #436)', () => {
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}'
    const text = family.repeat(Math.ceil(256_000 / family.length))
    const started = performance.now()
    expect(hasHiddenCharacters(text)).toBe(false)
    // Quadratic took ~3 s here; linear is well under 0.5 s even on a loaded runner.
    expect(performance.now() - started).toBeLessThan(1_500)
  })

  it('a recognized emoji does not hide a joiner elsewhere in the same text', () => {
    expect(findHiddenCharacters('\u{1F9D1}‍\u{1F4BB} DROP‍TABLE')).toEqual([{ index: 10, codePoint: 0x200d }])
  })
})
