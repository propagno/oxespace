import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { CaseSensitive, ChevronDown, ChevronRight, EyeOff, Loader2, Regex, Search as SearchIcon } from 'lucide-react'
import type { Workspace } from '../../../shared/types/workspace'
import type { SearchFileResult, SearchSubmatch } from '../../../shared/types/search'
import { useSearchStore } from '../../store/search.store'
import { useEditorStore } from '../../store/editor.store'
import { useWorkspaceStore } from '../../store/workspace.store'

interface SearchPanelProps {
  workspace: Workspace
}

/** Highlight the matched substrings inside a result line. We locate each
 *  submatch by text (ripgrep offsets are byte-based, which don't map cleanly to
 *  JS string indices for non-ASCII) — the matched text itself is exact. */
function highlight(line: string, submatches: SearchSubmatch[]): ReactNode {
  if (submatches.length === 0) return line
  const parts: ReactNode[] = []
  let cursor = 0
  let key = 0
  for (const sub of submatches) {
    if (!sub.text) continue
    const idx = line.indexOf(sub.text, cursor)
    if (idx < 0) continue
    if (idx > cursor) parts.push(line.slice(cursor, idx))
    parts.push(<mark key={key++} className="search-hit">{sub.text}</mark>)
    cursor = idx + sub.text.length
  }
  if (cursor < line.length) parts.push(line.slice(cursor))
  return parts.length > 0 ? parts : line
}

export function SearchPanel({ workspace }: SearchPanelProps): ReactElement {
  const query = useSearchStore((s) => s.query)
  const options = useSearchStore((s) => s.options)
  const results = useSearchStore((s) => s.results)
  const loading = useSearchStore((s) => s.loading)
  const error = useSearchStore((s) => s.error)
  const setQuery = useSearchStore((s) => s.setQuery)
  const setOption = useSearchStore((s) => s.setOption)
  const run = useSearchStore((s) => s.run)

  const inputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  // Debounced auto-search whenever the query or options change.
  useEffect(() => {
    const handle = window.setTimeout(() => { void run(workspace.id, workspace.rootPath) }, 250)
    return () => window.clearTimeout(handle)
  }, [query, options, run, workspace.id, workspace.rootPath])

  const openMatch = useCallback((path: string) => {
    void useEditorStore.getState().openFile({ workspaceId: workspace.id, rootPath: workspace.rootPath, relativePath: path })
    void useWorkspaceStore.getState().updateEditorState({ workspaceId: workspace.id, editorVisible: true })
  }, [workspace.id, workspace.rootPath])

  const files = results?.files ?? []
  const summary = results
    ? results.totalMatches === 0
      ? 'No results'
      : `${results.totalMatches} match${results.totalMatches === 1 ? '' : 'es'} in ${results.totalFiles} file${results.totalFiles === 1 ? '' : 's'}${results.truncated ? ' (truncated)' : ''}`
    : null

  return (
    <div className="search-panel" data-testid="search-panel">
      <div className="search-panel-input-row">
        <SearchIcon size={13} aria-hidden="true" className="search-panel-input-icon" />
        <input
          ref={inputRef}
          type="search"
          className="search-panel-input"
          placeholder="Find in files…"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          aria-label="Search query"
          autoComplete="off"
          spellCheck={false}
        />
        {loading ? <Loader2 size={13} aria-hidden="true" className="search-panel-spinner" /> : null}
      </div>

      <div className="search-panel-toggles" role="group" aria-label="Search options">
        <button
          type="button"
          className={`tile-btn${options.caseSensitive ? ' active' : ''}`}
          aria-pressed={options.caseSensitive}
          title="Match case"
          onClick={() => setOption('caseSensitive', !options.caseSensitive)}
        >
          <CaseSensitive size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`tile-btn${options.isRegex ? ' active' : ''}`}
          aria-pressed={options.isRegex}
          title="Use regular expression"
          onClick={() => setOption('isRegex', !options.isRegex)}
        >
          <Regex size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`tile-btn${options.includeIgnored ? ' active' : ''}`}
          aria-pressed={options.includeIgnored}
          title="Include git-ignored and hidden files"
          onClick={() => setOption('includeIgnored', !options.includeIgnored)}
        >
          <EyeOff size={13} aria-hidden="true" />
        </button>
        <input
          type="text"
          className="search-panel-globs"
          placeholder="files to include (e.g. src/**, !*.lock)"
          value={options.globs}
          onChange={(event) => setOption('globs', event.currentTarget.value)}
          aria-label="Glob filters"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {summary ? <div className="search-panel-summary" role="status">{summary}</div> : null}
      {error ? <div className="search-panel-error" role="alert">{error}</div> : null}

      <div className="search-panel-results">
        {files.map((file) => (
          <FileGroup key={file.path} file={file} onOpen={openMatch} />
        ))}
      </div>
    </div>
  )
}

interface FileGroupProps {
  file: SearchFileResult
  onOpen: (path: string) => void
}

function FileGroup({ file, onOpen }: FileGroupProps): ReactElement {
  const [open, setOpen] = useState(true)
  const name = file.path.split('/').pop() ?? file.path
  const dir = file.path.slice(0, file.path.length - name.length)

  return (
    <section className="search-file-group">
      <button
        type="button"
        className="search-file-header"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
        <span className="search-file-name">{name}</span>
        {dir ? <span className="search-file-dir">{dir}</span> : null}
        <span className="search-file-count">{file.matches.length}{file.truncated ? '+' : ''}</span>
      </button>
      {open ? (
        <ul className="search-file-matches">
          {file.matches.map((match, index) => (
            <li key={`${match.lineNumber}-${index}`}>
              <button
                type="button"
                className="search-match-row"
                onClick={() => onOpen(file.path)}
                title={`${file.path}:${match.lineNumber}`}
              >
                <span className="search-match-line">{match.lineNumber}</span>
                <span className="search-match-text">{highlight(match.line, match.submatches)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
