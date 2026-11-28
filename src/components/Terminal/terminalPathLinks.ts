import type { IDisposable, ILink, Terminal } from '@xterm/xterm'
import { i18n } from '../../i18n'
import { parseProjectPath, trimMarkdownPathToken, type ProjectPath } from '../../lib/projectPath'
import {
  createCachedAsyncResolver,
  createTerminalLinkCache,
  LINK_CACHE_MAX_ENTRIES,
  LINK_CACHE_TTL_MS
} from './terminalLinkCache'

/**
 * F33 §5.3 · project file paths in terminal output, like URLs: Ctrl+click (Cmd on macOS) opens one in OXESpace's
 * editor at its line, Ctrl+Shift+click in the preferred external editor, and a right click on it shows the path menu.
 * A path outside the project is not a link. Paths aren't reachable by keyboard in xterm (spec §5.2): the same file is
 * reachable from the conversation's rows or search.
 */
export interface TerminalPathScope { workspaceId: string; rootPath: string }

export interface FoundTerminalPath {
  start: number
  end: number
  text: string
  path: ProjectPath
}

export interface TerminalPathHandlers {
  scope(): TerminalPathScope | null
  openInOxespace(scope: TerminalPathScope, path: ProjectPath): void
  openExternal(scope: TerminalPathScope, path: ProjectPath): void
  /** The path under the pointer, or null when it leaves: a right click there opens the menu. */
  hovered(link: { scope: TerminalPathScope; path: ProjectPath } | null): void
  hint(): string
  /** Optional existence/resolution probe; results are cached for 10s (bounded 500-entry LRU). */
  exists?: (scope: TerminalPathScope, path: ProjectPath) => Promise<boolean> | boolean
  cacheTtlMs?: number
  cacheMaxEntries?: number
  now?: () => number
}

/** Candidate tokens: no spaces, quotes or brackets; `(line,col)` kept attached. */
const TOKEN = /[^\s'"`<>[\]{}|;,()]+(?:\(\d+\s*,\s*\d+\))?/g

/** The project paths on one line of text, by their 0-based start and end columns. */
export function findPathsInLine(text: string, root: string): FoundTerminalPath[] {
  const found: FoundTerminalPath[] = []
  for (const match of text.matchAll(TOKEN)) {
    // Strip sentence punctuation outside or inside Markdown wrappers (e.g. `**src/app.ts:42**.`).
    const raw = match[0].replace(/[.:]+$/, '')
    const { cleaned, leadTrimmed } = trimMarkdownPathToken(raw)
    const token = cleaned.replace(/[.:]+$/, '')
    const path = token ? parseProjectPath(token, root) : null
    if (path) {
      const start = match.index + leadTrimmed
      found.push({ start, end: start + token.length, text: token, path })
    }
  }
  return found
}

const isMac = (): boolean => typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

function toLinks(
  foundPaths: readonly FoundTerminalPath[],
  lineNumber: number,
  scope: TerminalPathScope,
  handlers: TerminalPathHandlers
): ILink[] | undefined {
  if (!foundPaths.length) return undefined
  return foundPaths.map(found => ({
    text: found.text,
    range: { start: { x: found.start + 1, y: lineNumber }, end: { x: found.end, y: lineNumber } },
    decorations: { pointerCursor: true, underline: true },
    activate(event) {
      if (!(event.ctrlKey || event.metaKey)) return
      if (event.shiftKey) handlers.openExternal(scope, found.path)
      else handlers.openInOxespace(scope, found.path)
    },
    hover(event) {
      handlers.hovered({ scope, path: found.path })
      if (event.target instanceof HTMLElement) event.target.title = handlers.hint()
    },
    leave(event) {
      handlers.hovered(null)
      if (event.target instanceof HTMLElement) event.target.removeAttribute('title')
    }
  }))
}

export function registerTerminalPathLinks(terminal: Terminal, handlers: TerminalPathHandlers): IDisposable {
  const ttlMs = handlers.cacheTtlMs ?? LINK_CACHE_TTL_MS
  const maxEntries = handlers.cacheMaxEntries ?? LINK_CACHE_MAX_ENTRIES
  const now = handlers.now
  const lineCache = createTerminalLinkCache<FoundTerminalPath[]>({ ttlMs, maxEntries, now })
  const existsResolver = handlers.exists
    ? createCachedAsyncResolver<boolean>({
        ttlMs,
        maxEntries,
        now,
        resolve: (key) => {
          const [workspaceId, rootPath, relativePath] = key.split('\0')
          return handlers.exists!({ workspaceId, rootPath }, { relativePath })
        }
      })
    : null
  let disposed = false

  const provider = terminal.registerLinkProvider({
    provideLinks(lineNumber, callback) {
      const scope = handlers.scope()
      const line = scope ? terminal.buffer.active.getLine(lineNumber - 1)?.translateToString(true) : undefined
      if (!scope || !line) { callback(undefined); return }

      const lineKey = `${scope.rootPath}\0${line}`
      let candidates = lineCache.get(lineKey)
      if (candidates === undefined) {
        candidates = findPathsInLine(line, scope.rootPath)
        lineCache.set(lineKey, candidates)
      }
      if (!candidates.length) { callback(undefined); return }

      if (!existsResolver) {
        callback(toLinks(candidates, lineNumber, scope, handlers))
        return
      }

      const keys = candidates.map(found => `${scope.workspaceId}\0${scope.rootPath}\0${found.path.relativePath}`)
      const syncHits = keys.map(key => existsResolver.getSync(key))
      if (syncHits.every((hit): hit is boolean => hit !== undefined)) {
        const verified = candidates.filter((_, idx) => syncHits[idx])
        callback(toLinks(verified, lineNumber, scope, handlers))
        return
      }

      void Promise.all(
        keys.map((key, idx) =>
          syncHits[idx] !== undefined
            ? Promise.resolve(syncHits[idx])
            : existsResolver.resolve(key).catch(() => true)
        )
      ).then((results) => {
        if (disposed) { callback(undefined); return }
        const verified = candidates.filter((_, idx) => results[idx])
        callback(toLinks(verified, lineNumber, scope, handlers))
      })
    }
  })

  return {
    dispose: () => {
      disposed = true
      lineCache.clear()
      existsResolver?.clear()
      provider.dispose()
    }
  }
}

/** "Ctrl+click opens in OXESpace's editor · Ctrl+Shift+click opens in VS Code" (spec §5.3). */
export function terminalPathHint(editor: string | null): string {
  const key = isMac() ? 'Cmd' : 'Ctrl'
  const t = (k: string, options: Record<string, unknown>): string => (i18n.t as unknown as (key: string, options: object) => string)(k, { ns: 'common', ...options })
  return editor ? t('openIn.terminalHintExternal', { key, editor }) : t('openIn.terminalHint', { key })
}
