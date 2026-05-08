import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useEditorStore } from '../../src/store/editor.store'

describe('editor.store', () => {
  beforeEach(() => {
    useEditorStore.setState({ files: {} })
    window.oxe = {
      app: { version: '0.1.4' },
      workspace: {} as never,
      terminal: {} as never,
      agent: {} as never,
      tasks: {} as never,
      fs: {
        listTree: vi.fn(),
        readFile: vi.fn().mockResolvedValue({ relativePath: 'src/index.ts', content: 'one', size: 3, mtimeMs: 1 }),
        writeFile: vi.fn().mockResolvedValue({ relativePath: 'src/index.ts', size: 3, mtimeMs: 2 }),
        watchFile: vi.fn().mockResolvedValue({ watchId: 'watch-1' }),
        unwatchFile: vi.fn().mockResolvedValue(undefined),
        onFileChanged: vi.fn(() => vi.fn())
      }
    }
  })

  test('opens, edits and saves a file', async () => {
    await useEditorStore.getState().openFile({
      paneId: 'pane-1',
      workspaceId: 'workspace-1',
      rootPath: 'C:/repo',
      relativePath: 'src/index.ts'
    })
    expect(useEditorStore.getState().files['pane-1']).toMatchObject({ content: 'one', language: 'typescript' })

    useEditorStore.getState().updateContent('pane-1', 'two')
    expect(useEditorStore.getState().hasDirtyEditor('pane-1')).toBe(true)

    await useEditorStore.getState().saveFile('pane-1')
    expect(window.oxe.fs.writeFile).toHaveBeenCalledWith(expect.objectContaining({ content: 'two' }))
    expect(useEditorStore.getState().hasDirtyEditor('pane-1')).toBe(false)
  })

  test('marks external changes as conflict when local file is dirty', async () => {
    await useEditorStore.getState().openFile({
      paneId: 'pane-1',
      workspaceId: 'workspace-1',
      rootPath: 'C:/repo',
      relativePath: 'src/index.ts'
    })
    useEditorStore.getState().updateContent('pane-1', 'local')
    useEditorStore.getState().markExternalChange({
      watchId: 'watch-1',
      workspaceId: 'workspace-1',
      relativePath: 'src/index.ts',
      content: 'external',
      size: 8,
      mtimeMs: 3
    })

    expect(useEditorStore.getState().files['pane-1'].content).toBe('local')
    expect(useEditorStore.getState().files['pane-1'].conflict?.externalContent).toBe('external')
  })
})
