/**
 * The one ranker of the command palette: commands, workspaces, agents and file
 * names are all scored here, so a query orders every group the same way.
 * Scores are relative; 0 means "no match".
 */

const WORD_BOUNDARY = /[\s\-_/.:·&()[\]]/

/** Every character of `query` appears in `text` in order ("gtcmt" → "git commit"). */
export function isSubsequence(text: string, query: string): boolean {
  let from = 0
  for (const char of query) {
    const found = text.indexOf(char, from)
    if (found < 0) return false
    from = found + 1
  }
  return true
}

/** File quick-open: basename substring > path substring > ordered subsequence. */
export function fuzzyScore(path: string, query: string): number {
  const q = query.toLowerCase()
  if (!q) return 0
  const hay = path.toLowerCase()
  const base = hay.slice(hay.lastIndexOf('/') + 1)
  const inBase = base.indexOf(q)
  if (inBase >= 0) return 1000 - inBase
  if (hay.includes(q)) return 500
  return isSubsequence(hay, q) ? 100 : 0
}

/**
 * Multi-word ranking of a titled item: every word of the query must match the
 * title (best at the start of a word), the secondary text (detail, keywords,
 * category) or, as a last resort, the title as a subsequence.
 */
export function rankText(primary: string, secondary: string, query: string): number {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!tokens.length) return 1
  const title = primary.toLowerCase()
  const rest = secondary.toLowerCase()
  let total = 0
  for (const token of tokens) {
    const at = title.indexOf(token)
    const score = at === 0 ? 1000
      : at > 0 ? (WORD_BOUNDARY.test(title[at - 1]) ? 800 : 600)
        : rest.includes(token) ? 300
          : isSubsequence(title, token) ? 100 : 0
    if (!score) return 0
    total += score
  }
  // Shorter titles win ties: "Files" before "Find in files" for "fi".
  return total - Math.min(title.length, 100) / 10
}

/** Items that match `query`, best first; the input order breaks ties. Without a query, everything in input order. */
export function rankBy<T>(items: readonly T[], query: string, score: (item: T) => number): T[] {
  if (!query.trim()) return [...items]
  return items.map((item, index) => ({ item, index, score: score(item) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(entry => entry.item)
}
