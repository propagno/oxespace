import { DiffEditor } from '@monaco-editor/react'
import { useEffect, useRef, type ReactElement } from 'react'
import type { DiffComment, DiffSide } from '../../../shared/types/diff-comments'
import { attachLineComments } from './diffLineComments'
// Self-hosts Monaco and registers its workers (CSP-compliant, offline).
import '../../lib/monacoSetup'
import { MONACO_THEME, defineMonacoTheme } from '../../lib/monacoTheme'

const HIDDEN_LINES = /^(\d+) hidden lines?$/

/** Monaco words the fold "N hidden lines"; the reference product says "N unmodified lines". */
function relabelFolds(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const match = HIDDEN_LINES.exec(node.nodeValue ?? '')
    if (match) node.nodeValue = `${match[1]} unmodified lines`
  }
}

export interface MonacoDiffReview {
  comments: DiffComment[]
  onAdd(side: DiffSide, lineNo: number, lineContent: string, body: string): void
  onRemove(id: string): void
}

/** Read-only, side-by-side diff that folds long unchanged runs, with per-line review comments. */
export default function MonacoDiff({ original, modified, language, path, review }: {
  original: string; modified: string; language: string; path: string; review?: MonacoDiffReview
}): ReactElement {
  const cleanup = useRef<Array<() => void>>([])
  const latest = useRef(review)
  const sync = useRef<(() => void) | null>(null)
  latest.current = review
  useEffect(() => () => { for (const dispose of cleanup.current.splice(0)) dispose() }, [])
  // Saved comments changed (added, removed or sent): redraw the zones under their lines.
  useEffect(() => { sync.current?.() }, [review?.comments])
  return <DiffEditor
    key={path}
    height="100%"
    original={original}
    modified={modified}
    language={language}
    theme={MONACO_THEME}
    beforeMount={defineMonacoTheme}
    // The wrapper disposes the models before the diff widget lets go of them, which Monaco reports as an error
    // ("TextModel got disposed before DiffEditorWidget model got reset"). Keep them, and dispose them once the
    // editor is gone (below).
    keepCurrentOriginalModel
    keepCurrentModifiedModel
    onMount={(editor, monaco) => {
      for (const dispose of cleanup.current.splice(0)) dispose()
      const models = editor.getModel()
      cleanup.current.push(() => { setTimeout(() => { models?.original.dispose(); models?.modified.dispose() }) })
      const dom = editor.getContainerDomNode()
      let frame = 0
      const observer = new MutationObserver(() => {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(() => relabelFolds(dom))
      })
      observer.observe(dom, { childList: true, subtree: true, characterData: true })
      relabelFolds(dom)
      const comments = attachLineComments(editor, monaco, {
        comments: () => latest.current?.comments ?? [],
        add: (side, lineNo, lineContent, body) => latest.current?.onAdd(side, lineNo, lineContent, body),
        remove: id => latest.current?.onRemove(id)
      })
      sync.current = comments.sync
      cleanup.current.push(() => { sync.current = null; comments.dispose(); cancelAnimationFrame(frame); observer.disconnect() })
    }}
    options={{
      readOnly: true,
      originalEditable: false,
      renderSideBySide: true,
      automaticLayout: true,
      renderOverviewRuler: false,
      scrollBeyondLastLine: false,
      minimap: { enabled: false },
      fontSize: 12,
      fontFamily: 'var(--font-mono)',
      hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 3, revealLineCount: 20 }
    }}
  />
}
