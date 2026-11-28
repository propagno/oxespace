import { Children, Suspense, cloneElement, createContext, isValidElement, useContext, useEffect, useMemo, useState, type ComponentPropsWithoutRef, type ReactElement, type ReactNode } from 'react'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'
import { toJsxRuntime, type Jsx } from 'hast-util-to-jsx-runtime'
import { defaultUrlTransform, type Components } from 'react-markdown'
import { Check, Copy, FileCode2, Info, Lightbulb, MessageSquareWarning, OctagonAlert, Terminal, TriangleAlert, WrapText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button, ErrorState } from '../../ui'
import { ExternalAnchor } from '../ExternalLinks/ExternalAnchor'
import { parseExternalUrl } from '../../lib/externalLinks'
import './ThreadMarkdown.css'
import { InCodeBlockContext, InlineCode, PathScopeContext } from '../PathMenu/PathLink'
import { PathLink } from './PathLink'
import { inlineImageSource, MAX_PROJECT_IMAGE_BYTES, projectImagePath } from './markdownImage'
import { mathOf } from './mathSource'
import { useThreadStore } from '../../store/thread.store'
import type { CodeToken } from './codeHighlight'
import { sanitizeThreadHast, type ThreadHastElement, type ThreadHastRoot, type ThreadNodeData } from './threadMarkdownParse'
import { getCachedThreadTree, hasRenderWorker, parseThreadMarkdownSync, requestThreadTree } from './threadRenderClient'
import { chunk, lazyFrom } from '../../lib/chunk'
import {
  classifyDiffLine,
  extractLanguageId,
  isDiffLanguage,
  isShellLanguage,
  prepareShellSnippet,
  ThreadCodeBlockActionsContext,
  type CodeBlockOpenInEditorInput,
  type CodeBlockRunInTerminalInput,
  type ThreadCodeBlockActions
} from './threadCodeBlockActions'

export {
  ThreadCodeBlockActionsContext,
  type CodeBlockOpenInEditorInput,
  type CodeBlockRunInTerminalInput,
  type ThreadCodeBlockActions
}

// Formulas and diagrams are drawn by libraries far larger than this file: each loads only for an answer that has one.
export const THREAD_MATH_CHUNK = chunk(() => import('./ThreadMath'))
export const THREAD_MERMAID_CHUNK = chunk(() => import('./ThreadMermaid'))
const MathView = lazyFrom(THREAD_MATH_CHUNK, module => module.MathView)
const MermaidDiagram = lazyFrom(THREAD_MERMAID_CHUNK, module => module.MermaidDiagram)

type Highlighter = typeof import('./codeHighlight')
let highlighter: Highlighter | null = null
let loadingHighlighter: Promise<Highlighter> | null = null

/**
 * Fallback code highlighter when a fenced block arrives without precomputed tokens in its hast node data.
 */
function useHighlighter(wanted: boolean): Highlighter | null {
  const [, setLoaded] = useState(0)
  useEffect(() => {
    if (!wanted || highlighter) return
    let live = true
    loadingHighlighter ??= import('./codeHighlight')
    void loadingHighlighter.then(module => { highlighter = module; if (live) setLoaded(value => value + 1) }, () => { loadingHighlighter = null })
    return () => { live = false }
  }, [wanted])
  return wanted ? highlighter : null
}

/** True inside a fenced block only (the block context is also on inside a link, where code stays plain). */
const FencedContext = createContext(false)
/** The answer is still arriving: the latest assistant message of a turn that runs. Diagrams read it and do not call a partial drawing a failure. */
const StreamingContext = createContext(false)

const NUMERIC_CELL = /^[-+]?[\d.,]+%?$/

function cellPlain(children: ReactNode): string {
  let out = ''
  Children.forEach(children, child => {
    if (typeof child === 'string' || typeof child === 'number') out += String(child)
    else if (isValidElement(child)) out += cellPlain((child.props as { children?: ReactNode }).children)
  })
  return out.replace(/\s+/g, ' ').trim()
}

/** A table cell: a number is marked so it sits right, in tabular figures; prose stays as it is. */
function MarkdownCell({ as: Tag, children }: { as: 'td' | 'th'; children?: ReactNode }): ReactElement {
  const numeric = NUMERIC_CELL.test(cellPlain(children))
  return <Tag {...(numeric ? { 'data-numeric': 'true' as const } : {})}>{children}</Tag>
}

/** A task box of the answer: checked or not, and never editable. */
function MarkdownInput({ node: _node, ...props }: ComponentPropsWithoutRef<'input'> & { node?: unknown }): ReactElement {
  if (props.type !== 'checkbox') return <input {...props} />
  const { checked, ...rest } = props
  return <input {...rest} type="checkbox" defaultChecked={Boolean(checked)} disabled />
}

function nodeDataOf(node: unknown): ThreadNodeData | undefined {
  if (!node || typeof node !== 'object') return undefined
  return (node as ThreadHastElement).data
}

function fencedCodeDataOf(preNode: unknown): ThreadNodeData | undefined {
  if (!preNode || typeof preNode !== 'object') return undefined
  const children = (preNode as ThreadHastElement).children
  if (!Array.isArray(children)) return undefined
  const code = children.find((child): child is ThreadHastElement => child.type === 'element' && child.tagName === 'code')
  return code?.data
}

/** The text of a fenced block, coloured by tokens precomputed in the worker (or fallback highlighter). Copy copies the same characters. */
function FencedCode({ className, text, tokens: precomputed }: { className?: string; text: string; tokens?: CodeToken[] }): ReactElement {
  const diff = isDiffLanguage(extractLanguageId(className))
  const lib = useHighlighter(Boolean(className) && !precomputed && !diff)
  const tokens = useMemo(() => (diff ? null : (precomputed ?? (lib ? lib.highlightCode(text, lib.languageId(className)) : null))), [diff, precomputed, lib, text, className])
  const diffLines = useMemo(() => {
    if (!diff) return null
    const trailingNewline = text.endsWith('\n')
    const lines = (trailingNewline ? text.slice(0, -1) : text).split('\n')
    return { lines, trailingNewline }
  }, [diff, text])

  if (diffLines) {
    const codeClassName = className ? `${className} thread-diff-code` : 'thread-diff-code'
    return <code className={codeClassName}>{diffLines.lines.map((line, index) => {
      const kind = classifyDiffLine(line)
      const needsNewline = index < diffLines.lines.length - 1 || diffLines.trailingNewline
      return <Fragment key={index}><span className={`thread-diff-code-line is-${kind}`} data-diff-line={kind}>{line}</span>{needsNewline ? '\n' : null}</Fragment>
    })}</code>
  }

  return <code className={className}>{tokens ? tokens.map((token, index) => token.kind ? <span key={index} className={`tk-${token.kind}`}>{token.text}</span> : token.text) : text}</code>
}

function CodeBlock({ children, language, languageName: precomputedName, filename, rawText, ...props }: ComponentPropsWithoutRef<'pre'> & { language?: string; languageName?: string | null; filename?: string | null; rawText?: string | null }) {
  const { t } = useTranslation('thread')
  const actions = useContext(ThreadCodeBlockActionsContext)
  const langId = extractLanguageId(language)
  const isShell = isShellLanguage(langId)
  const isDiff = isDiffLanguage(langId)
  const lib = useHighlighter(Boolean(language) && precomputedName === undefined)
  const name = precomputedName !== undefined ? precomputedName : (lib ? lib.languageName(lib.languageId(language)) : null)
  const [wrapped, setWrapped] = useState(false)
  const [copied, setCopied] = useState(false)
  const [ran, setRan] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  useEffect(() => {
    if (!ran) return
    const timer = setTimeout(() => setRan(false), 1800)
    return () => clearTimeout(timer)
  }, [ran])

  const readCode = (target: HTMLElement): string => {
    if (typeof rawText === 'string') return rawText
    return (target.closest('.thread-code-block')?.querySelector('code')?.textContent ?? '').replace(/\n$/, '')
  }

  const showRun = isShell && Boolean(actions?.onRunInTerminal)
  const showOpenInEditor = (!isShell || Boolean(filename)) && Boolean(actions?.onOpenInEditor)

  return <div className="thread-code-block" data-wrapped={wrapped ? 'true' : 'false'} data-diff={isDiff ? 'true' : undefined}>
    <div className="thread-code-toolbar">
      {(name || filename) ? <span className="thread-code-meta">
        {name ? <span data-testid="thread-code-language">{name}</span> : null}
        {filename ? <span className="thread-code-filename" data-testid="thread-code-filename" title={filename}>{filename}</span> : null}
      </span> : null}
      <div className="thread-code-actions" role="group" aria-label={t('markdown.codeActions')}>
        {showRun ? <Button
          variant="ghost"
          size="sm"
          className="thread-code-action thread-code-action-secondary"
          aria-label={t('markdown.runInTerminal')}
          title={t('markdown.runInTerminal')}
          onClick={event => {
            const code = readCode(event.currentTarget)
            const command = prepareShellSnippet(code, langId)
            void Promise.resolve(actions?.onRunInTerminal?.({ code, command, language: langId })).then(() => setRan(true), () => undefined)
          }}
        >{ran ? <Check size={12} className="oxe-confirm" aria-hidden="true" /> : <Terminal size={12} aria-hidden="true" />}<span>{ran ? t('markdown.sentToTerminal') : t('markdown.runInTerminalShort')}</span></Button> : null}
        {showOpenInEditor ? <Button
          variant="ghost"
          size="sm"
          className="thread-code-action thread-code-action-secondary"
          aria-label={t('markdown.openInEditor')}
          title={t('markdown.openInEditor')}
          onClick={event => {
            const code = readCode(event.currentTarget)
            void actions?.onOpenInEditor?.({ code, language: langId, languageName: name ?? null, filename: filename ?? null })
          }}
        ><FileCode2 size={12} aria-hidden="true" /><span>{t('markdown.openInEditorShort')}</span></Button> : null}
        <Button
          variant="ghost"
          size="sm"
          className="thread-code-action thread-code-action-secondary"
          aria-pressed={wrapped}
          aria-label={t('markdown.wrapCode')}
          title={t('markdown.wrapCode')}
          onClick={() => setWrapped(value => !value)}
        ><WrapText size={12} aria-hidden="true" /><span>{t('markdown.wrap')}</span></Button>
        <Button
          variant="ghost"
          size="sm"
          className="thread-code-action"
          aria-label={t('markdown.copyCode')}
          onClick={async event => {
            const code = readCode(event.currentTarget)
            try { await navigator.clipboard.writeText(code); setCopied(true); setError(false) }
            catch { setError(true); setCopied(false) }
          }}
        >{copied ? <Check size={12} className="oxe-confirm" aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}<span role="status" aria-live="polite">{copied ? t('markdown.copied') : t('markdown.copy')}</span></Button>
      </div>
    </div>
    <pre {...props}>{children}</pre>
    {error && <ErrorState compact title={t('markdown.copyFailed')} />}
  </div>
}

/** A path the agent named in inline code: a file name with an extension or a path with a separator, an optional :line[:col]. */
const PATH_MENTION = /^(?:[A-Za-z]:[\\/]|[\\/]|~[\\/]|\.{1,2}[\\/])?(?:[\w.@+-]+[\\/])*[\w.@+-]*\.[A-Za-z0-9]{1,10}(?::\d+(?::\d+)?)?$|^(?:[A-Za-z]:[\\/]|[\\/]|~[\\/]|\.{1,2}[\\/])?(?:[\w.@+-]+[\\/])+[\w.@+-]+(?::\d+(?::\d+)?)?$/

export function isPathMention(text: string): boolean {
  const value = text.trim()
  return value.length > 0 && value.length <= 4096 && !/\s/.test(value) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && PATH_MENTION.test(value)
}

/** The `language-…` class the parser put on the `<code>` of a fenced block, when the fence named one. */
function fenceLanguage(children: ReactNode): string | undefined {
  const code = Children.toArray(children).find(isValidElement)
  const className = code ? (code.props as { className?: unknown }).className : undefined
  return typeof className === 'string' && className.includes('language-') ? className : undefined
}

function textOf(children: ReactNode): string | null {
  return typeof children === 'string' ? children : Array.isArray(children) && children.every(part => typeof part === 'string') ? children.join('') : null
}

/** The text of a fenced block, without the line end the parser leaves after its last line. */
function fenceText(children: ReactNode): string | null {
  const code = Children.toArray(children).find(isValidElement)
  const text = code ? textOf((code.props as { children?: ReactNode }).children) : null
  return text === null ? null : text.replace(/\n$/, '')
}

/**
 * A fenced block: a formula (`math`, which is also what a `$$…$$` of the answer becomes), a diagram (`mermaid`), or
 * code. Uses precomputed language name / KaTeX HTML from the hast node when present.
 */
function Fence({ children, node }: { children?: ReactNode; node?: unknown }): ReactElement {
  const streaming = useContext(StreamingContext)
  const language = fenceLanguage(children)
  const kind = /(?:^|\s)language-(math|mermaid)(?:\s|$)/.exec(language ?? '')?.[1]
  const text = fenceText(children)
  const data = fencedCodeDataOf(node)
  const code = <InCodeBlockContext.Provider value><FencedContext.Provider value><CodeBlock language={language} languageName={data?.threadLanguageName} filename={data?.threadFilename} rawText={text}>{children}</CodeBlock></FencedContext.Provider></InCodeBlockContext.Provider>
  if (kind === 'math' && text) return <Suspense fallback={code}><MathView tex={text} display html={data?.threadMathHtml} /></Suspense>
  if (kind === 'mermaid' && text) return <Suspense fallback={code}><MermaidDiagram code={text} streaming={streaming} /></Suspense>
  return code
}

/** A16: inline code that names a path is resolved by main (PathLink) when the conversation is known; otherwise the F33 link. */
function MarkdownCode({ children, className, node, threadId, turnId }: { children?: ReactNode; className?: string; node?: unknown; threadId?: string; turnId?: string }) {
  const inBlock = useContext(InCodeBlockContext)
  const fenced = useContext(FencedContext)
  const text = textOf(children)
  const data = nodeDataOf(node)
  if (fenced && text !== null) return <FencedCode className={className} text={text} tokens={data?.threadTokens} />
  // An inline formula of the answer, which `protectMath` put in a marked code span.
  const tex = !inBlock && !className && text ? mathOf(text) : null
  if (tex !== null) return <Suspense fallback={<code className="thread-math-source">{tex}</code>}><MathView tex={tex} html={data?.threadMathHtml} /></Suspense>
  if (threadId && !inBlock && !className && text && isPathMention(text)) return <PathLink threadId={threadId} raw={text.trim()} {...(turnId ? { turnId } : {})} />
  return <InlineCode className={className}>{children}</InlineCode>
}

/**
 * An image in an answer: drawn when the answer carries it (`data:`) or when it is an image file of the conversation's
 * project, read through main. Anything else (an address on the network above all) stays the reference it was.
 */
function MarkdownImage({ src, alt, threadId }: { src?: string; alt?: string; threadId?: string }): ReactElement {
  const { t } = useTranslation('thread')
  const thread = useThreadStore(state => threadId ? state.threads.find(item => item.id === threadId) ?? (state.snapshot?.thread.id === threadId ? state.snapshot.thread : undefined) : undefined)
  // The project the text belongs to: the scope the timeline gives every message (the same one its file links use), or the conversation when it is named.
  const scope = useContext(PathScopeContext)
  const workspaceId = scope?.workspaceId ?? thread?.workspaceId, rootPath = scope?.rootPath ?? thread?.rootPath
  const inline = inlineImageSource(src)
  const file = inline || !rootPath ? null : projectImagePath(src, rootPath)
  const [loaded, setLoaded] = useState<{ file: string; source: string } | null>(null)
  useEffect(() => {
    if (!file || !workspaceId || !rootPath) return
    let live = true
    void window.oxe.fs.readBinary({ workspaceId, rootPath, relativePath: file }).then(result => {
      if (live && /^image\/(png|jpeg|gif|webp)$/.test(result.mimeType) && result.size <= MAX_PROJECT_IMAGE_BYTES) setLoaded({ file, source: `data:${result.mimeType};base64,${result.base64}` })
    }, () => undefined)
    return () => { live = false }
  }, [file, workspaceId, rootPath])
  const source = inline ?? (loaded && loaded.file === file ? loaded.source : null)
  if (source) return <img className="thread-markdown-image" src={source} alt={alt ?? ''} title={file ?? undefined} loading="lazy" />
  return <span className="thread-markdown-reference" title={file ?? undefined}>{alt ? t('markdown.imageAlt', { alt }) : t('markdown.image')}</span>
}

type AlertKind = 'note' | 'tip' | 'important' | 'warning' | 'caution'
/** The first line of a GitHub alert, read in any case as GitHub reads it: `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`. */
const ALERT_MARKER = /^\[!(note|tip|important|warning|caution)\][ \t]*(?:\r?\n|$)/i
const ALERT_ICONS = { note: Info, tip: Lightbulb, important: MessageSquareWarning, warning: TriangleAlert, caution: OctagonAlert } as const

/**
 * A quote whose first line is one of the five alert markers: its kind and the rest of the quote without the marker.
 * Null for any other quote, which stays a plain quote.
 */
function alertOf(children: ReactNode): { kind: AlertKind; rest: ReactNode[] } | null {
  const parts = Children.toArray(children)
  const index = parts.findIndex(part => typeof part !== 'string' || part.trim() !== '')
  const first = parts[index]
  if (!isValidElement(first) || first.type !== 'p') return null
  const inner = Children.toArray((first.props as { children?: ReactNode }).children)
  const lead = inner[0]
  if (typeof lead !== 'string') return null
  const match = ALERT_MARKER.exec(lead)
  if (!match) return null
  const remaining = [lead.slice(match[0].length), ...inner.slice(1)].filter(part => part !== '')
  const paragraph = remaining.length ? [cloneElement(first, undefined, ...remaining)] : []
  return { kind: match[1].toLowerCase() as AlertKind, rest: [...parts.slice(0, index), ...paragraph, ...parts.slice(index + 1)] }
}

/** A GitHub alert of the answer: a side rule and an icon in the kind's intent, its label, then the rest of the quote. */
function MarkdownAlert({ kind, children }: { kind: AlertKind; children?: ReactNode }): ReactElement {
  const { t } = useTranslation('thread')
  const Icon = ALERT_ICONS[kind]
  return <div className="thread-alert" data-ui="alert" data-kind={kind}>
    <div className="thread-alert-title"><Icon size={14} aria-hidden="true" focusable="false" className="thread-alert-icon" /><span>{t(`markdown.alert.${kind}`)}</span></div>
    {children}
  </div>
}

/** The parser drops every address that is not a web or mail one; an image the answer carries in a `data:` address is kept (it is checked again where it is drawn). */
function keepInlineImages(url: string, key: string): string {
  return key === 'src' && inlineImageSource(url) ? url : defaultUrlTransform(url)
}

/**
 * Settled answers parse Markdown, syntax highlight, diffs and KaTeX inside the dedicated render Web Worker and render
 * the sanitized hast tree through React (`hast-util-to-jsx-runtime`). Streaming answers and environments without
 * `Worker` (jsdom/tests) use the synchronous path with the exact same components and DOM output.
 */
export function ThreadMarkdown({ text, threadId, turnId, streaming = false, className }: { text: string; threadId?: string; turnId?: string; streaming?: boolean; className?: string }) {
  const { t } = useTranslation('thread')
  const useWorker = !streaming && hasRenderWorker()
  const cachedTree = useWorker ? getCachedThreadTree(text) : undefined
  const [workerResult, setWorkerResult] = useState<{ text: string; tree: ThreadHastRoot } | null>(null)
  const syncTree = useMemo(() => (useWorker ? null : parseThreadMarkdownSync(text)), [useWorker, text])

  useEffect(() => {
    if (!useWorker || cachedTree) return
    let live = true
    const cancel = requestThreadTree(text, tree => {
      if (live) setWorkerResult({ text, tree })
    })
    return () => { live = false; cancel() }
  }, [useWorker, cachedTree, text])

  const activeTree = useWorker
    ? (cachedTree ?? (workerResult && workerResult.text === text ? workerResult.tree : null))
    : syncTree

  // The same functions from one render to the next: a new one each time is, to React, a new kind of element, and
  // every block under it would be thrown away and built again (a diagram would lose its drawing while text streams).
  const components = useMemo<Components>(() => ({
    table: ({ children }) => <div className="thread-table-scroll" data-ui="md-table" role="region" aria-label={t('markdown.table')} tabIndex={0}><table>{children}</table></div>,
    td: ({ children }) => <MarkdownCell as="td">{children}</MarkdownCell>,
    th: ({ children }) => <MarkdownCell as="th">{children}</MarkdownCell>,
    input: props => <MarkdownInput {...props} />,
    pre: ({ children, node }) => <Fence node={node}>{children}</Fence>,
    // A quote that opens with [!NOTE], [!TIP], [!IMPORTANT], [!WARNING] or [!CAUTION] is a GitHub alert; any other stays a quote.
    blockquote: ({ children }) => {
      const alert = alertOf(children)
      return alert ? <MarkdownAlert kind={alert.kind}>{alert.rest}</MarkdownAlert> : <blockquote>{children}</blockquote>
    },
    // F33/A16: inline code that names a file is a link (PathLink with a conversation, else the path menu link).
    code: ({ children, className, node }) => <MarkdownCode className={className} node={node} threadId={threadId} turnId={turnId}>{children}</MarkdownCode>,
    // Code inside a link stays plain: a path button inside an anchor would be nested interactive content (FRONTEND #470).
    a: ({ href, children }) => <InCodeBlockContext.Provider value>{href && parseExternalUrl(href)
      ? <ExternalAnchor href={href}>{children}</ExternalAnchor>
      : <span className="thread-markdown-reference" title={href}>{children}</span>}</InCodeBlockContext.Provider>,
    img: ({ alt, src }) => <MarkdownImage alt={alt} src={typeof src === 'string' ? src : undefined} threadId={threadId} />
  }), [t, threadId, turnId])

  const content = useMemo(() => {
    if (!activeTree) return null
    const safeTree = sanitizeThreadHast(activeTree, keepInlineImages)
    return toJsxRuntime(safeTree as unknown as Parameters<typeof toJsxRuntime>[0], {
      Fragment,
      components: components as unknown as Parameters<typeof toJsxRuntime>[1]['components'],
      development: false,
      ignoreInvalidStyle: true,
      jsx: jsx as unknown as Jsx,
      jsxs: jsxs as unknown as Jsx,
      passKeys: true,
      passNode: true
    })
  }, [activeTree, components])

  return <StreamingContext.Provider value={streaming}>
    <div className={className ? `thread-markdown ${className}` : 'thread-markdown'}>
      {content ?? <p className="thread-markdown-pending">{text}</p>}
    </div>
  </StreamingContext.Provider>
}
