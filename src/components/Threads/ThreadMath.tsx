import { useEffect, useMemo, useState, type ReactElement } from 'react'
import DOMPurify from 'dompurify'

type Katex = typeof import('katex').default
let katex: Katex | null = null
let loadingKatex: Promise<Katex> | null = null
let katexCssLoaded = false
let loadingKatexCss: Promise<void> | null = null

/**
 * KaTeX, once its chunk and its stylesheet are in; null until then. Asked for only by an answer that has a formula
 * without precomputed worker markup, so a conversation without one never loads it.
 */
function useKatex(wanted: boolean): Katex | null {
  const [, setLoaded] = useState(0)
  useEffect(() => {
    if (!wanted || katex) return
    let live = true
    loadingKatex ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([module]) => {
      katexCssLoaded = true
      return module.default
    })
    void loadingKatex.then(module => { katex = module; if (live) setLoaded(value => value + 1) }, () => { loadingKatex = null })
    return () => { live = false }
  }, [wanted])
  return wanted ? katex : null
}

/** Loads only KaTeX's stylesheet when the worker already rendered the formula HTML off the main thread. */
function useKatexCss(wanted: boolean): void {
  useEffect(() => {
    if (!wanted || katexCssLoaded) return
    loadingKatexCss ??= import('katex/dist/katex.min.css').then(() => { katexCssLoaded = true }, () => { loadingKatexCss = null })
  }, [wanted])
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
 * A formula of an answer, drawn. Uses precomputed KaTeX HTML from the render worker when present (sanitized again),
 * falling back to lazy main-thread KaTeX while streaming or when no worker ran. Invalid TeX shows as code.
 */
export function MathView({ tex, display = false, html }: { tex: string; display?: boolean; html?: string | null }): ReactElement {
  const needsClientKatex = html === undefined
  const lib = useKatex(needsClientKatex)
  useKatexCss(typeof html === 'string')
  const markup = useMemo(() => {
    if (typeof html === 'string') return DOMPurify.sanitize(html, { USE_PROFILES: { html: true, mathMl: true } })
    if (html === null) return null
    return lib ? mathMarkup(lib, tex, display) : null
  }, [html, lib, tex, display])
  if (markup === null) return display ? <pre className="thread-math-source"><code>{tex}</code></pre> : <code className="thread-math-source">{tex}</code>
  return display
    ? <div className="thread-math thread-math-block" role="math" aria-label={tex} data-testid="thread-math-block" dangerouslySetInnerHTML={{ __html: markup }} />
    : <span className="thread-math" role="math" aria-label={tex} data-testid="thread-math" dangerouslySetInnerHTML={{ __html: markup }} />
}
