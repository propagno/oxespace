import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditorStore } from '../../src/store/editor.store'

const WS = 'ws-1'
const ROOT = 'C:/repo'

function stubFs(contents: Record<string, string>): void {
  let watchSeq = 0
  ;(globalThis as unknown as { window: Window }).window = globalThis.window ?? ({} as Window)
  Object.assign(window, {
    oxe: {
      fs: {
        readFile: vi.fn(async (input: { relativePath: string }) => {
          const content = contents[input.relativePath]
          if (content === undefined) throw new Error('ENOENT')
          return { relativePath: input.relativePath, content, size: content.length, mtimeMs: 1 }
        }),
        watchFile: vi.fn(async () => ({ watchId: `watch-${(watchSeq += 1)}` })),
        unwatchFile: vi.fn(async () => undefined),
        writeFile: vi.fn(async () => ({ relativePath: 'x', size: 0, mtimeMs: 2 }))
      }
    }
  })
}

describe('editor tabs', () => {
  beforeEach(() => {
    stubFs({ 'a.ts': 'A', 'b.ts': 'B', 'c.ts': 'C', 'README.md': '# hi' })
    useEditorStore.setState({ files: {}, tabs: {}, activePath: {} })
  })

  it('opens files as tabs and tracks the active one', async () => {
    await useEditorStore.getState().openFile({ workspaceId: WS, rootPath: ROOT, relativePath: 'a.ts' })
    await useEditorStore.getState().openFile({ workspaceId: WS, rootPath: ROOT, relativePath: 'b.ts' })

    const state = useEditorStore.getState()
    expect(state.tabs[WS].map((tab) => tab.relativePath)).toEqual(['a.ts', 'b.ts'])
    expect(state.activePath[WS]).toBe('b.ts')
    expect(state.files[WS]['a.ts'].content).toBe('A')
  })

  it('keeps unsaved edits when switching away and back', async () => {
    await useEditorStore.getState().openFile({ workspaceId: WS, rootPath: ROOT, relativePath: 'a.ts' })
    useEditorStore.getState().updateContent(WS, 'A edited')
    await useEditorStore.getState().openFile({ workspaceId: WS, rootPath: ROOT, relativePath: 'b.ts' })
    await useEditorStore.getState().openFile({ workspaceId: WS, rootPath: ROOT, relativePath: 'a.ts' })

    expect(useEditorStore.getState().files[WS]['a.ts'].content).toBe('A edited')
    expect(useEditorStore.getState().hasDirtyEditor(WS)).toBe(true)
    // Re-activating must not re-read the file from disk.
    expect(window.oxe.fs.readFile).toHaveBeenCalledTimes(2)
  })

  it('closing the active tab activates a neighbour and unwatches', async () => {
    await useEditorStore.getState().openFile({ workspaceId: WS, rootPath: ROOT, relativePath: 'a.ts' })
    await useEditorStore.getState().openFile({ workspaceId: WS, rootPath: ROOT, relativePath: 'b.ts' })
    useEditorStore.getState().closeTab(WS, 'b.ts')

    expect(useEditorStore.getState().tabs[WS].map((tab) => tab.relativePath)).toEqual(['a.ts'])
    expect(useEditorStore.getState().activePath[WS]).toBe('a.ts')
    expect(useEditorStore.getState().files[WS]['b.ts']).toBeUndefined()
    expect(window.oxe.fs.unwatchFile).toHaveBeenCalled()
  })

  it('pins tabs ahead of unpinned ones and keeps them through close-others', async () => {
    await useEditorStore.getState().openFile({ workspaceId: WS, rootPath: ROOT, relativePath: 'a.ts' })
    await useEditorStore.getState().openFile({ workspaceId: WS, rootPath: ROOT, relativePath: 'b.ts' })
    await useEditorStore.getState().openFile({ workspaceId: WS, rootPath: ROOT, relativePath: 'c.ts' })

    useEditorStore.getState().togglePin(WS, 'c.ts')
    expect(useEditorStore.getState().tabs[WS].map((tab) => tab.relativePath)).toEqual(['c.ts', 'a.ts', 'b.ts'])

    useEditorStore.getState().closeOtherTabs(WS, 'a.ts')
    expect(useEditorStore.getState().tabs[WS].map((tab) => tab.relativePath)).toEqual(['c.ts', 'a.ts'])
  })

  it('reorders tabs by drag', async () => {
    await useEditorStore.getState().openFile({ workspaceId: WS, rootPath: ROOT, relativePath: 'a.ts' })
    await useEditorStore.getState().openFile({ workspaceId: WS, rootPath: ROOT, relativePath: 'b.ts' })
    await useEditorStore.getState().openFile({ workspaceId: WS, rootPath: ROOT, relativePath: 'c.ts' })

    useEditorStore.getState().moveTab(WS, 'c.ts', 'a.ts')
    expect(useEditorStore.getState().tabs[WS].map((tab) => tab.relativePath)).toEqual(['c.ts', 'a.ts', 'b.ts'])
  })

  it('binary tabs are never read as text', async () => {
    await useEditorStore.getState().openFile({ workspaceId: WS, rootPath: ROOT, relativePath: 'logo.png' })

    expect(useEditorStore.getState().tabs[WS][0]).toMatchObject({ relativePath: 'logo.png', binary: true })
    expect(useEditorStore.getState().files[WS]['logo.png'].isLoading).toBe(false)
    expect(window.oxe.fs.readFile).not.toHaveBeenCalled()
  })

  it('restores a persisted session by re-reading the active tab', async () => {
    useEditorStore.setState({
      files: {},
      tabs: { [WS]: [{ relativePath: 'a.ts', pinned: false, binary: false }, { relativePath: 'b.ts', pinned: false, binary: false }] },
      activePath: { [WS]: 'b.ts' }
    })

    await useEditorStore.getState().restoreSession(WS, ROOT)

    expect(useEditorStore.getState().files[WS]['b.ts'].content).toBe('B')
    // Inactive tabs stay lazy.
    expect(useEditorStore.getState().files[WS]['a.ts']).toBeUndefined()
  })
})
