/**
 * B10 · Names only the app speaks as, and how agent-supplied text is checked for them. No imports: the window's
 * notices use it, and it must stay small in the renderer entry.
 */

/** Names only the app speaks as. An agent-chosen pane name, label or notification title may not contain one. */
export const RESERVED_APP_NAMES = ['OXESpace', 'OxeChat', 'OxeCode', 'OxeQuery', 'OxePod', 'OxePost'] as const
/** Generic words the app's own notices could be taken for; refused only as the whole name ("filesystem" stays allowed). */
export const RESERVED_EXACT_NAMES = ['System', 'Sistema', 'App', 'Aplicativo', 'Application'] as const
export type ReservedAppName = typeof RESERVED_APP_NAMES[number] | typeof RESERVED_EXACT_NAMES[number]

/** Letters from other scripts that read as a Latin letter (a small UTS #39-style skeleton for these names). */
const CONFUSABLE_LETTERS: Record<string, string> = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', х: 'x', у: 'y', і: 'i', ѕ: 's', ԁ: 'd', һ: 'h', ӏ: 'l', к: 'k', м: 'm', т: 't', в: 'b', н: 'h',
  α: 'a', ε: 'e', ο: 'o', ρ: 'p', χ: 'x', υ: 'u', ι: 'i', κ: 'k', τ: 't', ν: 'v', η: 'n', μ: 'm', ϲ: 'c'
}
/** Digits and symbols that can stand for a letter ("0XESPACE", "$ystem"). */
const CONFUSABLE_SYMBOLS: Record<string, string> = { '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '$': 's', '@': 'a', '|': 'l', '!': 'l' }

const lowerPlain = (value: string): string => value.normalize('NFKC').toLowerCase().normalize('NFD').replace(/[\p{M}\p{Cf}]/gu, '')
const skeleton = (letters: string): string =>
  [...letters].map(char => CONFUSABLE_LETTERS[char] ?? char).join('').replace(/i/g, 'l').replace(/rn/g, 'm')

/**
 * Folds a name for comparison: NFKC (full-width and styled letters), lower case, accents and invisible format
 * characters removed, everything but letters dropped, then look-alike letters mapped, so "O X E-Spаce!" (with a
 * Cyrillic а) and "ＯＸＥＳＰＡＣＥ" fold the same as "OXESpace". `i` and `l` fold together, as do `rn` and `m`.
 * Never longer than the letters it was given, and folding twice changes nothing.
 */
export function foldName(value: string): string {
  return skeleton(lowerPlain(value).replace(/[^\p{L}]/gu, ''))
}

/** The same fold, reading digits and symbols as the letters they imitate first ("0XESPACE", "$ystem"). */
function foldNameWithSymbols(value: string): string {
  return skeleton([...lowerPlain(value)].map(char => CONFUSABLE_SYMBOLS[char] ?? char).join('').replace(/[^\p{L}]/gu, ''))
}

const FOLDED_RESERVED = RESERVED_APP_NAMES.map(name => [name, foldName(name)] as const)
const FOLDED_EXACT = RESERVED_EXACT_NAMES.map(name => [name, foldName(name)] as const)

/**
 * The reserved name hidden in `value`, if any. Product names by containment, so "OXESpace: security update" is
 * caught; the generic words by equality. Both folds are checked: with symbols dropped ("System!" is "system") and
 * with symbols read as letters ("$ystem" is "system").
 */
export function reservedNameIn(value: string): ReservedAppName | null {
  for (const folded of [foldName(value), foldNameWithSymbols(value)]) {
    const found = FOLDED_RESERVED.find(([, reserved]) => folded.includes(reserved))?.[0]
      ?? FOLDED_EXACT.find(([, reserved]) => folded === reserved)?.[0]
    if (found) return found
  }
  return null
}

/**
 * For notices the app composes around agent-supplied text (a pane name, a conversation title, an error): the text, or
 * `fallback` when it carries a reserved name. The app's own fixed words around it are not checked.
 */
export function withoutReservedName(text: string, fallback: string): string {
  return reservedNameIn(text) ? fallback : text
}
