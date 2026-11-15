import { DiffEditor, type DiffOnMount } from '@monaco-editor/react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import type { DiffComment, DiffSide } from '../../../shared/types/diff-comments'
import { attachLineComments } from './diffLineComments'
import { HunkOpenMenu } from './HunkOpenMenu'
import { hunkTargets, hunkDecorations, type LineChange } from './diffHunkOpen'
import { i18n } from '../../i18n'
// Self-hosts Monaco and registers its workers (CSP-compliant, offline).
import '../../lib/monacoSetup'
import { MONACO_THEME, defineMonacoTheme } from '../../lib/monacoTheme'

const HIDDEN_LINES = /^(\d+) hidden lines?$/

/** Monaco words the fold "N hidden lines"; the reference product says "N unmodified lines". */
function relabelFolds(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const match = HIDDEN_LINES.exec(node.nodeValue ?? '')
    if (match) node.nodeValue = i18n.t('changes.unmodified', { ns: 'code', count: Number(match[1]) })
  }
}

export interface MonacoDiffReview {
  comments: DiffComment[]
  onAdd(side: DiffSide, lineNo: number, lineContent: string, body: string): void
  onRemove(id: string): void
}

type DiffEditorInstance = Parameters<DiffOnMount>[0]

/**
 * One object for every render: @monaco-editor/react applies `options` again whenever their identity changes, and each
 * pass made Monaco re-derive both sides' options (OXE-158: a re-render after mount took the old side's glyph lane away).
 */
const DIFF_OPTIONS: MonacoEditor.IDiffEditorConstructionOptions = {
  readOnly: true,
  originalEditable: false,
  glyphMargin: true,
  renderSideBySide: true,
  automaticLayout: true,
  renderOverviewRuler: false,
  scrollBeyondLastLine: false,
  minimap: { enabled: false },
  fontSize: 12,
  fontFamily: 'var(--font-mono)',
  hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 3, revealLineCount: 20 }
}

/** Read-only, side-by-side diff that folds long unchanged runs, with per-line review comments. */
export default function MonacoDiff({ original, modified, language, path, review, onOpenHunk }: {
  original: string; modified: string; language: string; path: string; review?: MonacoDiffReview; onOpenHunk?: (line: number) => void
}): ReactElement {
  const cleanup = useRef<Array<() => void>>([])
  const diffEditorRef = useRef<DiffEditorInstance | null>(null)
  const modelsRef = useRef<{ original?: { dispose(): void } | null; modified?: { dispose(): void } | null } | null>(null)
  const latest = useRef(review)
  const sync = useRef<(() => void) | null>(null)
  const [targets, setTargets] = useState<Array<{ line: number }>>([])
  latest.current = review

  // Reset the DiffEditorWidget model BEFORE disposing TextModels so Monaco never throws
  // "TextModel got disposed before DiffEditorWidget model got reset" when closing Changes.
  useLayoutEffect(() => () => {
    for (const dispose of cleanup.current.splice(0)) dispose()
    const editor = diffEditorRef.current
    const models = editor?.getModel?.() ?? modelsRef.current
    diffEditorRef.current = null
    modelsRef.current = null
    try { editor?.setModel(null) } catch { /* widget already disposed */ }
    try { models?.original?.dispose() } catch { /* model already disposed */ }
    try { models?.modified?.dispose() } catch { /* model already disposed */ }
  }, [path])

  // Saved comments changed (added, removed or sent): redraw the zones under their lines.
  useEffect(() => { sync.current?.() }, [review?.comments])

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {targets.length > 0 && onOpenHunk && (
        <div style={{ padding: '4px 8px', borderBottom: '1px solid var(--bd-default)', display: 'flex', justifyContent: 'flex-end' }}>
          <HunkOpenMenu targets={targets} onOpen={onOpenHunk} />
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0 }} data-read-only-editor="">
        <DiffEditor
          key={path}
          height="100%"
          original={original}
          modified={modified}
          language={language}
          theme={MONACO_THEME}
          keepCurrentOriginalModel
          keepCurrentModifiedModel
          beforeMount={defineMonacoTheme}
          onMount={(editor, monaco) => {
            for (const dispose of cleanup.current.splice(0)) dispose()
            diffEditorRef.current = editor
            modelsRef.current = editor.getModel()
            const dom = editor.getContainerDomNode()
            let frame = 0
            const observer = new MutationObserver(() => {
              cancelAnimationFrame(frame)
              frame = requestAnimationFrame(() => relabelFolds(dom))
            })
            observer.observe(dom, { childList: true, subtree: true, characterData: true })
            relabelFolds(dom)

            const lineChanges = (editor.getLineChanges() ?? []) as unknown as LineChange[]
            const foundTargets = hunkTargets(lineChanges)
            setTargets(foundTargets)
            const modifiedEditor = editor.getModifiedEditor()
            let currentDecorations: string[] = []
            if (foundTargets.length > 0) {
              currentDecorations = modifiedEditor.deltaDecorations([], hunkDecorations(foundTargets) as unknown as Parameters<typeof modifiedEditor.deltaDecorations>[1])
            }
            editor.onDidUpdateDiff(() => {
              modelsRef.current = editor.getModel()
              const updated = hunkTargets((editor.getLineChanges() ?? []) as unknown as LineChange[])
              setTargets(updated)
              currentDecorations = modifiedEditor.deltaDecorations(currentDecorations, hunkDecorations(updated) as unknown as Parameters<typeof modifiedEditor.deltaDecorations>[1])
            })

            let measuring = true
            dom.removeAttribute('data-fonts-measured')
            const family = getComputedStyle(dom).getPropertyValue('--font-mono').trim()
            const primary = family.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '') ?? ''
            const remeasure = (): void => {
              if (!measuring) return
              monaco.editor.remeasureFonts()
              editor.layout()
            }
            const faceLoaded = (): boolean => !primary || !document.fonts
              || [...document.fonts].some(face => face.family.replace(/^['"]|['"]$/g, '') === primary && face.status === 'loaded')
            const started = Date.now()
            const settle = (): void => {
              if (!measuring) return
              if (!faceLoaded() && Date.now() - started < 5000) { window.setTimeout(settle, 50); return }
              remeasure()
              dom.setAttribute('data-fonts-measured', 'true')
            }
            void Promise.resolve(primary ? document.fonts?.load(`12px "${primary}"`) : undefined)
              .then(() => document.fonts?.ready)
              .then(settle, settle)
            document.fonts?.addEventListener('loadingdone', remeasure)
            cleanup.current.push(() => { measuring = false; document.fonts?.removeEventListener('loadingdone', remeasure) })
            const comments = attachLineComments(editor, monaco, {
              comments: () => latest.current?.comments ?? [],
              add: (side, lineNo, lineContent, body) => latest.current?.onAdd(side, lineNo, lineContent, body),
              remove: id => latest.current?.onRemove(id)
            })
            sync.current = comments.sync
            // OXE-158: in the inline view (a panel narrower than Monaco's 900 px breakpoint) Monaco turns the old side's glyph
            // margin off each time it applies the diff's options again (a re-render, the width crossing the breakpoint).
            // The comment "+" on a removed line lives in that lane, and losing it moved the whole diff 16 px (FL-15).
            const oldSide = editor.getOriginalEditor()
            const glyphMargin = monaco.editor.EditorOption.glyphMargin
            const keepLane = oldSide.onDidChangeConfiguration(event => {
              if (event.hasChanged(glyphMargin) && !oldSide.getOption(glyphMargin)) queueMicrotask(() => { if (measuring) oldSide.updateOptions({ glyphMargin: true }) })
            })
            cleanup.current.push(() => keepLane.dispose())
            cleanup.current.push(() => { sync.current = null; comments.dispose(); cancelAnimationFrame(frame); observer.disconnect() })
          }}
          options={DIFF_OPTIONS}
        />
      </div>
    </div>
  )
}
