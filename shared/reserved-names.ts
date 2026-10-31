/**
 * B10 · Names only the app speaks as, and how agent-supplied text is checked for them. No imports: the window's
 * notices use it, and it must stay small in the renderer entry.
 */

/** Names only the app speaks as. An agent-chosen pane name, label or notification title may not contain one. */
export const RESERVED_APP_NAMES = ['OXESpace', 'OxeChat', 'OxeCode', 'OxeQuery', 'OxePod', 'OxePost'] as const
/**
 * Operating-system and vendor names a request could pass for ("Windows Security"); refused as a whole word anywhere
 * in the name, so "Linuxbrew" and "Applesauce" stay allowed.
 */
export const RESERVED_VENDOR_NAMES = ['Windows', 'Microsoft', 'Ubuntu', 'Linux', 'macOS', 'Apple', 'Google', 'GitHub', 'Debian', 'Fedora', 'GNOME', 'KDE', 'polkit'] as const
/** Words the app's or the system's own notices start with; refused as the first word ("System Administrator", "root access"). */
export const RESERVED_FIRST_WORDS = ['System', 'Sistema', 'Administrator', 'Administrador', 'Admin', 'Aplicação', 'Aplicativo', 'Application', 'App', 'root', 'sudo', 'Security', 'Segurança'] as const
/**
 * Prefixes a first word may not start with, after the fold: the admin family ("Administração", "Admins"; not "Admiral",
 * "Admit") and the app's own "Oxe" ("OxeBot", "OXE"; not "Ox", "Boxer").
 */
export const RESERVED_FIRST_WORD_PREFIXES = ['Admin', 'Oxe'] as const
/** Real words the "Oxe" prefix would catch; allowed exactly as the first word, whatever follows ("Oxente bot"). */
export const OXE_PREFIX_ALLOWED_WORDS = ['Oxente', 'Oxen', 'Oxeye'] as const
/** The app's internal tab names; refused only as the whole name ("Code reviewer" and "Chatbot" stay allowed). */
export const RESERVED_EXACT_NAMES = ['Thread', 'Code', 'Chat'] as const
export type ReservedAppName =
  | typeof RESERVED_APP_NAMES[number] | typeof RESERVED_VENDOR_NAMES[number] | typeof RESERVED_FIRST_WORDS[number]
  | typeof RESERVED_FIRST_WORD_PREFIXES[number] | typeof RESERVED_EXACT_NAMES[number]

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

const withSymbols = (value: string): string => [...value].map(char => CONFUSABLE_SYMBOLS[char] ?? char).join('')

/** The same fold, reading digits and symbols as the letters they imitate first ("0XESPACE", "$ystem"). */
function foldNameWithSymbols(value: string): string {
  return skeleton(withSymbols(lowerPlain(value)).replace(/[^\p{L}]/gu, ''))
}

/** A run of at least this many single letters is one spelled-out word ("W i n d o w s"); two ("A B testing") is not. */
export const SPELLED_WORD_MIN = 3

/**
 * Folds a name word by word: the same normalisation and skeleton as `foldName`, but split on anything that is not a
 * letter, so word boundaries survive. A run of SPELLED_WORD_MIN or more single letters, whatever separates them
 * ("W i n-d.o w s", "W_i_n_d_o_w_s"), is joined into one word first; shorter runs and longer words are left alone.
 * Never longer than the letters it was given, and folding the joined result again changes nothing.
 */
export function foldWords(value: string, readSymbols = false): string[] {
  const plain = lowerPlain(value)
  const tokens = (readSymbols ? withSymbols(plain) : plain).split(/[^\p{L}]+/u).filter(Boolean)
  const words: string[] = []
  for (let index = 0; index < tokens.length;) {
    let end = index
    while (end < tokens.length && [...tokens[end]].length === 1) end++
    if (end - index >= SPELLED_WORD_MIN) { words.push(tokens.slice(index, end).join('')); index = end; continue }
    if (end > index) { words.push(...tokens.slice(index, end)); index = end; continue }
    words.push(tokens[index++])
  }
  return words.map(skeleton)
}

const FOLDED_RESERVED = RESERVED_APP_NAMES.map(name => [name, foldName(name)] as const)
const FOLDED_VENDOR = RESERVED_VENDOR_NAMES.map(name => [name, foldName(name)] as const)
const FOLDED_FIRST = RESERVED_FIRST_WORDS.map(name => [name, foldName(name)] as const)
// Folded too: `i` reads as `l`, so "Admin" is the prefix "admln".
const FOLDED_PREFIXES = RESERVED_FIRST_WORD_PREFIXES.map(name => [name, foldName(name)] as const)
const FOLDED_OXE = foldName('Oxe')
const FOLDED_OXE_ALLOWED = new Set(OXE_PREFIX_ALLOWED_WORDS.map(foldName))
const FOLDED_EXACT = RESERVED_EXACT_NAMES.map(name => [name, foldName(name)] as const)

/**
 * The reserved name hidden in `value`, if any:
 *   product names   by containment anywhere in the whole-string fold ("OXESpace: security update", "O.X.E Space")
 *   OS and vendors  as a whole word, or two adjacent words joined ("Windows Security", "W i n d o w s", "Win dows";
 *                   not "Linuxbrew", "Win dow manager")
 *   generic words   as the first word ("System Administrator", "Sistema operacional", "root access")
 *   prefixes        a first word starting with one ("Administração", "OxeBot"; not "Admiral", "Ox", nor the real
 *                   words Oxente, Oxen and Oxeye)
 * The first-word and prefix rules also read the first two words joined ("Sys tem", "Ad min", "OX E").
 *   tab names       as the whole name only ("Thread"; not "Code reviewer")
 * Both folds are checked: with symbols dropped ("System!" is "system") and with symbols read as letters ("$ystem",
 * "W1ndows").
 */
export function reservedNameIn(value: string): ReservedAppName | null {
  // Every rule sees both folds before the next rule runs, so the most specific name wins ("OXESp4ce" is OXESpace,
  // found by reading 4 as a, not the "Oxe" prefix of "oxespce").
  const folds = [false, true].map(readSymbols => {
    const words = foldWords(value, readSymbols)
    // A vendor split in two ("Win dows", "Git Hub") is still that vendor; only an exact match counts, never containment.
    const firsts = words.length > 1 ? [words[0], skeleton(words[0] + words[1])] : words.slice(0, 1)
    return { whole: readSymbols ? foldNameWithSymbols(value) : foldName(value), words, firsts, candidates: [...words, ...words.slice(1).map((word, index) => skeleton(words[index] + word))] }
  })
  /** A first word (alone or joined with the next) starting with the prefix; an allowlisted real word escapes "Oxe". */
  const startsWith = (fold: typeof folds[number], prefix: string): boolean => {
    if (prefix === FOLDED_OXE && FOLDED_OXE_ALLOWED.has(fold.words[0])) return false
    return fold.firsts.some(first => first.startsWith(prefix) && !(prefix === FOLDED_OXE && FOLDED_OXE_ALLOWED.has(first)))
  }
  const rules: Array<(fold: typeof folds[number]) => ReservedAppName | undefined> = [
    fold => FOLDED_RESERVED.find(([, reserved]) => fold.whole.includes(reserved))?.[0],
    fold => FOLDED_VENDOR.find(([, reserved]) => fold.candidates.includes(reserved))?.[0],
    fold => FOLDED_FIRST.find(([, reserved]) => fold.firsts.includes(reserved))?.[0],
    fold => FOLDED_PREFIXES.find(([, prefix]) => startsWith(fold, prefix))?.[0],
    fold => FOLDED_EXACT.find(([, reserved]) => fold.whole === reserved)?.[0]
  ]
  for (const rule of rules) {
    for (const fold of folds) {
      const found = rule(fold)
      if (found) return found
    }
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
