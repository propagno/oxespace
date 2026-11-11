import { beforeEach, describe, expect, test, vi } from 'vitest'
import { selectActiveFile, useEditorStore } from '../../src/store/editor.store'

/** The store is keyed workspace → path since the tabs refactor; assert through
 *  the same selector the editor uses. */
const activeFile = (workspaceId: string) => selectActiveFile(useEditorStore.getState(), workspaceId)

describe('editor.store', () => {
  beforeEach(() => {
    useEditorStore.setState({ files: {}, tabs: {}, activePath: {} })
    window.oxe = {
      app: { version: '1.5.0' },
      workspace: {} as never,
      terminal: {} as never,
      agent: {} as never,
      tasks: {} as never,
      fs: {
        listTree: vi.fn(),
        readFile: vi.fn().mockResolvedValue({ relativePath: 'src/index.ts', content: 'one', size: 3, mtimeMs: 1 }),
        watchFile: vi.fn().mockResolvedValue({ watchId: 'watch-1' }),
        unwatchFile: vi.fn().mockResolvedValue(undefined),
        onFileChanged: vi.fn(() => vi.fn())
      }
    }
  })

  test('opens a file read-only', async () => {
    await useEditorStore.getState().openFile({
      workspaceId: 'workspace-1',
      rootPath: 'C:/repo',
      relativePath: 'src/index.ts'
    })
    expect(activeFile('workspace-1')).toMatchObject({ content: 'one', language: 'typescript' })
  })

  test('reloads external changes directly', async () => {
    await useEditorStore.getState().openFile({
      workspaceId: 'workspace-1',
      rootPath: 'C:/repo',
      relativePath: 'src/index.ts'
    })
    useEditorStore.getState().markExternalChange({
      watchId: 'watch-1',
      workspaceId: 'workspace-1',
      relativePath: 'src/index.ts',
      content: 'external',
      size: 8,
      mtimeMs: 3
    })

    expect(activeFile('workspace-1')?.content).toBe('external')
  })
})
