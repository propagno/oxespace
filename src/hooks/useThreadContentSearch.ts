import { useEffect, useMemo, useState } from 'react'

const MIN_QUERY_CHARS = 3
const DEBOUNCE_MS = 350

const EMPTY: ReadonlySet<string> = new Set()
const NO_MATCHES: ReadonlyMap<string, ThreadContentMatch> = new Map()

/** Where a conversation's content matched: the index's snippet (matches wrapped in `[` `]`) and who said it. */
export interface ThreadContentMatch { snippet: string; role: 'user' | 'assistant' }

/** A snippet as pieces to draw: the text, and which pieces are the match. */
export function snippetParts(snippet: string): Array<{ text: string; match: boolean }> {
  const parts: Array<{ text: string; match: boolean }> = []
  for (const piece of snippet.replace(/\s+/g, ' ').trim().split(/(\[[^\[\]]*\])/)) {
    if (!piece) continue
    const match = piece.length > 2 && piece.startsWith('[') && piece.endsWith(']')
    parts.push({ text: match ? piece.slice(1, -1) : piece, match })
  }
  return parts
}

/**
 * Native session ids whose conversation *content* matches the sidebar filter.
 * Titles are what the sidebar already matches; this finds the thread by what
 * was said in it. Backed by the transcript index, so a thread that was never
 * opened in OXESpace is found too. Absent bridge or no index yet: no matches.
 */
export function useThreadContentSearch(query: string): ReadonlySet<string> {
  const matches = useThreadContentMatches(query)
  return useMemo(() => matches.size ? new Set(matches.keys()) : EMPTY, [matches])
}

/** The same search, with where each conversation matched (by native session id): the list shows it under the title. */
export function useThreadContentMatches(query: string): ReadonlyMap<string, ThreadContentMatch> {
  const [ids, setIds] = useState<ReadonlyMap<string, ThreadContentMatch>>(NO_MATCHES)

  useEffect(() => {
    const text = query.trim()
    if (text.length < MIN_QUERY_CHARS) { setIds(NO_MATCHES); return }
    let active = true
    const timer = window.setTimeout(() => {
      void Promise.resolve(window.oxe?.session?.search?.({ query: text, limit: 50 }))
        .then((result) => {
          // The first hit of a session is its best one.
          if (active) setIds(result ? new Map([...result.hits].reverse().map((hit) => [hit.sessionId, { snippet: hit.snippet, role: hit.role }])) : NO_MATCHES)
        })
        .catch(() => { if (active) setIds(NO_MATCHES) })
    }, DEBOUNCE_MS)
    return () => { active = false; window.clearTimeout(timer) }
  }, [query])

  return ids
}
