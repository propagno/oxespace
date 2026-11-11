// Frozen acceptance test for 1.5.0 A69 (OXE program, phase F9): the copy rule for text main builds. The cockpit shows
// main's C3 messages (refusals, toasts, dialogs), so each one, in en and pt-BR, is at most 20 words, as the window's
// own text is (FE and HML own the screen walk). Reads the locale data files, never source code.
// Written by the planner; the executor must not edit it. DESIGN writes the shorter texts.
// CCR: docs/roadmap-1.5/ccr-f9-panels.md §A69; DESIGN 1.5.0-f9-design.md U9.7.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const LOCALES = ['en', 'pt-BR'] as const
const words = (text: string) => text.split(/\s+/).filter(Boolean).length

/** Every message of a locale file, by its dotted key. */
function messages(locale: string): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const walk = (node: unknown, prefix: string) => {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (typeof value === 'string') out.push([prefix + key, value])
      else if (value && typeof value === 'object') walk(value, `${prefix}${key}.`)
    }
  }
  walk(JSON.parse(readFileSync(join(process.cwd(), 'shared/locales', locale, 'main.json'), 'utf8')), '')
  return out
}

describe('A69 · main\'s copy', () => {
  test('A69: the counter counts what a person reads (placeholders are one word each)', () => {
    expect(words('Restore to {time}? Later messages are set aside.')).toBe(8)
    expect(words('  two\n words ')).toBe(2)
    // The path is live: both files have messages.
    for (const locale of LOCALES) expect(messages(locale).length, locale).toBeGreaterThan(100)
  })

  test('A69: every main message is at most 20 words, in en and pt-BR', () => {
    for (const locale of LOCALES) {
      const over = messages(locale).filter(([, text]) => words(text) > 20).map(([key, text]) => `${key} (${words(text)})`)
      expect(over, locale).toEqual([])
    }
  })
})
