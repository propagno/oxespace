import { type ReactElement } from 'react'
import Markdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { i18n } from '../../i18n'
import { ExternalAnchor } from '../ExternalLinks/ExternalAnchor'
import { parseExternalUrl } from '../../lib/externalLinks'
import { inlineImageSource } from '../Threads/markdownImage'

interface MarkdownPreviewProps {
  content: string
}

// react-markdown drops `data:` addresses by default; an inline raster image of a size worth drawing is kept as
// written (the same rule as ThreadMarkdown), everything else goes through the default transform.
const keepInlineImages = (url: string, key: string): string =>
  key === 'src' && inlineImageSource(url) ? url : defaultUrlTransform(url)

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
        urlTransform={keepInlineImages}
        components={{
          // Links leave through openExternalLink, with the real host beside text that names somewhere else;
          // anything else (relative paths, other schemes) stays plain text instead of navigating the renderer.
          a: ({ href, children }) => href && parseExternalUrl(href)
            ? <ExternalAnchor href={href}>{children}</ExternalAnchor>
            : <span className="markdown-preview-reference" title={href}>{children}</span>,
          // A file from the project is untrusted: an image that goes to the network is a request made on the
          // person's behalf, and SVG or an oversized dump is not worth drawing. Only an inline raster image
          // (inlineImageSource) is drawn; the rest stays a named reference.
          img: ({ src, alt }) => {
            const inline = inlineImageSource(typeof src === 'string' ? src : undefined)
            return inline
              ? <img src={inline} alt={alt ?? ''} />
              : <span className="markdown-preview-img-skipped">{i18n.t('editor.imageSkipped', { ns: 'code', name: alt || (typeof src === 'string' ? src.slice(0, 200) : '') || '?' })}</span>
          }
        }}
      >
        {content}
      </Markdown>
    </div>
  )
}
