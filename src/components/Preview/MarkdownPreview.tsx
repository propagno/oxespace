import { type ReactElement } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MarkdownPreviewProps {
  content: string
}

/**
 * #10 · Rendered Markdown for docs/READMEs/agent output. GFM enabled (tables,
 * task lists, strikethrough). Links open in the OS browser rather than
 * navigating the renderer away from the app.
 */
export function MarkdownPreview({ content }: MarkdownPreviewProps): ReactElement {
  return (
    <div className="markdown-preview" data-testid="markdown-preview">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, ...props }) => (
            <a
              {...props}
              href={href}
              onClick={(e) => {
                e.preventDefault()
                if (href && /^https?:/i.test(href)) void window.open(href, '_blank', 'noopener')
              }}
            >
              {children}
            </a>
          ),
          // Images inside markdown can't resolve workspace-relative paths under
          // the CSP; keep remote/data ones and drop the rest to avoid broken icons.
          img: ({ src, alt, ...props }) =>
            typeof src === 'string' && /^(https?:|data:)/i.test(src)
              ? <img {...props} src={src} alt={alt ?? ''} />
              : <span className="markdown-preview-img-skipped">[image: {alt || src || 'unresolved'}]</span>
        }}
      >
        {content}
      </Markdown>
    </div>
  )
}
