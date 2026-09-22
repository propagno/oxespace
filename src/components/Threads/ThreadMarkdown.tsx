import { useEffect, useState, type ComponentPropsWithoutRef } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Copy } from 'lucide-react'
import './ThreadMarkdown.css'

function CodeBlock({ children, ...props }: ComponentPropsWithoutRef<'pre'>) {
  const [copied, setCopied] = useState(false), [error, setError] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])
  return <div className="thread-code-block">
    <div className="thread-code-toolbar"><span>Code</span><button type="button" aria-label="Copy code" onClick={async event => {
      const code = event.currentTarget.closest('.thread-code-block')?.querySelector('code')?.textContent ?? ''
      try { await navigator.clipboard.writeText(code); setCopied(true); setError(false) }
      catch { setError(true); setCopied(false) }
    }}>{copied ? <Check size={12} /> : <Copy size={12} />}{copied ? 'Copied' : 'Copy'}</button></div>
    <pre {...props}>{children}</pre>
    {error && <p role="status" className="thread-code-copy-error">Could not copy. Select the code to copy it manually.</p>}
  </div>
}

/** Same parser for streaming and saved messages; no HTML execution or text rewriting. */
export function ThreadMarkdown({ text }: { text: string }) {
  return <div className="thread-markdown"><Markdown remarkPlugins={[remarkGfm]} components={{
    table: ({ children }) => <div className="thread-table-scroll" role="region" aria-label="Message table" tabIndex={0}><table>{children}</table></div>,
    pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
    a: ({ href, children }) => href && /^https?:\/\//i.test(href)
      ? <a href={href} target="_blank" rel="noopener noreferrer" onClick={event => { event.preventDefault(); window.open(href, '_blank', 'noopener,noreferrer') }}>{children}</a>
      : <span className="thread-markdown-reference" title={href}>{children}</span>,
    img: ({ alt }) => <span className="thread-markdown-reference">[Image{alt ? `: ${alt}` : ''}]</span>
  }}>{text}</Markdown></div>
}
