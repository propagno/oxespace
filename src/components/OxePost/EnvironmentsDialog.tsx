import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, X } from 'lucide-react'
import { isSensitiveName } from '../../../shared/oxepost/redact'
import type { PostEnvironmentView } from '../../../shared/oxepost/types'
import { Badge, Button, ConfirmDialog, Dialog, ErrorState, IconButton, Switch, TextField, toast } from '../../ui'
import { messageOf, post } from './client'
import { EXAMPLE } from './examples'
import { useOxePostStore } from './oxepost.store'
import styles from './OxePost.module.css'

interface Form { id: string; name: string; production: boolean; variables: Array<{ name: string; value: string }>; secrets: string[] }
const blank = (): Form => ({ id: '', name: '', production: false, variables: [], secrets: [] })
const fromEnvironment = (env: PostEnvironmentView): Form => ({ id: env.id, name: env.name, production: env.production, variables: Object.entries(env.variables).map(([name, value]) => ({ name, value })), secrets: [...env.secrets] })

/**
 * Environments of the workspace: `{{variables}}` kept in a file that is committed, and secrets kept in the system's
 * secure storage. A secret's value can be set or cleared here and never read back: the page only learns "set" or "not set".
 */
export function EnvironmentsDialog({ onClose }: { onClose: () => void }): ReactElement {
  const { t } = useTranslation('post')
  const workspaceId = useOxePostStore(state => state.workspaceId)
  const environments = useOxePostStore(state => state.environments)
  const secretsProblem = useOxePostStore(state => state.secretsProblem)
  const [form, setFormState] = useState<Form>(() => environments[0] ? fromEnvironment(environments[0]) : blank())
  const [failure, setFailure] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [secretValues, setSecretValues] = useState<Record<string, string>>({})
  const [newSecret, setNewSecret] = useState('')
  const saved = environments.find(env => env.id === form.id)
  const setForm = setFormState
  /** Another environment: what was typed for the previous one's secrets and the last error do not follow. */
  const switchTo = (next: Form): void => { setFormState(next); setSecretValues({}); setFailure('') }


  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true); setFailure('')
    try { await action() } catch (error) { setFailure(messageOf(error)) } finally { setBusy(false) }
  }

  const save = (): Promise<void> => run(async () => {
    const variables = Object.fromEntries(form.variables.filter(item => item.name.trim()).map(item => [item.name.trim(), item.value]))
    const result = await post('envSave', { workspaceId, id: form.id || undefined, environment: { name: form.name, production: form.production, variables, secrets: form.secrets } })
    useOxePostStore.getState().applyEnvironments(result.environments)
    const created = result.environments.find(env => env.id === result.id)
    if (created) switchTo(fromEnvironment(created))
    toast({ title: t('env.saved'), intent: 'success' })
  })

  const remove = (): Promise<void> => run(async () => {
    const result = await post('envDelete', { workspaceId, id: form.id })
    useOxePostStore.getState().applyEnvironments(result.environments)
    setConfirmDelete(false)
    switchTo(result.environments[0] ? fromEnvironment(result.environments[0]) : blank())
  })

  const setSecret = (name: string, clear: boolean): Promise<void> => run(async () => {
    const result = clear ? await post('secretClear', { workspaceId, environment: form.id, name }) : await post('secretSet', { workspaceId, environment: form.id, name, value: secretValues[name] ?? '' })
    useOxePostStore.getState().applyEnvironments(result.environments)
    setSecretValues(values => ({ ...values, [name]: '' }))
  })

  const addVariable = (): void => setForm(current => ({ ...current, variables: [...current.variables, { name: '', value: '' }] }))
  const addSecret = (): void => {
    const name = newSecret.trim()
    if (!name || form.secrets.includes(name)) return
    setForm(current => ({ ...current, secrets: [...current.secrets, name] })); setNewSecret('')
  }
  const dirty = !saved || JSON.stringify(form) !== JSON.stringify(fromEnvironment(saved))

  return <Dialog title={t('env.title')} description={t('env.description')} size="lg" onClose={onClose} closeLabel={t('common.close')}
    footer={<>
      {saved && <Button variant="danger" disabled={busy} onClick={() => setConfirmDelete(true)}>{t('env.delete')}</Button>}
      <span className={styles.spacer} />
      <Button variant="secondary" onClick={onClose}>{t('common.close')}</Button>
      <Button variant="primary" loading={busy} disabled={!form.name.trim() || !dirty} onClick={() => void save()}>{t('env.save')}</Button>
    </>}>
    <div className={styles.envLayout}>
      <nav className={styles.envList} aria-label={t('env.list')}>
        {environments.map(env => <button key={env.id} type="button" className={styles.row} aria-current={form.id === env.id ? 'page' : undefined} onClick={() => switchTo(fromEnvironment(env))}>
          <span className={styles.rowName}>{env.name}</span>{env.production && <Badge intent="danger">{t('env.production')}</Badge>}
        </button>)}
        <Button size="sm" variant="ghost" icon={<Plus size={13} aria-hidden="true" />} onClick={() => switchTo(blank())}>{t('env.new')}</Button>
      </nav>
      <div className={styles.dialogStack}>
        <TextField label={t('env.name')} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder={t('env.namePlaceholder')} />
        <Switch label={t('env.productionSwitch')} checked={form.production} onChange={value => setForm({ ...form, production: value })} />
        {form.production && <p className={styles.hint}>{t('env.productionHint')}</p>}

        <h3 className={styles.sectionTitle}>{t('env.variables')}</h3>
        <ul className={styles.rows} aria-label={t('env.variables')}>
          {form.variables.map((row, index) => <li key={index} className={styles.kvRow}>
            <TextField mono aria-label={t('table.name', { n: index + 1 })} placeholder={EXAMPLE.variableName} value={row.name} error={isSensitiveName(row.name) && row.value ? t('env.useSecret') : undefined}
              onChange={event => setForm({ ...form, variables: form.variables.map((item, at) => at === index ? { ...item, name: event.target.value } : item) })} />
            <TextField mono aria-label={t('table.value', { n: index + 1 })} placeholder={EXAMPLE.variableValue} value={row.value}
              onChange={event => setForm({ ...form, variables: form.variables.map((item, at) => at === index ? { ...item, value: event.target.value } : item) })} />
            <IconButton label={t('table.remove', { n: index + 1 })} size="sm" icon={<X size={14} aria-hidden="true" />} onClick={() => setForm({ ...form, variables: form.variables.filter((_, at) => at !== index) })} />
          </li>)}
        </ul>
        <div><Button size="sm" variant="ghost" icon={<Plus size={13} aria-hidden="true" />} onClick={addVariable}>{t('env.addVariable')}</Button></div>
        <p className={styles.hint}>{t('env.variablesHint', { example: '{{baseUrl}}' })}</p>

        <h3 className={styles.sectionTitle}>{t('env.secrets')}</h3>
        {secretsProblem && <ErrorState compact title={t('env.noVault')} message={secretsProblem} />}
        <ul className={styles.rows} aria-label={t('env.secrets')}>
          {form.secrets.map(name => {
            const isSaved = !!saved?.secrets.includes(name)
            const state = saved?.secretState[name] ?? 'not set'
            return <li key={name} className={styles.secretRow}>
              <code className={styles.secretName}>{name}</code>
              <Badge intent={state === 'set' ? 'success' : 'neutral'}>{state === 'set' ? t('env.secretSet') : t('env.secretNotSet')}</Badge>
              <TextField type="password" autoComplete="off" aria-label={t('env.secretValue', { name })} placeholder={isSaved ? t('env.secretPlaceholder') : t('env.saveFirst')} disabled={!isSaved || !!secretsProblem}
                value={secretValues[name] ?? ''} onChange={event => setSecretValues({ ...secretValues, [name]: event.target.value })} />
              <Button size="sm" disabled={busy || !isSaved || !secretValues[name]} onClick={() => void setSecret(name, false)} aria-label={t('env.setSecret', { name })}>{t('env.set')}</Button>
              <Button size="sm" variant="ghost" disabled={busy || state !== 'set'} onClick={() => void setSecret(name, true)} aria-label={t('env.clearSecret', { name })}>{t('env.clear')}</Button>
              <IconButton label={t('env.removeSecret', { name })} size="sm" icon={<X size={14} aria-hidden="true" />} onClick={() => setForm({ ...form, secrets: form.secrets.filter(item => item !== name) })} />
            </li>
          })}
        </ul>
        <div className={styles.addSecret}>
          <TextField mono aria-label={t('env.secretName')} placeholder={EXAMPLE.secretName} value={newSecret} onChange={event => setNewSecret(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addSecret() } }} />
          <Button size="sm" variant="ghost" icon={<Plus size={13} aria-hidden="true" />} disabled={!newSecret.trim()} onClick={addSecret}>{t('env.addSecret')}</Button>
        </div>
        <p className={styles.hint}>{t('env.secretsHint')}</p>
        {failure && <ErrorState compact title={t('env.failed')} message={failure} />}
      </div>
    </div>
    {confirmDelete && <ConfirmDialog title={t('env.deleteTitle', { name: form.name })} description={t('env.deleteText')} confirmLabel={t('env.delete')} cancelLabel={t('common.cancel')} danger busy={busy} onConfirm={() => void remove()} onCancel={() => setConfirmDelete(false)} />}
  </Dialog>
}
