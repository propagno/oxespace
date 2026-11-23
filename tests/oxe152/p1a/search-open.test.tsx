// Frozen acceptance test for OXE-371 A5 (program 152p1a, phase F1). Written by the planner; the executor must not edit it.
// Closing Search cancels its search; a Markdown match opens as source at the asked line even when the editor was closed.
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workspace } from '../../../shared/types/workspace'
import { EditorPane } from '../../../src/components/Editor/EditorPane'
import { SearchPanel } from '../../../src/components/Search/SearchPanel'
import { useEditorStore } from '../../../src/store/editor.store'
import { useSearchStore } from '../../../src/store/search.store'

const monaco = vi.hoisted(() => ({ lines: [] as number[] }))
vi.mock('@monaco-editor/react', () => ({
  default: function Monaco({ language, value, onMount }: { language: string; value: string; onMount?: (editor: unknown, api: unknown) => void }) {
    useEffect(() => {
      onMount?.({
        getModel: () => ({ getLineCount: () => value.split('\n').length }),
        setPosition: () => undefined,
        revealLineInCenter: (line: number) => { monaco.lines.push(line) },
        focus: () => undefined,
        layout: () => undefined,
        updateOptions: () => undefined,
        addCommand: () => undefined,
        addAction: () => ({ dispose: () => undefined }),
        onDidDispose: () => ({ dispose: () => undefined }),
        onDidChangeCursorSelection: () => ({ dispose: () => undefined })
      }, { KeyMod: { CtrlCmd: 0 }, KeyCode: {}, editor: { setTheme: () => undefined, defineTheme: () => undefined } })
    }, [])
    return <textarea aria-label={`monaco-${language}`} value={value} readOnly />
  }
}))
vi.mock('../../../src/lib/monacoSetup', () => ({}))

const original = window.oxe
const DOC = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join('\n')
const cancel = vi.fn(async () => undefined)

beforeEach(() => {
  monaco.lines.length = 0
  cancel.mockClear()
  useEditorStore.setState({ files: {}, tabs: {}, activePath: {}, reveal: {} })
  useSearchStore.setState({ query: '', results: null, error: null, loading: false })
  window.oxe = {
    app: { version: '1.5.2' },
    search: { search: vi.fn(() => new Promise(() => undefined)), cancel },
    fs: {
      listTree: vi.fn().mockResolvedValue([]),
      readFile: vi.fn().mockResolvedValue({ relativePath: 'docs/guide.md', content: DOC, size: DOC.length, mtimeMs: 1 }),
      watchFile: vi.fn().mockResolvedValue({ watchId: 'watch-1' }),
      unwatchFile: vi.fn().mockResolvedValue(undefined),
      onFileChanged: vi.fn(() => vi.fn())
    }
  } as unknown as typeof window.oxe
})
afterEach(() => { cleanup(); window.oxe = original })

describe('OXE-371 · the Search panel and its results', () => {
  it('closing the search panel cancels the search', () => {
    const { unmount } = render(<SearchPanel workspace={{ id: 'ws-1', rootPath: 'C:/repo' } as Workspace} />)
    cancel.mockClear()
    unmount()
    expect(cancel).toHaveBeenCalled()
  })

  it('a Markdown match opens as source at its line when the editor was closed', async () => {
    await useEditorStore.getState().openFile({ workspaceId: 'ws-1', rootPath: 'C:/repo', relativePath: 'docs/guide.md', line: 23 })
    render(<EditorPane workspaceId="ws-1" rootPath="C:/repo" />)
    expect(await screen.findByLabelText('monaco-markdown', {}, { timeout: 5_000 })).toBeInTheDocument()
    await waitFor(() => expect(monaco.lines).toContain(23))
  }, 15_000)

  it('a Markdown file opened without a line still shows its preview', async () => {
    await useEditorStore.getState().openFile({ workspaceId: 'ws-1', rootPath: 'C:/repo', relativePath: 'docs/guide.md' })
    render(<EditorPane workspaceId="ws-1" rootPath="C:/repo" />)
    expect(await screen.findByTestId('markdown-preview', {}, { timeout: 5_000 })).toBeInTheDocument()
  }, 15_000)
})
