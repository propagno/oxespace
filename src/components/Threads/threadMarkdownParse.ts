import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { highlightCode, languageId, languageName, type CodeToken, type TokenKind } from './codeHighlight'
import { mathOf, protectMath } from './mathSource'

export interface ThreadNodeData {
  threadTokens?: CodeToken[]
  threadLanguageName?: string | null
  threadMathHtml?: string | null
}

export interface ThreadHastText {
  type: 'text'
  value: string
}

export interface ThreadHastElement {
  type: 'element'
  tagName: string
  properties: Record<string, unknown>
  children: ThreadHastChild[]
  data?: ThreadNodeData
}

export type ThreadHastChild = ThreadHastElement | ThreadHastText

export interface ThreadHastRoot {
  type: 'root'
  children: ThreadHastChild[]
}

const VALID_TOKEN_KINDS = new Set<TokenKind>([
  'comment', 'string', 'keyword', 'number', 'literal', 'function',
  'type', 'tag', 'attr', 'added', 'removed', 'meta'
])

/** HTML tags Markdown + GFM can legitimately emit; excludes executable/embedded tags like script, iframe, object, embed, style. */
const SAFE_TAGS = new Set<string>([
  'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'cite', 'code', 'col', 'colgroup',
  'dd', 'del', 'details', 'div', 'dl', 'dt', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'i', 'img', 'input', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'pre', 'q', 's',
  'samp', 'section', 'small', 'span', 'strong', 'sub', 'summary', 'sup',
  'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul', 'var'
])

const URL_PROPERTIES = new Set<string>([
  'action', 'background', 'cite', 'data', 'formaction', 'href', 'longdesc', 'ping', 'poster', 'src', 'usemap'
])

const UNSAFE_PROTOCOL = /^\s*(?:javascript|vbscript):/i
const DISALLOWED_PROPERTIES = new Set<string>(['dangerouslysetinnerhtml', 'srcdoc', 'formaction', 'xlink:href', 'xlinkhref'])

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)

function classNameOf(properties: Record<string, unknown> | undefined): string | undefined {
  const raw = properties?.className
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) return raw.filter((item): item is string => typeof item === 'string').join(' ')
  return undefined
}

function plainTextOf(children: unknown[]): string | null {
  let out = ''
  for (const child of children) {
    if (!child || typeof child !== 'object') return null
    const node = child as { type?: unknown; value?: unknown }
    if (node.type !== 'text' || typeof node.value !== 'string') return null
    out += node.value
  }
  return out
}

function stripAndEnrich(
  node: unknown,
  inPre: boolean,
  inLink: boolean,
  renderMath?: (tex: string, display: boolean) => string | null
): ThreadHastChild | null {
  if (!node || typeof node !== 'object') return null
  const record = node as { type?: unknown; value?: unknown; tagName?: unknown; properties?: Record<string, unknown>; children?: unknown[] }
  if (record.type === 'text') {
    return typeof record.value === 'string' ? { type: 'text', value: record.value } : null
  }
  if (record.type !== 'element' || typeof record.tagName !== 'string') return null

  const tagName = record.tagName
  const nextInPre = inPre || tagName === 'pre'
  const nextInLink = inLink || tagName === 'a'
  const rawChildren = Array.isArray(record.children) ? record.children : []
  const children: ThreadHastChild[] = []
  for (const child of rawChildren) {
    const clean = stripAndEnrich(child, nextInPre, nextInLink, renderMath)
    if (clean) children.push(clean)
  }

  const properties = record.properties ? { ...record.properties } : {}
  let data: ThreadNodeData | undefined

  if (tagName === 'code') {
    const className = classNameOf(properties)
    const text = plainTextOf(children)
    if (inPre && text !== null) {
      const special = /(?:^|\s)language-(math|mermaid)(?:\s|$)/.exec(className ?? '')?.[1]
      if (special === 'math') {
        const tex = text.replace(/\n$/, '')
        if (tex && renderMath) data = { threadMathHtml: renderMath(tex, true) }
      } else if (special !== 'mermaid' && className) {
        const id = languageId(className)
        data = {
          threadLanguageName: languageName(id),
          threadTokens: highlightCode(text, id)
        }
      }
    } else if (!inPre && !inLink && !className && text !== null) {
      const tex = mathOf(text)
      if (tex !== null && renderMath) data = { threadMathHtml: renderMath(tex, false) }
    }
  }

  return data
    ? { type: 'element', tagName, properties, children, data }
    : { type: 'element', tagName, properties, children }
}

/**
 * Parses Markdown (GFM) into a serializable hast root without allowDangerousHtml.
 * Attaches code highlight tokens/language names to fenced code blocks, and KaTeX HTML when `renderMath` is provided.
 */
export function parseMarkdownHast(
  text: string,
  renderMath?: (tex: string, display: boolean) => string | null
): ThreadHastRoot {
  const source = protectMath(text)
  const raw = processor.runSync(processor.parse(source)) as { children?: unknown[] }
  const children: ThreadHastChild[] = []
  for (const child of raw.children ?? []) {
    const clean = stripAndEnrich(child, false, false, renderMath)
    if (clean) children.push(clean)
  }
  return { type: 'root', children }
}

function sanitizeData(raw: unknown): ThreadNodeData | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const source = raw as Record<string, unknown>
  const out: ThreadNodeData = {}
  let hasAny = false

  if (Array.isArray(source.threadTokens)) {
    const tokens: CodeToken[] = []
    let valid = true
    for (const item of source.threadTokens) {
      if (!item || typeof item !== 'object') { valid = false; break }
      const token = item as { text?: unknown; kind?: unknown }
      if (typeof token.text !== 'string') { valid = false; break }
      if (token.kind !== null && (typeof token.kind !== 'string' || !VALID_TOKEN_KINDS.has(token.kind as TokenKind))) {
        valid = false
        break
      }
      tokens.push({ text: token.text, kind: token.kind as TokenKind | null })
    }
    if (valid) { out.threadTokens = tokens; hasAny = true }
  }

  if (typeof source.threadLanguageName === 'string' || source.threadLanguageName === null) {
    out.threadLanguageName = source.threadLanguageName
    hasAny = true
  }

  if (typeof source.threadMathHtml === 'string' || source.threadMathHtml === null) {
    out.threadMathHtml = source.threadMathHtml
    hasAny = true
  }

  return hasAny ? out : undefined
}

function sanitizeNode(node: unknown, urlTransform: (url: string, key: string) => string): ThreadHastChild | null {
  if (!node || typeof node !== 'object') return null
  const record = node as { type?: unknown; value?: unknown; tagName?: unknown; properties?: unknown; children?: unknown; data?: unknown }

  if (record.type === 'text') {
    return typeof record.value === 'string' ? { type: 'text', value: record.value } : null
  }
  if (record.type !== 'element' || typeof record.tagName !== 'string') return null

  const tagName = record.tagName.toLowerCase()
  if (!SAFE_TAGS.has(tagName)) return null

  const properties: Record<string, unknown> = {}
  if (record.properties && typeof record.properties === 'object' && !Array.isArray(record.properties)) {
    for (const [key, value] of Object.entries(record.properties as Record<string, unknown>)) {
      const lower = key.toLowerCase()
      if (lower.startsWith('on') || DISALLOWED_PROPERTIES.has(lower)) continue
      if (URL_PROPERTIES.has(lower)) {
        const transformed = urlTransform(String(value ?? ''), lower)
        properties[key] = UNSAFE_PROTOCOL.test(transformed) ? '' : transformed
        continue
      }
      if (typeof value === 'string') {
        if (UNSAFE_PROTOCOL.test(value)) continue
        properties[key] = value
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        properties[key] = value
      } else if (Array.isArray(value)) {
        properties[key] = value.filter((item): item is string | number =>
          (typeof item === 'string' && !UNSAFE_PROTOCOL.test(item)) || typeof item === 'number'
        )
      }
    }
  }

  const children: ThreadHastChild[] = []
  if (Array.isArray(record.children)) {
    for (const child of record.children) {
      const clean = sanitizeNode(child, urlTransform)
      if (clean) children.push(clean)
    }
  }

  const data = sanitizeData(record.data)
  return data
    ? { type: 'element', tagName, properties, children, data }
    : { type: 'element', tagName, properties, children }
}

/**
 * Sanitizes any hast tree (including forged payloads from a worker) before React renders it:
 * drops raw/executable nodes, strips on* handlers, and transforms URL properties.
 */
export function sanitizeThreadHast(
  tree: unknown,
  urlTransform: (url: string, key: string) => string
): ThreadHastRoot {
  if (!tree || typeof tree !== 'object') return { type: 'root', children: [] }
  const root = tree as { type?: unknown; children?: unknown }
  if (root.type !== 'root' || !Array.isArray(root.children)) return { type: 'root', children: [] }
  const children: ThreadHastChild[] = []
  for (const child of root.children) {
    const clean = sanitizeNode(child, urlTransform)
    if (clean) children.push(clean)
  }
  return { type: 'root', children }
}
