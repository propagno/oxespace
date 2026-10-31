import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Plus, Save, Send, Trash2, X } from 'lucide-react'
import { toCurl } from '../../../shared/oxepost/curl'
import { literalSecrets } from '../../../shared/oxepost/format'
import { findVariables } from '../../../shared/oxepost/variables'
import { HTTP_METHODS, type HttpMethod, type PostAuth, type PostHeader, type PostRequest } from '../../../shared/oxepost/types'
import { Badge, Button, Checkbox, IconButton, Select, Tabs, TextArea, TextField, copyText } from '../../ui'
import { EXAMPLE } from './examples'
import { isDirty, useOxePostStore } from './oxepost.store'
import { queryParams, withParams, prettyBody } from './post-model'
import styles from './OxePost.module.css'

type EditorTab = 'params' | 'headers' | 'body' | 'auth'

/** Method, URL, name and environment on top; parameters, headers, body and authentication below. */
export function RequestEditor({ onDelete }: { onDelete: () => void }): ReactElement {
  const { t } = useTranslation('post')
  const draft = useOxePostStore(state => state.draft)
  const selected = useOxePostStore(state => state.selected)
  const dirty = useOxePostStore(isDirty)
  const sending = useOxePostStore(state => state.sending)
  const environment = useOxePostStore(state => state.environment)
  const environments = useOxePostStore(state => state.environments)
  const edit = useOxePostStore(state => state.edit)
  const [tab, setTab] = useState<EditorTab>('params')

  const env = environments.find(item => item.id === environment)
  const known = new Set(env ? [...Object.keys(env.variables), ...env.secrets] : [])
  const used = findVariables(JSON.stringify([draft.url, draft.body, draft.headers, draft.auth]))
  const unresolved = used.filter(name => !known.has(name))
  const params = queryParams(draft.url)
  const activeHeaders = draft.headers.filter(header => header.enabled && header.name).length
  const copy = (): void => { void copyText(toCurl(draft), t('request.curlWhat'), t('request.curlCopied')) }

  return <div className={styles.editor}>
    <div className={styles.urlBar} role="group" aria-label={t('request.line')}>
      <Select aria-label={t('request.method')} value={draft.method} onChange={event => edit({ method: event.target.value as HttpMethod })} options={HTTP_METHODS.map(method => ({ value: method, label: method }))} />
      <TextField mono className={styles.urlInput} aria-label={t('request.url')} placeholder={t('request.urlPlaceholder')} value={draft.url} spellCheck={false}
        onChange={event => edit({ url: event.target.value })} onKeyDown={event => { if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) { event.preventDefault(); void useOxePostStore.getState().send() } }} />
      <Button variant="primary" icon={<Send size={13} aria-hidden="true" />} loading={sending} disabled={!draft.url.trim()} onClick={() => void useOxePostStore.getState().send()}>{sending ? t('request.sending') : t('request.send')}</Button>
    </div>
    <div className={styles.metaBar}>
      <TextField className={styles.nameInput} aria-label={t('request.name')} value={draft.name} onChange={event => edit({ name: event.target.value })} />
      <Select aria-label={t('env.label')} value={environment} onChange={event => useOxePostStore.getState().setEnvironment(event.target.value)}
        options={[{ value: '', label: t('env.none') }, ...environments.map(item => ({ value: item.id, label: item.production ? t('env.productionOption', { name: item.name }) : item.name }))]} />
      {env?.production && <Badge intent="danger">{t('env.production')}</Badge>}
      <span className={styles.spacer} />
      <Button size="sm" icon={<Save size={13} aria-hidden="true" />} disabled={!dirty && selected !== null} onClick={() => void useOxePostStore.getState().save()}>{dirty || selected === null ? t('request.save') : t('request.saved')}</Button>
      <Button size="sm" variant="ghost" icon={<Copy size={13} aria-hidden="true" />} onClick={copy}>{t('request.copyCurl')}</Button>
      {selected && <IconButton label={t('request.delete')} size="sm" icon={<Trash2 size={14} aria-hidden="true" />} onClick={onDelete} />}
    </div>
    {unresolved.length > 0 && <p className={styles.note} role="note">{t('request.unresolved', { names: unresolved.map(name => `{{${name}}}`).join(', '), count: unresolved.length })}</p>}
    <Tabs<EditorTab> label={t('request.sections')} value={tab} onChange={setTab} className={styles.tabs} tabs={[
      { value: 'params', label: params.length ? t('tabs.paramsCount', { count: params.length }) : t('tabs.params'), content: <ParamsTable /> },
      { value: 'headers', label: activeHeaders ? t('tabs.headersCount', { count: activeHeaders }) : t('tabs.headers'), content: <HeadersTable /> },
      { value: 'body', label: t('tabs.body'), content: <BodyEditor /> },
      { value: 'auth', label: draft.auth.type === 'none' ? t('tabs.auth') : t('tabs.authOn'), content: <AuthEditor request={draft} /> }
    ]} />
  </div>
}

function ParamsTable(): ReactElement {
  const { t } = useTranslation('post')
  const url = useOxePostStore(state => state.draft.url)
  const edit = useOxePostStore(state => state.edit)
  const rows = queryParams(url)
  const update = (next: Array<{ name: string; value: string }>): void => edit({ url: withParams(url, next) })
  return <div className={styles.pane}>
    <ul className={styles.rows} aria-label={t('tabs.params')}>
      {rows.map((row, index) => <li key={index} className={styles.kvRow}>
        <TextField mono aria-label={t('table.name', { n: index + 1 })} placeholder={t('table.namePlaceholder')} value={row.name} onChange={event => update(rows.map((item, at) => at === index ? { ...item, name: event.target.value } : item))} />
        <TextField mono aria-label={t('table.value', { n: index + 1 })} placeholder={t('table.valuePlaceholder')} value={row.value} onChange={event => update(rows.map((item, at) => at === index ? { ...item, value: event.target.value } : item))} />
        <IconButton label={t('table.remove', { n: index + 1 })} size="sm" icon={<X size={14} aria-hidden="true" />} onClick={() => update(rows.filter((_, at) => at !== index))} />
      </li>)}
    </ul>
    {rows.length === 0 && <p className={styles.hint}>{t('table.noParams')}</p>}
    <div><Button size="sm" variant="ghost" icon={<Plus size={13} aria-hidden="true" />} onClick={() => update([...rows, { name: t('table.newParam'), value: '' }])}>{t('table.addParam')}</Button></div>
  </div>
}

function HeadersTable(): ReactElement {
  const { t } = useTranslation('post')
  const headers = useOxePostStore(state => state.draft.headers)
  const edit = useOxePostStore(state => state.edit)
  const update = (next: PostHeader[]): void => edit({ headers: next })
  const change = (index: number, patch: Partial<PostHeader>): void => update(headers.map((item, at) => at === index ? { ...item, ...patch } : item))
  return <div className={styles.pane}>
    <ul className={styles.rows} aria-label={t('tabs.headers')}>
      {headers.map((row, index) => <li key={index} className={styles.kvRow} data-with-check="">
        <Checkbox label={<span className={styles.srOnly}>{t('table.enabled', { n: index + 1 })}</span>} checked={row.enabled} onChange={event => change(index, { enabled: event.target.checked })} />
        <TextField mono aria-label={t('table.name', { n: index + 1 })} placeholder={t('table.headerPlaceholder')} value={row.name} onChange={event => change(index, { name: event.target.value })} />
        <TextField mono aria-label={t('table.value', { n: index + 1 })} placeholder={t('table.valuePlaceholder')} value={row.value} onChange={event => change(index, { value: event.target.value })} />
        <IconButton label={t('table.remove', { n: index + 1 })} size="sm" icon={<X size={14} aria-hidden="true" />} onClick={() => update(headers.filter((_, at) => at !== index))} />
      </li>)}
    </ul>
    {headers.length === 0 && <p className={styles.hint}>{t('table.noHeaders')}</p>}
    <div><Button size="sm" variant="ghost" icon={<Plus size={13} aria-hidden="true" />} onClick={() => update([...headers, { name: '', value: '', enabled: true }])}>{t('table.addHeader')}</Button></div>
  </div>
}

function BodyEditor(): ReactElement {
  const { t } = useTranslation('post')
  const body = useOxePostStore(state => state.draft.body)
  const method = useOxePostStore(state => state.draft.method)
  const headers = useOxePostStore(state => state.draft.headers)
  const edit = useOxePostStore(state => state.edit)
  const contentType = headers.find(header => header.enabled && header.name.toLowerCase() === 'content-type')?.value ?? ''
  const formatted = prettyBody(body, 'application/json')
  const looksJson = /^\s*[[{]/.test(body)
  const noBody = method === 'GET' || method === 'HEAD'
  return <div className={styles.pane}>
    <TextArea mono className={styles.bodyArea} aria-label={t('tabs.body')} placeholder={t('body.placeholder')} spellCheck={false} value={body} onChange={event => edit({ body: event.target.value })} />
    <div className={styles.paneFoot}>
      <Button size="sm" variant="ghost" disabled={!looksJson || formatted === body} onClick={() => edit({ body: formatted })}>{t('body.format')}</Button>
      {looksJson && !contentType && <Button size="sm" variant="ghost" onClick={() => edit({ headers: [...headers, { name: 'Content-Type', value: 'application/json', enabled: true }] })}>{t('body.addJsonType')}</Button>}
      {noBody && body !== '' && <span className={styles.hint} role="note">{t('body.noBodyMethod', { method })}</span>}
    </div>
  </div>
}

function AuthEditor({ request }: { request: PostRequest }): ReactElement {
  const { t } = useTranslation('post')
  const edit = useOxePostStore(state => state.edit)
  const auth = request.auth
  const choose = (type: PostAuth['type']): void => edit({
    auth: type === 'none' ? { type } : type === 'bearer' ? { type, token: '' } : type === 'basic' ? { type, username: '', password: '' } : { type, in: 'header', name: 'X-API-Key', value: '' }
  })
  const literals = literalSecrets(request)
  return <div className={styles.pane}>
    <Select label={t('auth.type')} value={auth.type} onChange={event => choose(event.target.value as PostAuth['type'])}
      options={[{ value: 'none', label: t('auth.none') }, { value: 'bearer', label: t('auth.bearer') }, { value: 'basic', label: t('auth.basic') }, { value: 'apikey', label: t('auth.apikey') }]} />
    {auth.type === 'bearer' && <TextField mono label={t('auth.token')} placeholder={EXAMPLE.token} value={auth.token} onChange={event => edit({ auth: { ...auth, token: event.target.value } })} />}
    {auth.type === 'basic' && <>
      <TextField mono label={t('auth.username')} placeholder={EXAMPLE.username} value={auth.username} onChange={event => edit({ auth: { ...auth, username: event.target.value } })} />
      <TextField mono label={t('auth.password')} placeholder={EXAMPLE.password} value={auth.password} onChange={event => edit({ auth: { ...auth, password: event.target.value } })} />
    </>}
    {auth.type === 'apikey' && <>
      <Select label={t('auth.keyIn')} value={auth.in} onChange={event => edit({ auth: { ...auth, in: event.target.value as 'header' | 'query' } })} options={[{ value: 'header', label: t('auth.inHeader') }, { value: 'query', label: t('auth.inQuery') }]} />
      <TextField mono label={t('auth.keyName')} value={auth.name} onChange={event => edit({ auth: { ...auth, name: event.target.value } })} />
      <TextField mono label={t('auth.keyValue')} placeholder={EXAMPLE.apiKey} value={auth.value} onChange={event => edit({ auth: { ...auth, value: event.target.value } })} />
    </>}
    {auth.type !== 'none' && <p className={styles.hint}>{t('auth.hint', { example: '{{token}}' })}</p>}
    {literals.length > 0 && <p className={styles.warn} role="note">{t('auth.literal')}</p>}
  </div>
}
