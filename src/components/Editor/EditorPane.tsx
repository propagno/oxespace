import Editor from '@monaco-editor/react'
import { lazy, Suspense, useEffect, useMemo, useRef, useState, useCallback, type ReactElement } from 'react'
import { Code2, Eye, GitCompareArrows, Mic, MicOff } from 'lucide-react'
import { openInChanges } from '../../store/changes-request.store'
import { WORKBENCH_PANELS } from '../Workbench/panelCatalog'
import type { editor as monacoEditor } from 'monaco-editor'
import { useOxeVoice } from '../../hooks/useOxeVoice'
// Side-effect: self-host Monaco (loader.config + local workers) so the Editor
// never reaches for the jsdelivr CDN — works behind corporate VPN/proxy and
// satisfies the packaged-build CSP. Must run before <Editor> mounts.
import '../../lib/monacoSetup'
import { MONACO_THEME } from '../../lib/monacoTheme'
import type { FileTreeNode } from '../../../shared/types/ipc'
import { selectActiveFile, useEditorStore } from '../../store/editor.store'
import { useShallow } from 'zustand/react/shallow'
import { isBinaryPreview, previewKind } from '../Preview/previewKind'
import { ConflictDiff } from './ConflictDiff'
import { EditorTabs } from './EditorTabs'
import { FileBrowser } from './FileBrowser'
import { useTranslation } from 'react-i18next'
import { EmptyState, ErrorState, LoadingState } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'

// #10 · Rich previews are lazy so react-markdown and the base64 plumbing stay out
// of the renderer entry chunk (budget: 500kB).
const MarkdownPreview = lazy(() => import('../Preview/MarkdownPreview').then((m) => ({ default: m.MarkdownPreview })))
const BinaryPreview = lazy(() => import('../Preview/BinaryPreview').then((m) => ({ default: m.BinaryPreview })))

interface EditorPaneProps {
  workspaceId: string
  rootPath: string
}

// Stable identities so the zustand selectors don't return a fresh object each render.
const EMPTY_TABS: never[] = []
const EMPTY_FILES = {} as Record<string, never>

export function EditorPane({ rootPath, workspaceId }: EditorPaneProps): ReactElement {
  const { t } = useTranslation('code')
  const paneRef = useRef<HTMLDivElement | null>(null)
  const resizeFrameRef = useRef<number | null>(null)
  const resizingTreeRef = useRef(false)
  const [treeWidth, setTreeWidth] = useState(() => {
    const saved = Number(window.localStorage.getItem('oxe.editor-tree-width'))
    return Number.isFinite(saved) && saved >= 180 && saved <= 520 ? saved : 240
  })
  const [paneWidth, setPaneWidth] = useState(0)
  const file = useEditorStore((state) => selectActiveFile(state, workspaceId))
  const tabs = useEditorStore((state) => state.tabs[workspaceId] ?? EMPTY_TABS)
  const workspaceFiles = useEditorStore((state) => state.files[workspaceId] ?? EMPTY_FILES)
  // The actions only: subscribing to the whole store re-rendered the editor on every change in any workspace.
  const { closeOtherTabs, closeTab, markExternalChange, moveTab, openFile, restoreSession, saveFile, togglePin, updateContent } =
    useEditorStore(useShallow((state) => ({ closeOtherTabs: state.closeOtherTabs, closeTab: state.closeTab, markExternalChange: state.markExternalChange, moveTab: state.moveTab, openFile: state.openFile, restoreSession: state.restoreSession, saveFile: state.saveFile, togglePin: state.togglePin, updateContent: state.updateContent })))
  const monacoHostRef = useRef<HTMLDivElement | null>(null)
  const [tree, setTree] = useState<FileTreeNode[]>([])
  const [treeError, setTreeError] = useState<string | null>(null)
  const [isLoadingTree, setIsLoadingTree] = useState(false)
  const [treeAttempt, setTreeAttempt] = useState(0)
  const reveal = useEditorStore((state) => state.reveal[workspaceId] ?? null)
  const [editorSize, setEditorSize] = useState({ width: 0, height: 0 })
  const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null)
  const [showRendered, setShowRendered] = useState(true)

  useEffect(() => {
    window.localStorage.setItem('oxe.editor-tree-width', String(treeWidth))
  }, [treeWidth])

  useEffect(() => {
    const host = paneRef.current
    if (!host) return
    const update = (): void => setPaneWidth(host.clientWidth)
    update()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }
    const observer = new ResizeObserver(update)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  useEffect(() => () => {
    if (resizeFrameRef.current !== null) window.cancelAnimationFrame(resizeFrameRef.current)
  }, [])

  const clampTreeWidth = useCallback((value: number): number => {
    const measured = paneRef.current?.clientWidth ?? 0
    const available = measured > 0 ? measured : 960
    return Math.round(Math.max(180, Math.min(520, available - 240, value)))
  }, [])
  const visibleTreeWidth = paneWidth > 0 ? Math.max(180, Math.min(treeWidth, paneWidth - 240)) : treeWidth

  const resizeTree = (value: number): void => {
    if (resizeFrameRef.current !== null) window.cancelAnimationFrame(resizeFrameRef.current)
    resizeFrameRef.current = window.requestAnimationFrame(() => {
      setTreeWidth(clampTreeWidth(value))
      resizeFrameRef.current = null
    })
  }

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

  // Tabs persist across restarts; their content does not, so re-read on mount.
  useEffect(() => {
    void restoreSession(workspaceId, rootPath)
  }, [restoreSession, rootPath, workspaceId])

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
        if (!cancelled) setTreeError(humanizeError(error))
      })
      .finally(() => {
        if (!cancelled) setIsLoadingTree(false)
      })
    return () => {
      cancelled = true
    }
  }, [rootPath, workspaceId, treeAttempt])

  const [editorReady, setEditorReady] = useState(0)
  // A search match asked for a line: scroll to it and put the cursor there once the text is in.
  useEffect(() => {
    const editor = editorRef.current
    if (!reveal || !editor || !file || file.isLoading || file.relativePath !== reveal.relativePath) return
    const line = Math.min(reveal.line, editor.getModel()?.getLineCount() ?? reveal.line)
    editor.setPosition({ lineNumber: line, column: 1 })
    editor.revealLineInCenter(line)
    editor.focus()
    useEditorStore.getState().clearReveal(workspaceId, reveal.seq)
  }, [reveal, file, editorReady, workspaceId])

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
    setShowRendered(true)
    void openFile({ workspaceId, rootPath, relativePath })
  }

  const activePath = file?.relativePath ?? null
  const activeKind = activePath ? previewKind(activePath) : null
  const binaryFile = activePath && activeKind && isBinaryPreview(activeKind)
    ? { relativePath: activePath, kind: activeKind }
    : null
  const isMarkdown = activeKind === 'markdown'
  // A line can only be shown in the source, so a Markdown file asked to reveal one opens as source.
  useEffect(() => useEditorStore.subscribe((state, previous) => {
    const next = state.reveal[workspaceId]
    if (next && next !== previous.reveal[workspaceId] && previewKind(next.relativePath) === 'markdown') setShowRendered(false)
  }), [workspaceId])
  const dirtyPaths = useMemo(
    () =>
      new Set(
        Object.values(workspaceFiles)
          .filter((entry) => entry.content !== entry.lastSavedContent)
          .map((entry) => entry.relativePath)
      ),
    [workspaceFiles]
  )

  return (
    <div className="editor-pane" ref={paneRef}>
      <aside className="editor-sidebar" style={{ flexBasis: visibleTreeWidth }}>
        <div className="editor-sidebar-title">{t('panels.files')}</div>
        {isLoadingTree ? <LoadingState label={t('editor.loadingFiles')} /> : null}
        {treeError ? <ErrorState compact title={t('editor.treeFailed')} message={treeError} onRetry={() => setTreeAttempt((value) => value + 1)} /> : null}
        {!isLoadingTree && !treeError ? <FileBrowser nodes={tree} rootPath={rootPath} workspaceId={workspaceId} selectedPath={activePath} onOpenFile={handleOpenFile} /> : null}
      </aside>
      <div
        className="editor-tree-resize"
        role="separator"
        aria-label={t('editor.treeWidth')}
        aria-orientation="vertical"
        aria-valuemin={180}
        aria-valuemax={520}
        aria-valuenow={visibleTreeWidth}
        tabIndex={0}
        onPointerDown={(event) => { resizingTreeRef.current = true; event.currentTarget.setPointerCapture?.(event.pointerId); event.preventDefault() }}
        onPointerMove={(event) => {
          if (resizingTreeRef.current) {
            const left = paneRef.current?.getBoundingClientRect().left ?? 0
            resizeTree(event.clientX - left)
          }
        }}
        onPointerUp={() => { resizingTreeRef.current = false }}
        onPointerCancel={() => { resizingTreeRef.current = false }}
        onLostPointerCapture={() => { resizingTreeRef.current = false }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault()
            setTreeWidth(clampTreeWidth(visibleTreeWidth + (event.key === 'ArrowLeft' ? -16 : 16)))
          }
          if (event.key === 'Home') { event.preventDefault(); setTreeWidth(clampTreeWidth(180)) }
          if (event.key === 'End') { event.preventDefault(); setTreeWidth(clampTreeWidth(520)) }
        }}
        onDoubleClick={() => resizeTree(240)}
      />
      <section className="editor-main" aria-label={t('editor.label')}>
        <EditorTabs
          tabs={tabs}
          activePath={activePath}
          dirtyPaths={dirtyPaths}
          onActivate={handleOpenFile}
          onClose={(relativePath) => closeTab(workspaceId, relativePath)}
          onCloseOthers={(relativePath) => closeOtherTabs(workspaceId, relativePath)}
          onTogglePin={(relativePath) => togglePin(workspaceId, relativePath)}
          onMove={(fromPath, toPath) => moveTab(workspaceId, fromPath, toPath)}
        />
        <header className="editor-toolbar">
          <span className="editor-path">{activePath ?? t('editor.noFile')}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {activePath && !workspaceId.startsWith('thread:') ? (
              <button
                type="button"
                className="tile-btn"
                onClick={() => openInChanges(workspaceId, { path: activePath })}
                aria-label={t('editor.compare', { panel: WORKBENCH_PANELS.changes.label })}
                title={t('editor.compareTitle', { panel: WORKBENCH_PANELS.changes.label })}
                data-testid="editor-open-in-changes"
              >
                <GitCompareArrows size={12} aria-hidden="true" />
              </button>
            ) : null}
            {isMarkdown ? (
              <button
                type="button"
                className={`tile-btn${showRendered ? ' active' : ''}`}
                onClick={() => setShowRendered((value) => !value)}
                aria-pressed={!showRendered}
                title={showRendered ? t('editor.showSource') : t('editor.showRendered')}
                data-testid="markdown-toggle"
              >
                {showRendered ? <Code2 size={12} aria-hidden="true" /> : <Eye size={12} aria-hidden="true" />}
              </button>
            ) : null}
            {binaryFile ? null : (
              <span className={`editor-dirty${isDirty ? ' active' : ''}`}>{file?.isSaving ? t('editor.saving') : isDirty ? t('editor.unsaved') : t('editor.saved')}</span>
            )}

            {voice.isSupported && (
              <button
                type="button"
                className={`tile-btn ${isVoiceActive ? 'active pulse' : ''}`}
                onPointerDown={onVoicePointerDown}
                onPointerUp={onVoicePointerEnd}
                onPointerCancel={onVoicePointerCancel}
                onContextMenu={(e) => e.preventDefault()}
                aria-label={t('editor.dictation')}
                aria-pressed={isVoiceActive}
                title={t('editor.dictationTitle')}
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
          {binaryFile ? (
            <Suspense fallback={<LoadingState label={t('editor.loadingPreview')} />}>
              <BinaryPreview
                workspaceId={workspaceId}
                rootPath={rootPath}
                relativePath={binaryFile.relativePath}
                kind={binaryFile.kind}
              />
            </Suspense>
          ) : null}
          {!binaryFile && file?.error ? <ErrorState compact title={t('editor.openFailed')} message={file.error} onRetry={() => void openFile({ workspaceId, rootPath, relativePath: file.relativePath })} /> : null}
          {!binaryFile && file?.conflict ? <ConflictDiff localContent={file.content} externalContent={file.conflict.externalContent} onResolve={(keep) => useEditorStore.getState().resolveConflict(workspaceId, keep)} /> : null}
          {!binaryFile && file && isMarkdown && showRendered ? (
            <div className="editor-preview-host scrollbar-sleek">
              <Suspense fallback={<LoadingState label={t('editor.loadingPreview')} />}>
                <MarkdownPreview content={file.content} />
              </Suspense>
            </div>
          ) : null}
          {!binaryFile && file && !(isMarkdown && showRendered) ? (
            <div className="editor-monaco-host" ref={monacoHostRef}>
              <Editor
                height={editorHeight}
                width={editorWidth}
                theme={MONACO_THEME}
                language={file.language}
                value={file.content}
                loading={<LoadingState label={t('editor.loadingEditor')} />}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  fontFamily: "'IBM Plex Mono', 'Cascadia Code', 'JetBrains Mono', 'DejaVu Sans Mono', monospace",
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
                  setEditorReady((value) => value + 1)
                }}
                onChange={(value) => updateContent(workspaceId, value ?? '')}
              />
            </div>
          ) : null}
          {!binaryFile && !file ? <EmptyState compact title={t('editor.selectFile')} /> : null}
        </div>
      </section>
    </div>
  )
}
