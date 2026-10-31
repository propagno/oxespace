import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { displayHost, openExternalLink, parseExternalUrl, textIsAddress, type ExternalLinkSource } from '../../lib/externalLinks'
import styles from './ExternalAnchor.module.css'

/** The plain text of rendered markdown children, for comparing what a link says with where it goes. */
export function textOf(node: ReactNode): string {
  return Children.toArray(node).map(child => {
    if (typeof child === 'string' || typeof child === 'number') return String(child)
    if (isValidElement<{ children?: ReactNode }>(child)) return textOf(child.props.children)
    return ''
  }).join('')
}

/**
 * A link from markdown (agent messages, file previews). It opens through openExternalLink, and unless its text is the
 * address or its host, the real host follows the text: words ("the PR") cannot hide where it goes either.
 * Returns null for links that may not leave the app; the caller shows them as plain text.
 */
export function ExternalAnchor({ href, children, source = 'markdown', className }: { href: string | undefined; children: ReactNode; source?: ExternalLinkSource; className?: string }): ReactElement | null {
  const { t } = useTranslation('common')
  const url = href ? parseExternalUrl(href) : null
  const host = displayHost(href)
  if (!url || !href) return null
  const text = textOf(children)
  return <a className={className} href={url.href} title={url.href} target="_blank" rel="noopener noreferrer" onClick={event => { event.preventDefault(); void openExternalLink(href, { text, source }) }}>
    {children}{host && text.trim() && !textIsAddress(url, text) && <>{' '}<span className={styles.host} data-testid="external-link-suffix">{t('links.hostSuffix', { host })}</span></>}
  </a>
}
