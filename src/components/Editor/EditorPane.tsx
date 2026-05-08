import Editor from '@monaco-editor/react'
import { useEffect, useState, type ReactElement } from 'react'
import type { FileTreeNode } from '../../../shared/types/ipc'
import type { WorkspacePane } from '../../../shared/types/workspace'
import { useEditorStore } from '../../store/editor.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { ConflictDiff } from './ConflictDiff'
import { FileBrowser } from './FileBrowser'

interface EditorPaneProps {
  pane: WorkspacePane
  workspaceId: string
}

export function EditorPane({ pane, workspaceId }: EditorPaneProps): ReactElement {
  const workspace = useWorkspaceStore((state) => state.workspaces.find((item) => item.id === workspaceId) ?? null)
  const file = useEditorStore((state) => state.files[pane.id] ?? null)
  const { markExternalChange, openFile, saveFile, updateContent } = useEditorStore()
  const [tree, setTree] = useState<FileTreeNode[]>([])
  const [treeError, setTreeError] = useState<string | null>(null)
  const [isLoadingTree, setIsLoadingTree] = useState(false)

  useEffect(() => {
    return window.oxe.fs.onFileChanged((event) => markExternalChange(event))
  }, [markExternalChange])

  useEffect(() => {
    if (!workspace) return
    let cancelled = false
    setIsLoadingTree(true)
    setTreeError(null)
    void window.oxe.fs
      .listTree({ workspaceId: workspace.id, rootPath: workspace.rootPath })
      .then((nodes) => {
        if (!cancelled) setTree(nodes)
      })
      .catch((error: unknown) => {
        if (!cancelled) setTreeError(toMessage(error))
      })
      .finally(() => {
        if (!cancelled) setIsLoadingTree(false)
      })
    return () => {
      cancelled = true
    }
  }, [workspace])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && file) {
        event.preventDefault()
        void saveFile(pane.id)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [file, pane.id, saveFile])

  const isDirty = Boolean(file && file.content !== file.lastSavedContent)

  const handleOpenFile = (relativePath: string): void => {
    if (!workspace) return
    void openFile({
      paneId: pane.id,
      workspaceId: workspace.id,
      rootPath: workspace.rootPath,
      relativePath
    })
  }

  return (
    <div className="editor-pane">
      <aside className="editor-sidebar">
        <div className="editor-sidebar-title">Files</div>
        {isLoadingTree ? <div className="editor-browser-empty">Loading</div> : null}
        {treeError ? <div className="editor-error">{treeError}</div> : null}
        {!isLoadingTree && !treeError ? <FileBrowser nodes={tree} selectedPath={file?.relativePath ?? null} onOpenFile={handleOpenFile} /> : null}
      </aside>
      <section className="editor-main" aria-label="Editor">
        <header className="editor-toolbar">
          <span className="editor-path">{file?.relativePath ?? 'No file selected'}</span>
          <span className={`editor-dirty${isDirty ? ' active' : ''}`}>{file?.isSaving ? 'saving' : isDirty ? 'dirty' : 'saved'}</span>
        </header>
        {file?.error ? <div className="editor-error">{file.error}</div> : null}
        {file?.conflict ? <ConflictDiff localContent={file.content} externalContent={file.conflict.externalContent} /> : null}
        {file ? (
          <Editor
            theme="vs-dark"
            language={file.language}
            value={file.content}
            loading={<div className="editor-loading">Loading</div>}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              fontFamily: 'Cascadia Code, JetBrains Mono, Fira Code, monospace',
              automaticLayout: true,
              scrollBeyondLastLine: false
            }}
            onChange={(value) => updateContent(pane.id, value ?? '')}
          />
        ) : (
          <div className="editor-empty">Select a file</div>
        )}
      </section>
    </div>
  )
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected file browser error'
}
