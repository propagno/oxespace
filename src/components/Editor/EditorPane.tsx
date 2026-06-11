import Editor from '@monaco-editor/react'
import { useEffect, useRef, useState, useCallback, type ReactElement } from 'react'
import { Mic, MicOff } from 'lucide-react'
import type { editor as monacoEditor } from 'monaco-editor'
import { useOxeVoice } from '../../hooks/useOxeVoice'
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
  const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null)

  const insertVoiceText = useCallback((text: string): void => {
    const editor = editorRef.current
    if (!editor) return
    const position = editor.getPosition()
    if (!position) return
    
    editor.executeEdits('oxevoice', [{
      range: {
        startLineNumber: position.lineNumber,
        startColumn: position.column,
        endLineNumber: position.lineNumber,
        endColumn: position.column
      },
      text: text + ' ',
      forceMoveMarkers: true
    }])
    editor.focus()
  }, [])

  const voice = useOxeVoice({ enabled: true, onFinalText: insertVoiceText })
  const isVoiceActive = voice.status === 'listening' || voice.status === 'transcribing'

  const holdTimerRef = useRef<number | null>(null)
  const holdingRef = useRef(false)
  const HOLD_THRESHOLD_MS = 220

  const onVoicePointerDown = useCallback((): void => {
    if (!voice.isSupported) return
    holdingRef.current = false
    holdTimerRef.current = window.setTimeout(() => {
      holdingRef.current = true
      voice.startHold()
    }, HOLD_THRESHOLD_MS)
  }, [voice])

  const onVoicePointerEnd = useCallback((): void => {
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
    if (holdingRef.current) {
      holdingRef.current = false
      voice.endHold()
    } else {
      voice.toggle()
    }
  }, [voice])

  const onVoicePointerCancel = useCallback((): void => {
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
    holdingRef.current = false
  }, [])

  useEffect(() => {
    const onToggle = () => voice.toggle()
    const onHoldStart = () => voice.startHold()
    const onHoldEnd = () => voice.endHold()

    window.addEventListener('oxe:editor-toggle-voice', onToggle)
    window.addEventListener('oxe:editor-voice-hold-start', onHoldStart)
    window.addEventListener('oxe:editor-voice-hold-end', onHoldEnd)

    return () => {
      window.removeEventListener('oxe:editor-toggle-voice', onToggle)
      window.removeEventListener('oxe:editor-voice-hold-start', onHoldStart)
      window.removeEventListener('oxe:editor-voice-hold-end', onHoldEnd)
    }
  }, [voice])

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className={`editor-dirty${isDirty ? ' active' : ''}`}>{file?.isSaving ? 'saving' : isDirty ? 'dirty' : 'saved'}</span>
            
            {voice.isSupported && (
              <button
                type="button"
                className={`tile-btn ${isVoiceActive ? 'active pulse' : ''}`}
                onPointerDown={onVoicePointerDown}
                onPointerUp={onVoicePointerEnd}
                onPointerCancel={onVoicePointerCancel}
                onContextMenu={(e) => e.preventDefault()}
                title="Tap to toggle dictation. Hold for push-to-talk."
                style={{ position: 'relative' }}
              >
                {isVoiceActive ? <Mic size={12} aria-hidden="true" /> : <MicOff size={12} aria-hidden="true" />}
                {isVoiceActive && (
                  <span
                    style={{
                      position: 'absolute',
                      bottom: -2,
                      left: 0,
                      height: 2,
                      background: 'var(--accent)',
                      width: `${Math.min(100, Math.max(0, voice.level * 100))}%`,
                      transition: 'width 50ms linear'
                    }}
                  />
                )}
              </button>
            )}
          </div>
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
                onMount={(editor) => {
                  editorRef.current = editor
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
