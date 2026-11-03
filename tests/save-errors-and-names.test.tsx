import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useOxePostStore } from '../src/components/OxePost/oxepost.store'
import { changeLanguage } from '../src/i18n'
import { useEditorStore, withProjectPaths, type EditorFileState } from '../src/store/editor.store'

afterEach(async () => { await changeLanguage('en'); delete (window as unknown as { oxe?: unknown }).oxe })

describe('paths in an editor message', () => {
  it('are written from the project root; anything outside shows only its file name', () => {
    expect(withProjectPaths("Sem permissão para usar C:\\Users\\ana\\repo\\src\\app.ts.", 'C:\\Users\\ana\\repo')).toBe('Sem permissão para usar src/app.ts.')
    expect(withProjectPaths('No permission to use /home/ana/repo/docs/notes.md.', '/home/ana/repo/')).toBe('No permission to use docs/notes.md.')
    // The root's case and slashes may differ from the message's (Windows).
    expect(withProjectPaths("No permission to use 'c:/users/ana/repo/a.ts'", 'C:\\Users\\ana\\repo')).toBe("No permission to use 'a.ts'")
    expect(withProjectPaths('No permission to use C:\\Windows\\System32\\drivers\\etc\\hosts', 'C:\\Users\\ana\\repo')).toBe('No permission to use hosts')
    expect(withProjectPaths('Not found: \\\\server\\share\\team\\plan.md', 'C:\\repo')).toBe('Not found: plan.md')
    // Not a path: a slash inside a word stays.
    expect(withProjectPaths('Read and/or write the file', '/repo')).toBe('Read and/or write the file')
  })
})

describe('a save that fails', () => {
  const file = (patch: Partial<EditorFileState> = {}): EditorFileState => ({ workspaceId: 'ws', rootPath: 'C:\\Users\\ana\\repo', relativePath: 'src/app.ts', content: 'edited', lastSavedContent: 'saved',
    language: 'typescript', watchId: null, isLoading: false, isSaving: false, error: null, conflict: null, ...patch })

  beforeEach(() => { useEditorStore.setState({ files: { ws: { 'src/app.ts': file() } } }) })

  it('is a save error, not an open error, and names the file from the project root', async () => {
    const writeFile = vi.fn(async () => { throw new Error("EACCES: permission denied, open 'C:\\Users\\ana\\repo\\src\\app.ts'") })
    ;(window as unknown as { oxe: unknown }).oxe = { fs: { writeFile } }
    await useEditorStore.getState().savePath('ws', 'src/app.ts')
    const after = useEditorStore.getState().files.ws['src/app.ts']
    expect(after.error).toBeNull()
    expect(after.saveError).toBe('No permission to use src/app.ts.')
    expect(after.saveError).not.toContain('C:\\')
    // The edit is kept, and the next save starts clean.
    expect(after.content).toBe('edited')
    writeFile.mockResolvedValueOnce(undefined as never)
    await useEditorStore.getState().savePath('ws', 'src/app.ts')
    expect(useEditorStore.getState().files.ws['src/app.ts'].saveError).toBeNull()
  })
})

describe('a new OxePost request', () => {
  it('is named in the interface language', async () => {
    await changeLanguage('pt-BR')
    useOxePostStore.getState().newRequest()
    expect(useOxePostStore.getState().draft.name).toBe('Nova requisição')
    await changeLanguage('en')
    useOxePostStore.getState().newRequest()
    expect(useOxePostStore.getState().draft.name).toBe('New request')
  })
})
