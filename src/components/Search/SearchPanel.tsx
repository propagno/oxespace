import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { CaseSensitive, ChevronDown, ChevronRight, EyeOff, Regex, Search as SearchIcon } from 'lucide-react'
import type { Workspace } from '../../../shared/types/workspace'
import type { SearchFileResult, SearchSubmatch } from '../../../shared/types/search'
import { useSearchStore } from '../../store/search.store'
import { useEditorStore } from '../../store/editor.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { useTranslation } from 'react-i18next'
import { i18n } from '../../i18n'
import { ErrorState, Spinner } from '../../ui'

interface SearchPanelProps {
  workspace: Workspace
  onOpenFile?: (relativePath: string) => void
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

/** "3 matches in 2 files", in the interface language. */
export function searchSummary(matches: number, files: number, truncated: boolean): string {
  if (matches === 0) return i18n.t('search.noResults', { ns: 'code' })
  const summary = i18n.t('search.summary', { ns: 'code', matches: i18n.t('search.matches', { ns: 'code', count: matches }), files: i18n.t('search.files', { ns: 'code', count: files }) })
  return truncated ? i18n.t('search.truncated', { ns: 'code', summary }) : summary
}

export function SearchPanel({ workspace, onOpenFile }: SearchPanelProps): ReactElement {
  const { t } = useTranslation('code')
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

  // A match opens its file at the matched line.
  const openMatch = useCallback((path: string, line?: number) => {
    void useEditorStore.getState().openFile({ workspaceId: workspace.id, rootPath: workspace.rootPath, relativePath: path, line })
    if (onOpenFile) onOpenFile(path)
    else void useWorkspaceStore.getState().updateEditorState({ workspaceId: workspace.id, editorVisible: true })
  }, [onOpenFile, workspace.id, workspace.rootPath])

  const files = results?.files ?? []
  const summary = results ? searchSummary(results.totalMatches, results.totalFiles, results.truncated) : null

  return (
    <div className="search-panel" data-testid="search-panel">
      <div className="search-panel-input-row">
        <SearchIcon size={14} aria-hidden="true" className="search-panel-input-icon" />
        <input
          ref={inputRef}
          type="search"
          className="search-panel-input"
          placeholder={t('search.placeholder')}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          aria-label={t('search.query')}
          autoComplete="off"
          spellCheck={false}
        />
        {loading ? <Spinner size="sm" label={t('search.searching')} /> : null}
      </div>

      <div className="search-panel-toggles" role="group" aria-label={t('search.options')}>
        <button
          type="button"
          className={`tile-btn${options.caseSensitive ? ' active' : ''}`}
          aria-pressed={options.caseSensitive}
          title={t('search.matchCase')}
          onClick={() => setOption('caseSensitive', !options.caseSensitive)}
        >
          <CaseSensitive size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`tile-btn${options.isRegex ? ' active' : ''}`}
          aria-pressed={options.isRegex}
          title={t('search.regex')}
          onClick={() => setOption('isRegex', !options.isRegex)}
        >
          <Regex size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`tile-btn${options.includeIgnored ? ' active' : ''}`}
          aria-pressed={options.includeIgnored}
          title={t('search.includeIgnored')}
          onClick={() => setOption('includeIgnored', !options.includeIgnored)}
        >
          <EyeOff size={14} aria-hidden="true" />
        </button>
        <input
          type="text"
          className="search-panel-globs"
          placeholder={t('search.globsPlaceholder')}
          value={options.globs}
          onChange={(event) => setOption('globs', event.currentTarget.value)}
          aria-label={t('search.globs')}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {summary && !error ? <div className="search-panel-summary" role="status">{summary}</div> : null}
      {error ? <ErrorState compact title={t('search.failed')} message={error} /> : null}

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
  onOpen: (path: string, line?: number) => void
}

function FileGroup({ file, onOpen }: FileGroupProps): ReactElement {
  const { t } = useTranslation('code')
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
                onClick={() => onOpen(file.path, match.lineNumber)}
                title={t('search.openAt', { path: file.path, line: match.lineNumber })}
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
