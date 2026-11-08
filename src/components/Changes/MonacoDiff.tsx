import { DiffEditor } from '@monaco-editor/react'
import { useEffect, useRef, type ReactElement } from 'react'
import type { DiffComment, DiffSide } from '../../../shared/types/diff-comments'
import { attachLineComments } from './diffLineComments'
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
    onMount={(editor, monaco) => {
      for (const dispose of cleanup.current.splice(0)) dispose()
      const dom = editor.getContainerDomNode()
      let frame = 0
      const observer = new MutationObserver(() => {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(() => relabelFolds(dom))
      })
      observer.observe(dom, { childList: true, subtree: true, characterData: true })
      relabelFolds(dom)
      // FL-15: Monaco measures its font's character widths once. When the mono web font was still loading, the
      // line-number gutter and the cursor kept the fallback font's widths (the diff sat 16 px off, launch to launch).
      // Load that font and measure again once it is in, then lay the diff out again with the new widths. The container
      // says when that is done (data-fonts-measured): a fallback layout can hold still for a while, so "stopped moving"
      // alone doesn't mean measured (FL-15 came back on the Windows runner after #586).
      // On Linux it came back again: `fonts.load` can resolve before the font's @font-face rules are even registered
      // (nothing to load yet), so the mark went up while the gutter still used the fallback's digits. Now the mark waits
      // until a face of the first family in --font-mono is actually loaded (up to 5 s; then it goes up anyway, so a
      // missing font never blocks), and any later font load measures again.
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
