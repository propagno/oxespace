// Frozen acceptance test for 1.5.0 A57, part 1 (cockpit removal R11; OXE program, phase F2, task FE-R11). Written by the
// planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/f2-removals-FRONTEND.json (FE-R11).
// Contract: EditorPane mounts Monaco with options.readOnly true and no onChange; its header shows "Read only · edit in
// your editor" and an "Open in editor" button that opens the file in the preferred external editor (window.oxe.app.openIn)
// at the editor's top visible line. With no external editor it says how to pick one, and its button opens Settings ›
// General (useUIStore.openSettingsPage('general')). Copy by DESIGN and HML (08/11).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { FileTreeNode } from '../../../shared/types/ipc'

const ROOT = process.cwd()
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')
function sources(dir: string): string[] {
  const out: string[] = []
  const walk = (rel: string): void => {
    for (const name of readdirSync(join(ROOT, rel))) {
      const path = `${rel}/${name}`
      if (statSync(join(ROOT, path)).isDirectory()) walk(path)
      else if (/\.(ts|tsx)$/.test(name)) out.push(path)
    }
  }
  walk(dir)
  return out
}

const mounted: Array<{ options?: { readOnly?: boolean }; onChange?: unknown }> = []
// Any method the viewer calls on the editor is a no-op, except the visible range: line 7 is at the top.
const fakeEditor = new Proxy({}, { get: (_target, key) => key === 'getVisibleRanges' ? () => [{ startLineNumber: 7, endLineNumber: 40 }] : () => ({ dispose: () => undefined }) })
function MockEditor({ language, value, options, onChange, onMount }: { language: string; value: string; options?: { readOnly?: boolean }; onChange?: unknown; onMount?: (editor: unknown, monaco: unknown) => void }) {
  mounted.push({ options, onChange })
  // Like Monaco: onMount runs once per mounted editor, whatever the parent re-renders.
  const once = useRef(false)
  useEffect(() => {
    if (once.current) return
    once.current = true
    onMount?.(fakeEditor, new Proxy({}, { get: () => () => undefined }))
  })
  return <textarea aria-label={`monaco-${language}`} value={value} readOnly={options?.readOnly} onChange={() => undefined} />
}
vi.mock('@monaco-editor/react', () => ({ default: MockEditor }))
vi.mock('../../../src/lib/monacoSetup', () => ({}))

const tree: FileTreeNode[] = [{ name: 'index.ts', relativePath: 'src/index.ts', type: 'file', size: 12 }]
let openIn: ReturnType<typeof vi.fn>, writeFile: ReturnType<typeof vi.fn>

function mockMain(editors: Array<{ id: string; name: string }>): void {
  openIn = vi.fn(async () => undefined)
  writeFile = vi.fn(async () => undefined)
  Object.assign(window, { oxe: {
    app: { version: '1.5.0', platform: 'win32', openIn, openInTargets: async () => ({ editors, preferred: editors[0]?.id ?? 'auto' }) },
    fs: {
      listTree: vi.fn(async () => tree),
      readFile: vi.fn(async () => ({ relativePath: 'src/index.ts', content: 'const a = 1', size: 11, mtimeMs: 1 })),
      readBinary: vi.fn(async () => undefined),
      writeFile,
      watchFile: vi.fn(async () => ({ watchId: 'watch-1' })),
      unwatchFile: vi.fn(async () => undefined),
      onFileChanged: vi.fn(() => () => undefined)
    }
  } })
}

async function openViewer(): Promise<HTMLElement> {
  const { useEditorStore } = await import('../../../src/store/editor.store')
  useEditorStore.setState({ files: {}, tabs: {}, activePath: {} })
  const { useOpenInStore } = await import('../../../src/lib/openIn')
  useOpenInStore.setState({ targets: null })
  const { EditorPane } = await import('../../../src/components/Editor/EditorPane')
  render(<EditorPane workspaceId="ws-1" rootPath="C:/repo" />)
  await userEvent.click(await screen.findByRole('treeitem', { name: /index\.ts/ }))
  return screen.findByLabelText('monaco-typescript')
}

beforeEach(() => { mounted.length = 0 })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('A57 · Monaco is read-only in OxeCode', () => {
  test('the OxeCode file viewer mounts Monaco read-only and offers no save', async () => {
    mockMain([{ id: 'vscode', name: 'VS Code' }])
    await openViewer()
    expect(mounted.length).toBeGreaterThan(0)
    expect(mounted.every(props => props.options?.readOnly === true)).toBe(true)
    expect(mounted.every(props => props.onChange === undefined)).toBe(true)
    expect(screen.queryByText(/^(Saved|Unsaved|Saving…?)$/)).toBeNull()
    expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull()
  })

  test('the viewer says it is read only next to Open in editor', async () => {
    mockMain([{ id: 'vscode', name: 'VS Code' }])
    await openViewer()
    expect(await screen.findByText('Read only · edit in your editor')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Open in editor/ })).toBeInTheDocument()
  })

  test('the editor store has no edit, save or conflict state', async () => {
    const { useEditorStore } = await import('../../../src/store/editor.store')
    const state = useEditorStore.getState() as unknown as Record<string, unknown>
    expect(['updateContent', 'saveFile', 'resolveConflict', 'hasDirtyEditor'].filter(name => name in state)).toEqual([])
    expect(read('src/store/editor.store.ts')).not.toMatch(/lastSavedContent|isSaving|saveError|registerUnsavedSource/)
    expect(read('src/App.tsx')).not.toMatch(/hasDirtyEditor|unsavedEditor/)
  })

  test('no renderer source writes a file and the viewer has no write path', async () => {
    expect(sources('src').filter(file => /fs\??\.writeFile\b/.test(read(file)))).toEqual([])
    expect(sources('src/components/Editor').filter(file => /onDidChangeModelContent|ConflictDiff|saveFile/.test(read(file)))).toEqual([])
    mockMain([{ id: 'vscode', name: 'VS Code' }])
    const viewer = await openViewer()
    viewer.focus()
    await userEvent.keyboard('{Control>}s{/Control}')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }))
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(writeFile).not.toHaveBeenCalled()
  })

  test("the viewer's Open in editor opens the file at its top visible line", async () => {
    mockMain([{ id: 'vscode', name: 'VS Code' }])
    await openViewer()
    await userEvent.click(await screen.findByRole('button', { name: /^Open in editor/ }))
    await waitFor(() => expect(openIn).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws-1', rootPath: 'C:/repo', path: 'src/index.ts', line: 7 })))
  })

  test('with no external editor the viewer says how to pick one and opens that setting', async () => {
    mockMain([])
    const { useUIStore } = await import('../../../src/store/ui.store')
    const openSettingsPage = vi.fn()
    useUIStore.setState({ openSettingsPage })
    await openViewer()
    await userEvent.click(await screen.findByRole('button', { name: /^Open in editor/ }))
    await waitFor(() => expect(document.body.textContent).toMatch(/No external editor found\. Pick one in Settings › General › External editor, or install VS Code\./))
    expect(openIn).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /External editor|Settings/ }))
    expect(openSettingsPage).toHaveBeenCalledWith('general')
  })

  test('SqlEditor stays editable', () => {
    expect(read('src/components/OxeQuery/SqlEditor.tsx')).toMatch(/@monaco-editor\/react/)
    const workbench = read('src/components/OxeQuery/SqlWorkbench.tsx')
    expect(workbench).toMatch(/<Editor\b[^>]*\bonChange=/)
    expect(workbench).not.toMatch(/<Editor\b[^>]*readOnly:\s*true/)
  })
})
