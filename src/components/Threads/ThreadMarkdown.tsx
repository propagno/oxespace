import { useEffect, useState, type ComponentPropsWithoutRef } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ErrorState } from '../../ui'
import './ThreadMarkdown.css'

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

/** Same parser for streaming and saved messages; no HTML execution or text rewriting. */
export function ThreadMarkdown({ text }: { text: string }) {
  const { t } = useTranslation('thread')
  return <div className="thread-markdown"><Markdown remarkPlugins={[remarkGfm]} components={{
    table: ({ children }) => <div className="thread-table-scroll" role="region" aria-label={t('markdown.table')} tabIndex={0}><table>{children}</table></div>,
    pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
    a: ({ href, children }) => href && /^https?:\/\//i.test(href)
      ? <a href={href} target="_blank" rel="noopener noreferrer" onClick={event => { event.preventDefault(); window.open(href, '_blank', 'noopener,noreferrer') }}>{children}</a>
      : <span className="thread-markdown-reference" title={href}>{children}</span>,
    img: ({ alt }) => <span className="thread-markdown-reference">{alt ? t('markdown.imageAlt', { alt }) : t('markdown.image')}</span>
  }}>{text}</Markdown></div>
}
