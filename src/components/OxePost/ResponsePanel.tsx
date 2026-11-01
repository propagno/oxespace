import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Send } from 'lucide-react'
import { Badge, Button, EmptyState, ErrorState, OfflineState, Skeleton, Tabs, copyText } from '../../ui'
import { useConnectivity } from '../../hooks/useConnectivity'
import { useOxePostStore } from './oxepost.store'
import { cookiesOf, formatBytes, formatMs, prettyBody, statusTone } from './post-model'
import styles from './OxePost.module.css'

type ResponseTab = 'body' | 'headers' | 'cookies'
const INTENT = { success: 'success', info: 'info', warning: 'warning', danger: 'danger' } as const

/** What came back: status, time and size on top; the body formatted, the headers and the cookies below. */
export function ResponsePanel(): ReactElement {
  const { t } = useTranslation('post')
  const response = useOxePostStore(state => state.response)
  const failure = useOxePostStore(state => state.failure)
  const sending = useOxePostStore(state => state.sending)
  const [tab, setTab] = useState<ResponseTab>('body')
  const offline = useConnectivity() === 'offline'

  let content: ReactElement
  if (sending && !response) content = <div className={styles.center}><Skeleton lines={5} label={t('response.waiting')} /></div>
  // A request that could not leave because the computer has no network: say that, not a server error.
  else if (failure?.code === 'network' && offline) content = <div className={styles.center}><OfflineState message={t('response.offline')} onRetry={() => void useOxePostStore.getState().send()} retryLabel={t('response.retry')} /></div>
  else if (failure && failure.code !== 'confirm') {
    const title = failure.code === 'timeout' ? t('response.timeout') : failure.code === 'tls' ? t('response.tls') : failure.code === 'network' ? t('response.network') : failure.code === 'missing' ? t('response.missing') : t('response.failed')
    content = <div className={styles.center}><ErrorState title={title} message={failure.message} onRetry={failure.code === 'network' || failure.code === 'timeout' ? () => void useOxePostStore.getState().send() : undefined} retryLabel={t('response.retry')} /></div>
  } else if (!response) content = <div className={styles.center}><EmptyState icon={<Send size={22} aria-hidden="true" />} title={t('response.emptyTitle')}>{t('response.emptyText')}</EmptyState></div>
  else {
    const cookies = cookiesOf(response)
    const body = response.binary ? '' : prettyBody(response.body, response.contentType)
    content = <>
      <div className={styles.status} role="status" aria-label={t('response.summary')}>
        <Badge intent={INTENT[statusTone(response.status)]}>{response.status} {response.statusText}</Badge>
        <span>{formatMs(response.ms)}</span>
        <span>{formatBytes(response.size)}</span>
        {response.contentType && <span className={styles.muted}>{response.contentType.split(';')[0]}</span>}
        <span className={styles.spacer} />
        <Button size="sm" variant="ghost" icon={<Copy size={13} aria-hidden="true" />} disabled={!body} onClick={() => void copyText(body, t('response.bodyWhat'), t('response.copied'))}>{t('response.copy')}</Button>
      </div>
      <Tabs<ResponseTab> label={t('response.sections')} value={tab} onChange={setTab} className={styles.tabs} tabs={[
        { value: 'body', label: t('tabs.body'), content: <div className={styles.pane}>
          {response.binary ? <p className={styles.hint}>{t('response.binary', { size: formatBytes(response.size) })}</p>
            : body === '' ? <p className={styles.hint}>{t('response.noBody')}</p>
            : <pre className={styles.output} aria-label={t('response.body')} tabIndex={0}>{body}</pre>}
          {response.truncated && <p className={styles.warn} role="note">{t('response.truncated', { shown: formatBytes(Math.min(response.size, 2 * 1024 * 1024)), size: formatBytes(response.size) })}</p>}
        </div> },
        { value: 'headers', label: t('tabs.headersCount', { count: response.headers.length }), content: <HeaderList rows={response.headers} label={t('response.headers')} /> },
        { value: 'cookies', label: t('tabs.cookiesCount', { count: cookies.length }), content: cookies.length === 0 ? <p className={styles.hint}>{t('response.noCookies')}</p>
          : <HeaderList label={t('response.cookies')} rows={cookies.map(cookie => ({ name: cookie.name, value: cookie.attributes ? `${cookie.value}; ${cookie.attributes}` : cookie.value }))} /> }
      ]} />
    </>
  }
  return <section className={styles.response} aria-label={t('response.label')}>{content}</section>
}

function HeaderList({ rows, label }: { rows: Array<{ name: string; value: string }>; label: string }): ReactElement {
  return <div className={styles.pane}><dl className={styles.headerList} aria-label={label}>
    {rows.map((row, index) => <div key={index} className={styles.headerRow}><dt>{row.name}</dt><dd>{row.value}</dd></div>)}
  </dl></div>
}
