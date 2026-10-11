import { DiffEditor, type Monaco } from '@monaco-editor/react'
import { useEffect, useRef, type ReactElement } from 'react'
import type { DiffComment, DiffSide } from '../../../shared/types/diff-comments'
import { attachLineComments } from './diffLineComments'
// Self-hosts Monaco and registers its workers (CSP-compliant, offline).
import '../../lib/monacoSetup'

const THEME = 'oxe-diff'

function token(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value.startsWith('#') ? value : fallback
}

/** Diff colours follow the workspace theme; additions/removals match the reference. */
function defineTheme(monaco: Monaco): void {
  monaco.editor.defineTheme(THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': token('--bg-app', '#21222c'),
      'editorGutter.background': token('--bg-app', '#21222c'),
      'editor.lineHighlightBackground': '#00000000',
      'editorLineNumber.foreground': token('--tx-muted', '#8a8a8f'),
      'diffEditor.insertedLineBackground': '#2ea04326',
      'diffEditor.removedLineBackground': '#f8514926',
      'diffEditor.insertedTextBackground': '#2ea04340',
      'diffEditor.removedTextBackground': '#f8514940',
      'diffEditorGutter.insertedLineBackground': '#2ea04340',
      'diffEditorGutter.removedLineBackground': '#f8514940',
      'diffEditor.unchangedRegionBackground': token('--bg-sidebar', '#282a36'),
      'diffEditor.unchangedRegionForeground': token('--tx-secondary', '#c5c5c5'),
      'diffEditor.border': token('--wb-border', '#414249')
    }
  })
}

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
    theme={THEME}
    beforeMount={defineTheme}
    onMount={(editor, monaco) => {
      for (const dispose of cleanup.current.splice(0)) dispose()
      const dom = editor.getContainerDomNode()
      let frame = 0
      const observer = new MutationObserver(() => {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(() => relabelFolds(dom))
      })
      observer.observe(dom, { childList: true, subtree: true, characterData: true })
      // Follow workspace theme switches without remounting the editor.
      const themeObserver = new MutationObserver(() => { defineTheme(monaco); monaco.editor.setTheme(THEME) })
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
      relabelFolds(dom)
      const comments = attachLineComments(editor, monaco, {
        comments: () => latest.current?.comments ?? [],
        add: (side, lineNo, lineContent, body) => latest.current?.onAdd(side, lineNo, lineContent, body),
        remove: id => latest.current?.onRemove(id)
      })
      sync.current = comments.sync
      cleanup.current.push(() => { sync.current = null; comments.dispose(); cancelAnimationFrame(frame); observer.disconnect(); themeObserver.disconnect() })
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
