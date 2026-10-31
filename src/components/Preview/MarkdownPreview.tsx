import { type ReactElement } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { i18n } from '../../i18n'
import { ExternalAnchor } from '../ExternalLinks/ExternalAnchor'
import { parseExternalUrl } from '../../lib/externalLinks'

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
          // Links leave through openExternalLink, with the real host beside text that names somewhere else;
          // anything else (relative paths, other schemes) stays plain text instead of navigating the renderer.
          a: ({ href, children }) => href && parseExternalUrl(href)
            ? <ExternalAnchor href={href}>{children}</ExternalAnchor>
            : <span className="markdown-preview-reference" title={href}>{children}</span>,
          // Images inside markdown can't resolve workspace-relative paths under
          // the CSP; keep remote/data ones and drop the rest to avoid broken icons.
          img: ({ src, alt, ...props }) =>
            typeof src === 'string' && /^(https?:|data:)/i.test(src)
              ? <img {...props} src={src} alt={alt ?? ''} />
              : <span className="markdown-preview-img-skipped">{i18n.t('editor.imageSkipped', { ns: 'code', name: alt || src || '?' })}</span>
        }}
      >
        {content}
      </Markdown>
    </div>
  )
}
