import type { ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '../../ui'
import type { ExternalLinkPrompt } from '../../lib/externalLinks'
import styles from './ExternalLinkDialog.module.css'

/** The full URL with its host marked, so a long path or a lookalike subdomain cannot hide where it goes. */
export function splitAtHost(url: string, host: string): [string, string, string] {
  const start = url.startsWith('mailto:') ? url.toLowerCase().indexOf(`@${host}`) + 1 : url.indexOf('//') + 2
  if (!host || start <= 0 || url.slice(start, start + host.length).toLowerCase() !== host) return [url, '', '']
  return [url.slice(0, start), url.slice(start, start + host.length), url.slice(start + host.length)]
}

export function ExternalLinkConfirm({ prompt, onDone }: { prompt: ExternalLinkPrompt; onDone: (open: boolean) => void }): ReactElement {
  const { t } = useTranslation('common')
  const [before, host, after] = splitAtHost(prompt.url, prompt.host)
  return <ConfirmDialog testId="external-link-dialog" title={t('links.confirm.title')} description={t(prompt.text ? 'links.confirm.textDiffers' : 'links.confirm.newHost')}
    confirmLabel={t('links.confirm.open')} cancelLabel={t('links.confirm.cancel')} onConfirm={() => onDone(true)} onCancel={() => onDone(false)}>
    <dl>
      <div className={styles.field}><dt>{t('links.confirm.host')}</dt>
        <dd className={styles.hostLine} data-testid="external-link-host">{prompt.unicodeHost ?? prompt.host}</dd>
        {prompt.unicodeHost && <dd className={styles.idn} data-testid="external-link-idn">{t('links.confirm.idn', { ascii: prompt.host })}</dd>}
      </div>
      {prompt.text && <div className={styles.field}><dt>{t('links.confirm.text')}</dt><dd className={styles.text} data-testid="external-link-text">{prompt.text}</dd></div>}
      <div className={styles.field}><dt>{t('links.confirm.address')}</dt>
        <dd><code className={styles.url} data-testid="external-link-url" tabIndex={0}>{before}{host && <mark className={styles.host}>{host}</mark>}{after}</code></dd>
      </div>
    </dl>
  </ConfirmDialog>
}

let active: ((open: boolean) => void) | null = null

/** Asks once; a second link while one is open cancels the first. Focus goes back where it was. */
export function confirmExternalLink(prompt: ExternalLinkPrompt): Promise<boolean> {
  active?.(false)
  return new Promise(resolve => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    let settled = false
    const done = (open: boolean): void => {
      if (settled) return
      settled = true
      if (active === done) active = null
      resolve(open)
      setTimeout(() => {
        root.unmount(); container.remove()
        if (previous?.isConnected) previous.focus({ preventScroll: true })
      }, 0)
    }
    active = done
    root.render(<ExternalLinkConfirm prompt={prompt} onDone={done} />)
  })
}
