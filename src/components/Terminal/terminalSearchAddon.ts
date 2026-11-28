/**
 * OXE-484 · Lazy SearchAddon controller with explicit `highlightLimit: 1000`.
 *
 * Defers instantiating `@xterm/addon-search` and registering it on the Terminal
 * until the user actually invokes find (`Ctrl+F` / topbar search), eliminating
 * per-pane addon & decoration overhead across up to 32 mounted terminals.
 */
import { SearchAddon, type ISearchAddonOptions, type ISearchResultChangeEvent } from '@xterm/addon-search'
import type { IDisposable, Terminal } from '@xterm/xterm'

export const SEARCH_HIGHLIGHT_LIMIT = 1000

export interface LazySearchAddonOptions {
  terminal: Pick<Terminal, 'loadAddon'>
  onResults: (results: ISearchResultChangeEvent) => void
  highlightLimit?: number
  createAddon?: (options: Partial<ISearchAddonOptions>) => SearchAddon
}

export interface LazySearchAddonController {
  /** Instantiates and loads SearchAddon on first call, returning the cached instance thereafter. */
  ensure(): SearchAddon | null
  /** Returns the loaded SearchAddon without triggering lazy instantiation. */
  current(): SearchAddon | null
  isLoaded(): boolean
  dispose(): void
}

export function createLazySearchAddon(options: LazySearchAddonOptions): LazySearchAddonController {
  const highlightLimit = options.highlightLimit ?? SEARCH_HIGHLIGHT_LIMIT
  const createAddon = options.createAddon ?? ((opts: Partial<ISearchAddonOptions>) => new SearchAddon(opts))

  let addon: SearchAddon | null = null
  let resultsDisposable: IDisposable | null = null
  let disposed = false

  const ensure = (): SearchAddon | null => {
    if (disposed) return null
    if (addon) return addon
    const next = createAddon({ highlightLimit })
    options.terminal.loadAddon(next)
    resultsDisposable = next.onDidChangeResults((results) => {
      if (!disposed) options.onResults(results)
    })
    addon = next
    return next
  }

  const dispose = (): void => {
    disposed = true
    resultsDisposable?.dispose()
    resultsDisposable = null
    addon = null
  }

  return {
    ensure,
    current: () => addon,
    isLoaded: () => addon !== null,
    dispose
  }
}
