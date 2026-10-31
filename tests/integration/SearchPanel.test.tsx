import { beforeEach, describe, expect, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SearchPanel, searchSummary } from '../../src/components/Search/SearchPanel'
import { changeLanguage } from '../../src/i18n'
import { useEditorStore } from '../../src/store/editor.store'
import { useSearchStore } from '../../src/store/search.store'
import type { Workspace } from '../../shared/types/workspace'
import type { SearchResult } from '../../shared/types/search'

const WORKSPACE = { id: 'ws-1', rootPath: 'C:/repo' } as unknown as Workspace

const RESULT: SearchResult = {
  files: [
    {
      path: 'src/foo.ts',
      truncated: false,
      matches: [
        { lineNumber: 12, line: 'const needle = 1', submatches: [{ text: 'needle', start: 6, end: 12 }] }
      ]
    }
  ],
  totalMatches: 1,
  totalFiles: 1,
  truncated: false,
  elapsedMs: 3
}

describe('SearchPanel', () => {
  beforeEach(() => {
    useSearchStore.setState({ query: '', results: null, loading: false, error: null, options: { isRegex: false, caseSensitive: false, includeIgnored: false, globs: '' } })
    window.oxe = {
      search: {
        run: vi.fn().mockResolvedValue(RESULT),
        cancel: vi.fn().mockResolvedValue(undefined)
      },
      fs: {
        readFile: vi.fn().mockResolvedValue({ content: '', relativePath: 'src/foo.ts' }),
        watchFile: vi.fn().mockResolvedValue({ watchId: 'w1' }),
        unwatchFile: vi.fn().mockResolvedValue(undefined)
      },
      workspace: {
        updateEditorState: vi.fn().mockResolvedValue(WORKSPACE)
      }
    } as unknown as typeof window.oxe
  })

  test('runs a search and renders matches grouped by file', async () => {
    const user = userEvent.setup()
    render(<SearchPanel workspace={WORKSPACE} />)

    await user.type(screen.getByLabelText('Search query'), 'needle')

    expect(await screen.findByText('foo.ts')).toBeInTheDocument()
    expect(screen.getByText('needle')).toBeInTheDocument()
    await waitFor(() => expect(window.oxe.search.run).toHaveBeenCalled())
    const call = (window.oxe.search.run as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]
    expect(call).toMatchObject({ query: 'needle', rootPath: 'C:/repo' })
  })

  test('clicking a match opens the file in the editor at the matched line', async () => {
    const user = userEvent.setup()
    render(<SearchPanel workspace={WORKSPACE} />)

    await user.type(screen.getByLabelText('Search query'), 'needle')
    expect(await screen.findByText('1 match in 1 file')).toBeInTheDocument()
    const row = await screen.findByTitle('Open src/foo.ts at line 12')
    await user.click(row)

    await waitFor(() => expect(window.oxe.fs.readFile).toHaveBeenCalledWith(
      { workspaceId: 'ws-1', rootPath: 'C:/repo', relativePath: 'src/foo.ts' }
    ))
    expect(useEditorStore.getState().reveal['ws-1']).toMatchObject({ relativePath: 'src/foo.ts', line: 12 })
    expect(window.oxe.workspace.updateEditorState).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1', editorVisible: true })
    )
  })

  test('shows a failed search as an error, without a stale summary', async () => {
    useSearchStore.setState({ query: 'needle(', results: { ...RESULT, totalMatches: 0, totalFiles: 0, files: [] }, error: 'regex parse error' })
    window.oxe.search.run = vi.fn().mockResolvedValue({ ...RESULT, files: [], totalMatches: 0, totalFiles: 0, error: 'regex parse error' })
    render(<SearchPanel workspace={WORKSPACE} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Search failed')
    expect(screen.getByRole('alert')).toHaveTextContent('regex parse error')
    expect(screen.queryByText('No results')).not.toBeInTheDocument()
  })

  test('summarizes in the interface language, with plurals', async () => {
    expect(searchSummary(3, 2, false)).toBe('3 matches in 2 files')
    expect(searchSummary(5, 1, true)).toBe('5 matches in 1 file (truncated)')
    await changeLanguage('pt-BR')
    try {
      expect(searchSummary(1, 1, false)).toBe('1 ocorrência em 1 arquivo')
      expect(searchSummary(0, 0, false)).toBe('Nenhum resultado')
    } finally {
      await changeLanguage('en')
    }
  })
})
