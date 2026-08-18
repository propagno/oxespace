import { create } from 'zustand'
import type { SearchResult } from '../../shared/types/search'

export interface SearchOptions {
  isRegex: boolean
  caseSensitive: boolean
  includeIgnored: boolean
  /** Comma-separated ripgrep globs, e.g. "src/**, !*.lock". */
  globs: string
}

interface SearchState {
  query: string
  options: SearchOptions
  results: SearchResult | null
  loading: boolean
  error: string | null
  setQuery: (query: string) => void
  setOption: <K extends keyof SearchOptions>(key: K, value: SearchOptions[K]) => void
  run: (workspaceId: string, rootPath: string) => Promise<void>
  cancel: () => void
  clear: () => void
}

// Monotonic token so a superseded search (the service resolves the killed run
// with partial results) can't overwrite the newest results.
let requestToken = 0

export const useSearchStore = create<SearchState>((set, get) => ({
  query: '',
  options: { isRegex: false, caseSensitive: false, includeIgnored: false, globs: '' },
  results: null,
  loading: false,
  error: null,

  setQuery: (query) => set({ query }),
  setOption: (key, value) => set((state) => ({ options: { ...state.options, [key]: value } })),

  run: async (workspaceId, rootPath) => {
    const { query, options } = get()
    const trimmed = query.trim()
    if (!trimmed) {
      requestToken += 1
      set({ results: null, loading: false, error: null })
      return
    }

    const token = ++requestToken
    set({ loading: true, error: null })

    const globs = options.globs
      .split(',')
      .map((glob) => glob.trim())
      .filter(Boolean)

    try {
      const result = await window.oxe.search.run({
        workspaceId,
        rootPath,
        query: trimmed,
        isRegex: options.isRegex,
        caseSensitive: options.caseSensitive,
        includeIgnored: options.includeIgnored,
        globs: globs.length > 0 ? globs : undefined
      })
      if (token !== requestToken) return
      set({ results: result, loading: false, error: result.error ?? null })
    } catch (err) {
      if (token !== requestToken) return
      set({ loading: false, error: err instanceof Error ? err.message : String(err) })
    }
  },

  cancel: () => {
    requestToken += 1
    void window.oxe.search.cancel().catch(() => undefined)
    set({ loading: false })
  },

  clear: () => {
    requestToken += 1
    void window.oxe.search.cancel().catch(() => undefined)
    set({ query: '', results: null, error: null, loading: false })
  }
}))
