import { useEffect, useState } from 'react'

const MIN_QUERY_CHARS = 3
const DEBOUNCE_MS = 350

const EMPTY: ReadonlySet<string> = new Set()

/**
 * Native session ids whose conversation *content* matches the sidebar filter.
 * Titles are what the sidebar already matches; this finds the thread by what
 * was said in it. Backed by the transcript index, so a thread that was never
 * opened in OXESpace is found too. Absent bridge or no index yet: no matches.
 */
export function useThreadContentSearch(query: string): ReadonlySet<string> {
  const [ids, setIds] = useState<ReadonlySet<string>>(EMPTY)

  useEffect(() => {
    const text = query.trim()
    if (text.length < MIN_QUERY_CHARS) { setIds(EMPTY); return }
    let active = true
    const timer = window.setTimeout(() => {
      void Promise.resolve(window.oxe?.session?.search?.({ query: text, limit: 50 }))
        .then((result) => {
          if (active) setIds(result ? new Set(result.hits.map((hit) => hit.sessionId)) : EMPTY)
        })
        .catch(() => { if (active) setIds(EMPTY) })
    }, DEBOUNCE_MS)
    return () => { active = false; window.clearTimeout(timer) }
  }, [query])

  return ids
}
