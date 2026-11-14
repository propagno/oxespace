import { useEffect, useMemo, useState, type ReactElement } from 'react'
import DOMPurify from 'dompurify'

type Katex = typeof import('katex').default
let katex: Katex | null = null
let loadingKatex: Promise<Katex> | null = null

/**
 * KaTeX, once its chunk and its stylesheet are in; null until then. Asked for only by an answer that has a formula,
 * so a conversation without one never loads it.
 */
function useKatex(): Katex | null {
  const [, setLoaded] = useState(0)
  useEffect(() => {
    if (katex) return
    let live = true
    loadingKatex ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([module]) => module.default)
    void loadingKatex.then(module => { katex = module; if (live) setLoaded(value => value + 1) }, () => { loadingKatex = null })
    return () => { live = false }
  }, [])
  return katex
}

/**
 * The formula as markup, or null when KaTeX cannot read it. The TeX comes from an agent: `trust` stays off (no
 * links, no images, no raw HTML), expansion and size are capped, and what KaTeX wrote is sanitized again.
 */
export function mathMarkup(lib: Katex, tex: string, display: boolean): string | null {
  try {
    const html = lib.renderToString(tex, { displayMode: display, throwOnError: true, strict: 'ignore', trust: false, output: 'htmlAndMathml', maxExpand: 1000, maxSize: 40 })
    return DOMPurify.sanitize(html, { USE_PROFILES: { html: true, mathMl: true } })
  } catch {
    return null
  }
}

/**
 * A formula of an answer, drawn. Until KaTeX is in, and for TeX it cannot read (an answer still arriving, a typo), the
 * source shows as code: nothing is lost and nothing flashes red.
 */
export function MathView({ tex, display = false }: { tex: string; display?: boolean }): ReactElement {
  const lib = useKatex()
  const markup = useMemo(() => lib ? mathMarkup(lib, tex, display) : null, [lib, tex, display])
  if (markup === null) return display ? <pre className="thread-math-source"><code>{tex}</code></pre> : <code className="thread-math-source">{tex}</code>
  return display
    ? <div className="thread-math thread-math-block" role="math" aria-label={tex} data-testid="thread-math-block" dangerouslySetInnerHTML={{ __html: markup }} />
    : <span className="thread-math" role="math" aria-label={tex} data-testid="thread-math" dangerouslySetInnerHTML={{ __html: markup }} />
}
