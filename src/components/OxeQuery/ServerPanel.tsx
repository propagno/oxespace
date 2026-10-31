import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import type { OxeQueryConnection, SqlDatabaseInfo, SqlRoleInfo } from '../../../shared/types/oxequery'
import { Button, Checkbox, Dialog, ErrorState, IconButton, Select, Tabs, TextField, LoadingState } from '../../ui'
import { errorMessage, oq } from './client'
import { formatBytes } from './catalog'
import styles from './StructureEditor.module.css'

type TabId = 'databases' | 'roles'
const ENCODINGS = ['UTF8', 'LATIN1', 'SQL_ASCII']
const ROLE_RIGHTS = ['login', 'superuser', 'createDatabase', 'createRole', 'replication'] as const

/** The server behind a connection: its databases (create and drop) and its roles (read-only). */
export function ServerPanel({ connection, onClose }: { connection: OxeQueryConnection; onClose: () => void }): ReactElement {
  const { t } = useTranslation('oxequery')
  const [tab, setTab] = useState<TabId>('databases')
  const [databases, setDatabases] = useState<SqlDatabaseInfo[] | null>(null)
  const [roles, setRoles] = useState<SqlRoleInfo[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [owner, setOwner] = useState('')
  const [encoding, setEncoding] = useState('UTF8')
  const [dropping, setDropping] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const readOnly = connection.readOnly

  const load = useCallback(async (): Promise<void> => {
    setError('')
    try {
      const [list, people] = await Promise.all([oq('sql.databases', { connectionId: connection.id }), oq('sql.roles', { connectionId: connection.id })])
      setDatabases(list); setRoles(people)
    } catch (cause) { setError(errorMessage(cause)) }
  }, [connection.id])
  useEffect(() => { void load() }, [load])

  const create = async (): Promise<void> => {
    setBusy(true); setError('')
    try {
      await oq('sql.createDatabase', { connectionId: connection.id, name: name.trim(), ...(owner ? { owner } : {}), encoding, ...(encoding === 'UTF8' ? {} : { template: 'template0' }) })
      setName('')
      await load()
    } catch (cause) { setError(errorMessage(cause)) } finally { setBusy(false) }
  }

  const drop = async (target: string): Promise<void> => {
    setBusy(true); setError('')
    try {
      await oq('sql.dropDatabase', { connectionId: connection.id, name: target, confirmed })
      setDropping(null); setConfirmed(false)
      await load()
    } catch (cause) { setError(errorMessage(cause)) } finally { setBusy(false) }
  }

  const databasesTab = <div className={styles.section}>
    <div className={styles.scroll}>
      <table className={styles.grid} aria-label={t('server.databases')}>
        <thead><tr><th>{t('server.column.name')}</th><th>{t('server.column.owner')}</th><th>{t('server.column.encoding')}</th><th>{t('server.column.size')}</th><th><span className={styles.visuallyHidden}>{t('server.column.actions')}</span></th></tr></thead>
        <tbody>{(databases ?? []).map(item => <tr key={item.name}>
          <td>{item.name}{item.current && <span className={styles.note}> {t('server.thisConnection')}</span>}</td><td>{item.owner}</td><td>{item.encoding}</td><td>{item.sizeBytes === null ? t('server.noAccess') : formatBytes(item.sizeBytes)}</td>
          <td>{!readOnly && !item.current && <IconButton label={t('server.dropNamed', { name: item.name })} size="sm" icon={<Trash2 size={14} />} onClick={() => { setDropping(item.name); setConfirmed(false) }} />}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {dropping && <section className={styles.plan} aria-label={t('server.confirmDrop')}>
      <p className={styles.error}>{t('server.dropWarning', { name: dropping })}</p>
      <Checkbox label={t('server.dropUnderstand', { name: dropping })} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
      <div className={styles.actions}><Button size="sm" variant="ghost" onClick={() => setDropping(null)}>{t('common.cancel')}</Button>
        <Button size="sm" variant="danger" loading={busy} disabled={!confirmed} onClick={() => void drop(dropping)}>{t('server.drop')}</Button></div>
    </section>}
    {!readOnly && <fieldset className={styles.form}>
      <legend>{t('server.createLegend')}</legend>
      <TextField mono label={t('server.column.name')} value={name} onChange={event => setName(event.target.value)} />
      <Select label={t('server.column.owner')} value={owner} onChange={event => setOwner(event.target.value)}
        options={[{ value: '', label: t('server.currentUser') }, ...(roles ?? []).filter(role => role.login).map(role => ({ value: role.name, label: role.name }))]} />
      <Select label={t('server.column.encoding')} value={encoding} onChange={event => setEncoding(event.target.value)} options={ENCODINGS.map(value => ({ value, label: value }))} />
      <Button size="sm" icon={<Plus size={14} />} loading={busy} disabled={!name.trim()} onClick={() => void create()}>{t('server.create')}</Button>
    </fieldset>}
  </div>

  const rolesTab = <div className={styles.section}>
    <p className={styles.note}>{t('server.rolesReadOnly')}</p>
    <div className={styles.scroll}>
      <table className={styles.grid} aria-label={t('server.roles')}>
        <thead><tr><th>{t('server.column.role')}</th><th>{t('server.column.can')}</th><th>{t('server.column.memberOf')}</th></tr></thead>
        <tbody>{(roles ?? []).map(role => <tr key={role.name}>
          <td>{role.name}</td>
          <td>{ROLE_RIGHTS.filter(right => role[right]).map(right => t(`server.right.${right}`)).join(', ') || t('server.right.nothing')}</td>
          <td>{role.memberOf.join(', ') || '—'}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>

  return <Dialog className="oq-scope" title={t('server.title', { name: connection.name })} description={t('server.description')} size="lg" onClose={onClose} closeLabel={t('common.close')} testId="server-panel"
    footer={<Button variant="ghost" onClick={onClose}>{t('common.close')}</Button>}>
    {error && <ErrorState compact title={t('server.failed')} message={error} />}
    {!databases && !error ? <LoadingState label={t('server.loading')} />
      : databases && <Tabs<TabId> label={t('server.tabs')} value={tab} onChange={setTab} tabs={[{ value: 'databases', label: t('server.databases'), content: databasesTab }, { value: 'roles', label: t('server.roles'), content: rolesTab }]} />}
  </Dialog>
}
