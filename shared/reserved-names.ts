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
 * The first words a system notice speaks with, refused as a whole word ANYWHERE in a notification's title or body
 * ("Important: System notice", "Notificação do Sistema"). Pane and tab names keep the first-word rule, and the App
 * family stays first-word only everywhere: "the app crashed" is ordinary notice text, and "Update" is not here for the
 * same reason ("System Update" is still caught by System).
 */
export const RESERVED_NOTICE_WORDS = ['System', 'Sistema', 'Administrator', 'Administrador', 'Admin', 'root', 'sudo', 'Security', 'Segurança'] as const satisfies ReadonlyArray<typeof RESERVED_FIRST_WORDS[number]>
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

/**
 * Capitals that read as another Latin letter than their lower case does (Greek Η is H, its η is n), mapped before
 * lower-casing: the Greek and Cyrillic capitals that look Latin, after UTS #39 confusables.
 */
const CONFUSABLE_CAPITALS: Record<string, string> = {
  Α: 'a', Β: 'b', Ε: 'e', Ζ: 'z', Η: 'h', Ι: 'i', Κ: 'k', Μ: 'm', Ν: 'n', Ο: 'o', Ρ: 'p', Τ: 't', Υ: 'y', Χ: 'x', Ω: 'o', Ϲ: 'c', Ϳ: 'j',
  А: 'a', В: 'b', Е: 'e', К: 'k', М: 'm', Н: 'h', О: 'o', Р: 'p', С: 'c', Т: 't', Х: 'x', Ү: 'y', Ѕ: 's', І: 'i', Ј: 'j', Ԛ: 'q', Ԝ: 'w'
}
/**
 * Lower-case letters from other scripts, and Latin letters NFKC keeps (dotless ı, small capitals), that read as a
 * Latin letter: a small UTS #39-style skeleton for these names.
 */
const CONFUSABLE_LETTERS: Record<string, string> = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', х: 'x', у: 'y', і: 'i', ѕ: 's', ԁ: 'd', һ: 'h', ӏ: 'l', к: 'k', м: 'm', т: 't', в: 'b', н: 'h',
  ј: 'j', ԛ: 'q', ԝ: 'w', ѵ: 'v', ү: 'y', п: 'n', ь: 'b',
  α: 'a', ε: 'e', ο: 'o', ρ: 'p', χ: 'x', υ: 'u', ι: 'i', κ: 'k', τ: 't', ν: 'v', η: 'n', μ: 'm', ϲ: 'c', ω: 'w', β: 'b', ζ: 'z', ϳ: 'j',
  ı: 'i', ȷ: 'j', ɑ: 'a', ɡ: 'g', ɩ: 'i', ʋ: 'u',
  ᴀ: 'a', ʙ: 'b', ᴄ: 'c', ᴅ: 'd', ᴇ: 'e', ꜰ: 'f', ɢ: 'g', ʜ: 'h', ɪ: 'i', ᴊ: 'j', ᴋ: 'k', ʟ: 'l', ᴍ: 'm', ɴ: 'n', ᴏ: 'o', ᴘ: 'p',
  ʀ: 'r', ꜱ: 's', ᴛ: 't', ᴜ: 'u', ᴠ: 'v', ᴡ: 'w', ʏ: 'y', ᴢ: 'z'
}
/** Digits and symbols that can stand for a letter ("0XESPACE", "$ystem"). */
const CONFUSABLE_SYMBOLS: Record<string, string> = { '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '$': 's', '@': 'a', '|': 'l', '!': 'l' }

/**
 * What a person does not see as a letter: format characters (zero-width, soft hyphen, bidi, joiners, tags), the
 * default-ignorables (variation selectors, the Hangul fillers ㅤ ᅟ ᅠ ﾠ, the Mongolian vowel separator), and any
 * combining mark NFKC could not compose onto the letter before it.
 */
const INVISIBLE = /[\p{Cf}\p{Default_Ignorable_Code_Point}\p{M}]/gu
/**
 * NFKC, look-alike capitals mapped, lower case, accents dropped. Invisible characters are deleted (`spaced` false:
 * "Win\u200Bdows" is one word) or read as a space (`spaced` true: "Windows\u200BSecurity" is two words), before the
 * accents are split off, so "Systém" is one word either way.
 */
const lowerPlain = (value: string, spaced = false): string =>
  [...value.normalize('NFKC')].map(char => CONFUSABLE_CAPITALS[char] ?? char).join('').toLowerCase()
    .replace(INVISIBLE, spaced ? ' ' : '').normalize('NFD').replace(INVISIBLE, '')
const skeleton = (letters: string): string =>
  [...letters].map(char => CONFUSABLE_LETTERS[char] ?? char).join('').replace(/i/g, 'l').replace(/rn/g, 'm')

/**
 * Folds a name for comparison: NFKC (full-width and styled letters), lower case, accents and invisible format
 * characters removed (deleted, never read as a space: the whole-string fold has no words), everything but letters dropped, then look-alike letters mapped, so "O X E-Spаce!" (with a
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
 * Never longer than the letters it was given, and folding the joined result again changes nothing. With `spaced`, an
 * invisible character between letters splits the word instead of vanishing (the zero-width space in "Windows\u200BSecurity").
 */
export function foldWords(value: string, readSymbols = false, spaced = false): string[] {
  const plain = lowerPlain(value, spaced)
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
const FOLDED_NOTICE = RESERVED_NOTICE_WORDS.map(name => [name, foldName(name)] as const)
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
 * Four folds are checked: with symbols dropped ("System!" is "system") and with symbols read as letters ("$ystem",
 * "W1ndows"), each with invisible characters deleted ("Win\u200Bdows" is one word) and read as a space ("Windows\u200BSecurity"
 * is two), so an invisible separator can neither hide a word inside another nor join two words into one.
 * `scope` 'notice' is for a notification's title and body: the RESERVED_NOTICE_WORDS count as a whole word anywhere
 * (or two adjacent words joined), not only first. 'name' (pane and tab names) keeps the first-word rule.
 */
export function reservedNameIn(value: string, scope: 'name' | 'notice' = 'name'): ReservedAppName | null {
  // Every rule sees every fold before the next rule runs, so the most specific name wins ("OXESp4ce" is OXESpace,
  // found by reading 4 as a, not the "Oxe" prefix of "oxespce").
  const folds = [false, true].flatMap(readSymbols => [false, true].map(spaced => ({ readSymbols, spaced }))).map(({ readSymbols, spaced }) => {
    const words = foldWords(value, readSymbols, spaced)
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
    fold => scope === 'notice' ? FOLDED_NOTICE.find(([, reserved]) => fold.candidates.includes(reserved))?.[0] : undefined,
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
export function withoutReservedName(text: string, fallback: string, scope: 'name' | 'notice' = 'name'): string {
  return reservedNameIn(text, scope) ? fallback : text
}
