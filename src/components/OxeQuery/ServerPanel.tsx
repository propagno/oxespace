import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { OxeQueryConnection, SqlDatabaseInfo, SqlRoleInfo } from '../../../shared/types/oxequery'
import { Button, Checkbox, Dialog, IconButton, Select, Tabs, TextField, LoadingState } from '../../ui'
import { errorMessage, oq } from './client'
import styles from './StructureEditor.module.css'

type TabId = 'databases' | 'roles'

const bytes = (value: number | null): string => value === null ? 'no access' : value < 1024 ** 2 ? `${(value / 1024).toFixed(0)} KB` : value < 1024 ** 3 ? `${(value / 1024 ** 2).toFixed(1)} MB` : `${(value / 1024 ** 3).toFixed(2)} GB`

/** The server behind a connection: its databases (create and drop) and its roles (read-only). */
export function ServerPanel({ connection, onClose }: { connection: OxeQueryConnection; onClose: () => void }): ReactElement {
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
      <table className={styles.grid} aria-label="Databases">
        <thead><tr><th>Name</th><th>Owner</th><th>Encoding</th><th>Size</th><th><span className={styles.visuallyHidden}>Actions</span></th></tr></thead>
        <tbody>{(databases ?? []).map(item => <tr key={item.name}>
          <td>{item.name}{item.current && <span className={styles.note}> (this connection)</span>}</td><td>{item.owner}</td><td>{item.encoding}</td><td>{bytes(item.sizeBytes)}</td>
          <td>{!readOnly && !item.current && <IconButton label={`Drop ${item.name}`} size="sm" icon={<Trash2 size={14} />} onClick={() => { setDropping(item.name); setConfirmed(false) }} />}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {dropping && <section className={styles.plan} aria-label="Confirm drop">
      <p className={styles.error}>Dropping “{dropping}” deletes all of its data for good.</p>
      <Checkbox label={`I understand “${dropping}” cannot be recovered`} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
      <div className={styles.actions}><Button size="sm" variant="ghost" onClick={() => setDropping(null)}>Cancel</Button>
        <Button size="sm" variant="danger" loading={busy} disabled={!confirmed} onClick={() => void drop(dropping)}>Drop database</Button></div>
    </section>}
    {!readOnly && <fieldset className={styles.form}>
      <legend>Create a database</legend>
      <TextField mono label="Name" value={name} onChange={event => setName(event.target.value)} />
      <Select label="Owner" value={owner} onChange={event => setOwner(event.target.value)}
        options={[{ value: '', label: 'Current user' }, ...(roles ?? []).filter(role => role.login).map(role => ({ value: role.name, label: role.name }))]} />
      <Select label="Encoding" value={encoding} onChange={event => setEncoding(event.target.value)} options={[{ value: 'UTF8', label: 'UTF8' }, { value: 'LATIN1', label: 'LATIN1' }, { value: 'SQL_ASCII', label: 'SQL_ASCII' }]} />
      <Button size="sm" icon={<Plus size={14} />} loading={busy} disabled={!name.trim()} onClick={() => void create()}>Create database</Button>
    </fieldset>}
  </div>

  const rolesTab = <div className={styles.section}>
    <p className={styles.note}>Read-only. Roles and their rights are changed with SQL.</p>
    <div className={styles.scroll}>
      <table className={styles.grid} aria-label="Roles">
        <thead><tr><th>Role</th><th>Can</th><th>Member of</th></tr></thead>
        <tbody>{(roles ?? []).map(role => <tr key={role.name}>
          <td>{role.name}</td>
          <td>{[role.login && 'log in', role.superuser && 'superuser', role.createDatabase && 'create databases', role.createRole && 'create roles', role.replication && 'replicate'].filter(Boolean).join(', ') || 'nothing special'}</td>
          <td>{role.memberOf.join(', ') || '—'}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>

  return <Dialog className="oq-scope" title={`Server of ${connection.name}`} description="Databases and roles on this PostgreSQL server." size="lg" onClose={onClose} testId="server-panel"
    footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {!databases && !error ? <LoadingState label="Loading databases…" />
      : <Tabs<TabId> label="Server" value={tab} onChange={setTab} tabs={[{ value: 'databases', label: 'Databases', content: databasesTab }, { value: 'roles', label: 'Roles', content: rolesTab }]} />}
  </Dialog>
}
