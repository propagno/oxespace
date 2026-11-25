import katex from 'katex'
import { parseMarkdownHast, type ThreadHastElement, type ThreadHastRoot, type ThreadNodeData } from './threadMarkdownParse'

export type { ThreadHastElement, ThreadHastRoot, ThreadNodeData }

/**
 * Renders TeX to HTML via KaTeX without touching the DOM (`trust: false`, bounded expansion/size).
 * Returns null for invalid TeX so the renderer shows the raw formula source instead of a red error.
 */
function renderKatexHtml(tex: string, display: boolean): string | null {
  try {
    return katex.renderToString(tex, {
      displayMode: display,
      throwOnError: true,
      strict: 'ignore',
      trust: false,
      output: 'htmlAndMathml',
      maxExpand: 1000,
      maxSize: 40
    })
  } catch {
    return null
  }
}

/**
 * Parses an OxeChat answer into a JSON-serializable hast root (GFM, code highlight tokens, diff tokens, KaTeX HTML).
 * Runs inside the dedicated Web Worker (`src/workers/threadRender.worker.ts`) and can be called directly in tests.
 */
export function parseThreadMarkdown(text: string): ThreadHastRoot {
  return parseMarkdownHast(text, renderKatexHtml)
}
