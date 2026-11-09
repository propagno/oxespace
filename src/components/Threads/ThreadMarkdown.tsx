import { useContext, useEffect, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ErrorState } from '../../ui'
import { ExternalAnchor } from '../ExternalLinks/ExternalAnchor'
import { parseExternalUrl } from '../../lib/externalLinks'
import './ThreadMarkdown.css'
import { InCodeBlockContext, InlineCode } from '../PathMenu/PathLink'
import { PathLink } from './PathLink'

function CodeBlock({ children, ...props }: ComponentPropsWithoutRef<'pre'>) {
  const { t } = useTranslation('thread')
  const [copied, setCopied] = useState(false), [error, setError] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])
  return <div className="thread-code-block">
    <div className="thread-code-toolbar"><span>{t('markdown.code')}</span><button type="button" aria-label={t('markdown.copyCode')} onClick={async event => {
      const code = event.currentTarget.closest('.thread-code-block')?.querySelector('code')?.textContent ?? ''
      try { await navigator.clipboard.writeText(code); setCopied(true); setError(false) }
      catch { setError(true); setCopied(false) }
    }}>{copied ? <Check size={12} className="oxe-confirm" /> : <Copy size={12} />}{copied ? t('markdown.copied') : t('markdown.copy')}</button></div>
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

function textOf(children: ReactNode): string | null {
  return typeof children === 'string' ? children : Array.isArray(children) && children.every(part => typeof part === 'string') ? children.join('') : null
}

/** A16: inline code that names a path is resolved by main (PathLink) when the conversation is known; otherwise the F33 link. */
function MarkdownCode({ children, className, threadId, turnId }: { children?: ReactNode; className?: string; threadId?: string; turnId?: string }) {
  const inBlock = useContext(InCodeBlockContext)
  const text = textOf(children)
  if (threadId && !inBlock && !className && text && isPathMention(text)) return <PathLink threadId={threadId} raw={text.trim()} {...(turnId ? { turnId } : {})} />
  return <InlineCode className={className}>{children}</InlineCode>
}

/**
 * Same parser for streaming and saved messages; no HTML execution or text rewriting. With `threadId` (and the turn),
 * path mentions in the agent's text become PathLinks that main resolves (A16).
 */
export function ThreadMarkdown({ text, threadId, turnId }: { text: string; threadId?: string; turnId?: string }) {
  const { t } = useTranslation('thread')
  return <div className="thread-markdown"><Markdown remarkPlugins={[remarkGfm]} components={{
    table: ({ children }) => <div className="thread-table-scroll" role="region" aria-label={t('markdown.table')} tabIndex={0}><table>{children}</table></div>,
    pre: ({ children }) => <InCodeBlockContext.Provider value><CodeBlock>{children}</CodeBlock></InCodeBlockContext.Provider>,
    // F33/A16: inline code that names a file is a link (PathLink with a conversation, else the path menu link).
    code: ({ children, className }) => <MarkdownCode className={className} threadId={threadId} turnId={turnId}>{children}</MarkdownCode>,
    // Code inside a link stays plain: a path button inside an anchor would be nested interactive content (FRONTEND #470).
    a: ({ href, children }) => <InCodeBlockContext.Provider value>{href && parseExternalUrl(href)
      ? <ExternalAnchor href={href}>{children}</ExternalAnchor>
      : <span className="thread-markdown-reference" title={href}>{children}</span>}</InCodeBlockContext.Provider>,
    img: ({ alt }) => <span className="thread-markdown-reference">{alt ? t('markdown.imageAlt', { alt }) : t('markdown.image')}</span>
  }}>{text}</Markdown></div>
}
