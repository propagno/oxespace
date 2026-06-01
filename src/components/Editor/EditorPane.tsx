import Editor from '@monaco-editor/react'
import { useEffect, useRef, useState, type ReactElement } from 'react'
// Side-effect: self-host Monaco (loader.config + local workers) so the Editor
// never reaches for the jsdelivr CDN — works behind corporate VPN/proxy and
// satisfies the packaged-build CSP. Must run before <Editor> mounts.
import '../../lib/monacoSetup'
import type { FileTreeNode } from '../../../shared/types/ipc'
import { useEditorStore } from '../../store/editor.store'
import { ConflictDiff } from './ConflictDiff'
import { FileBrowser } from './FileBrowser'

interface EditorPaneProps {
  workspaceId: string
  rootPath: string
}

export function EditorPane({ rootPath, workspaceId }: EditorPaneProps): ReactElement {
  const file = useEditorStore((state) => state.files[workspaceId] ?? null)
  const { markExternalChange, openFile, saveFile, updateContent } = useEditorStore()
  const monacoHostRef = useRef<HTMLDivElement | null>(null)
  const [tree, setTree] = useState<FileTreeNode[]>([])
  const [treeError, setTreeError] = useState<string | null>(null)
  const [isLoadingTree, setIsLoadingTree] = useState(false)
  const [editorSize, setEditorSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    return window.oxe.fs.onFileChanged((event) => markExternalChange(event))
  }, [markExternalChange])

  useEffect(() => {
    let cancelled = false
    setIsLoadingTree(true)
    setTreeError(null)
    void window.oxe.fs
      .listTree({ workspaceId, rootPath })
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
  }, [rootPath, workspaceId])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && file) {
        event.preventDefault()
        void saveFile(workspaceId)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [file, saveFile, workspaceId])

  useEffect(() => {
    const element = monacoHostRef.current
    if (!element) return undefined

    const updateSize = (): void => {
      const rect = element.getBoundingClientRect()
      const width = Math.floor(rect.width)
      const height = Math.floor(rect.height)
      setEditorSize((current) => {
        if (Math.abs(current.width - width) < 2 && Math.abs(current.height - height) < 2) return current
        return { width, height }
      })
    }

    updateSize()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateSize)
      return () => window.removeEventListener('resize', updateSize)
    }

    const observer = new ResizeObserver(updateSize)
    observer.observe(element)
    window.addEventListener('resize', updateSize)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateSize)
    }
  }, [file?.relativePath])

  const isDirty = Boolean(file && file.content !== file.lastSavedContent)
  const editorWidth = editorSize.width > 0 ? editorSize.width : '100%'
  const editorHeight = editorSize.height > 0 ? editorSize.height : '100%'

  const handleOpenFile = (relativePath: string): void => {
    void openFile({
      workspaceId,
      rootPath,
      relativePath
    })
  }

  return (
    <div className="editor-pane">
      <aside className="editor-sidebar">
        <div className="editor-sidebar-title">Files</div>
        {isLoadingTree ? <div className="editor-browser-empty">Loading</div> : null}
        {treeError ? <div className="editor-error">{treeError}</div> : null}
        {!isLoadingTree && !treeError ? <FileBrowser nodes={tree} rootPath={rootPath} workspaceId={workspaceId} selectedPath={file?.relativePath ?? null} onOpenFile={handleOpenFile} /> : null}
      </aside>
      <section className="editor-main" aria-label="Editor">
        <header className="editor-toolbar">
          <span className="editor-path">{file?.relativePath ?? 'No file selected'}</span>
          <span className={`editor-dirty${isDirty ? ' active' : ''}`}>{file?.isSaving ? 'saving' : isDirty ? 'dirty' : 'saved'}</span>
        </header>
        <div className="editor-body">
          {file?.error ? <div className="editor-error">{file.error}</div> : null}
          {file?.conflict ? <ConflictDiff localContent={file.content} externalContent={file.conflict.externalContent} /> : null}
          {file ? (
            <div className="editor-monaco-host" ref={monacoHostRef}>
              <Editor
                height={editorHeight}
                width={editorWidth}
                theme="vs-dark"
                language={file.language}
                value={file.content}
                loading={<div className="editor-loading">Loading</div>}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  fontFamily: 'Cascadia Code, JetBrains Mono, Fira Code, monospace',
                  automaticLayout: true,
                  scrollBeyondLastLine: false,
                  scrollbar: {
                    alwaysConsumeMouseWheel: true,
                    horizontal: 'visible',
                    vertical: 'visible'
                  }
                }}
                onChange={(value) => updateContent(workspaceId, value ?? '')}
              />
            </div>
          ) : (
            <div className="editor-empty">Select a file</div>
          )}
        </div>
      </section>
    </div>
  )
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected file browser error'
}
