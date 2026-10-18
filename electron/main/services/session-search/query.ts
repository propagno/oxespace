/**
 * Turns what a person types into FTS5 match expressions. User input is never
 * passed through as FTS syntax: every term is quoted, so `AND`, `NEAR`, `-`
 * or an unbalanced quote cannot change the query's meaning or make it throw.
 */
export interface ParsedSessionQuery {
  terms: string[]
  /** Substring filters from `repo:` and `path:` operators. */
  scopes: string[]
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'it', 'o', 'a', 'os', 'as', 'de', 'do', 'da', 'em', 'um', 'uma', 'que', 'e'
])
const MAX_TERMS = 24

export function parseSessionQuery(raw: string): ParsedSessionQuery {
  const scopes: string[] = []
  const words: string[] = []
  // Quoted phrases stay one unit; operators are lifted out before tokenising.
  const re = /(?:repo|path):(?:"([^"]*)"|(\S+))|"([^"]+)"|(\S+)/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(raw)) !== null) {
    if (/^(repo|path):/i.test(match[0])) {
      const value = (match[1] ?? match[2] ?? '').trim()
      if (value) scopes.push(value)
    } else {
      words.push((match[3] ?? match[4] ?? '').trim())
    }
  }

  const terms: string[] = []
  for (const word of words) {
    const cleaned = word.replace(/["*^(){}[\]:]/g, ' ').trim()
    if (!cleaned) continue
    for (const piece of cleaned.split(/\s+/)) {
      if (piece.length < 2 && !/[0-9]/.test(piece)) continue
      terms.push(piece)
    }
  }
  const meaningful = terms.filter((t) => !STOP_WORDS.has(t.toLowerCase()))
  return { terms: (meaningful.length > 0 ? meaningful : terms).slice(0, MAX_TERMS), scopes }
}

const quote = (term: string): string => `"${term.replace(/"/g, '""')}"`

/** Match expressions from strictest to loosest; the caller stops at the first with hits. */
export function buildMatchLadder(terms: string[]): Array<{ mode: 'phrase' | 'all' | 'any'; match: string }> {
  if (terms.length === 0) return []
  const last = terms.length - 1
  const prefixed = terms.map((t, i) => (i === last ? `${quote(t)}*` : quote(t)))
  if (terms.length === 1) return [{ mode: 'all', match: prefixed[0] }]
  return [
    { mode: 'phrase', match: quote(terms.join(' ')) },
    { mode: 'all', match: prefixed.join(' AND ') },
    { mode: 'any', match: prefixed.join(' OR ') }
  ]
}
