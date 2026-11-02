import type { IDisposable, ILink, Terminal } from '@xterm/xterm'
import { i18n } from '../../i18n'
import { parseProjectPath, type ProjectPath } from '../../lib/projectPath'

/**
 * F33 §5.3 · project file paths in terminal output, like URLs: Ctrl+click (Cmd on macOS) opens one in OXESpace's
 * editor at its line, Ctrl+Shift+click in the preferred external editor, and a right click on it shows the path menu.
 * A path outside the project is not a link. Paths aren't reachable by keyboard in xterm (spec §5.2): the same file is
 * reachable from the conversation's rows or search.
 */
export interface TerminalPathScope { workspaceId: string; rootPath: string }

export interface TerminalPathHandlers {
  scope(): TerminalPathScope | null
  openInOxespace(scope: TerminalPathScope, path: ProjectPath): void
  openExternal(scope: TerminalPathScope, path: ProjectPath): void
  /** The path under the pointer, or null when it leaves: a right click there opens the menu. */
  hovered(link: { scope: TerminalPathScope; path: ProjectPath } | null): void
  hint(): string
}

/** Candidate tokens: no spaces, quotes or brackets; `(line,col)` kept attached. */
const TOKEN = /[^\s'"`<>[\]{}|;,()]+(?:\(\d+\s*,\s*\d+\))?/g

/** The project paths on one line of text, by their 0-based start and end columns. */
export function findPathsInLine(text: string, root: string): Array<{ start: number; end: number; text: string; path: ProjectPath }> {
  const found: Array<{ start: number; end: number; text: string; path: ProjectPath }> = []
  for (const match of text.matchAll(TOKEN)) {
    // A sentence's full stop or colon after the path is not part of it.
    const token = match[0].replace(/[.:]+$/, '')
    const path = token ? parseProjectPath(token, root) : null
    if (path) found.push({ start: match.index, end: match.index + token.length, text: token, path })
  }
  return found
}

const isMac = (): boolean => typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

export function registerTerminalPathLinks(terminal: Terminal, handlers: TerminalPathHandlers): IDisposable {
  return terminal.registerLinkProvider({
    provideLinks(lineNumber, callback) {
      const scope = handlers.scope()
      const line = scope ? terminal.buffer.active.getLine(lineNumber - 1)?.translateToString(true) : undefined
      if (!scope || !line) { callback(undefined); return }
      const links: ILink[] = findPathsInLine(line, scope.rootPath).map(found => ({
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
      callback(links.length ? links : undefined)
    }
  })
}

/** "Ctrl+click opens in OXESpace's editor · Ctrl+Shift+click opens in VS Code" (spec §5.3). */
export function terminalPathHint(editor: string | null): string {
  const key = isMac() ? 'Cmd' : 'Ctrl'
  const t = (k: string, options: Record<string, unknown>): string => (i18n.t as unknown as (key: string, options: object) => string)(k, { ns: 'common', ...options })
  return editor ? t('openIn.terminalHintExternal', { key, editor }) : t('openIn.terminalHint', { key })
}
