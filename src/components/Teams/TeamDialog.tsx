import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentTeam, TeamRole, TeamScope } from '../../../shared/types/team'
import './TeamDialog.css'
import { TeamMessages } from './TeamMessages'
import { Button, Dialog, LoadingState, Notice, TextField } from '../../ui'

const ROLES: TeamRole[] = ['coordinator', 'project-manager', 'product-manager', 'developer', 'reviewer']
export function TeamDialog({ scope, owner, onClose }: { scope: TeamScope; owner?: { kind: 'thread' | 'pane'; id: string }; onClose: () => void }) {
  const { t } = useTranslation()
  const roleLabel = (role: TeamRole): string => t(`team.roles.${role}`)
  const [team, setTeam] = useState<AgentTeam | null>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [name, setName] = useState(''), [role, setRole] = useState<TeamRole>('developer')
  const [selected, setSelected] = useState<string | null>(null)
  const api = window.oxe.team
  useEffect(() => {
    let cancelled = false
    if (!api) { setError(t('team.unavailable')); return }
    void api.read(scope).then(value => { if (!cancelled) setTeam(value) }).catch(e => { if (!cancelled) setError(String(e)) })
    return () => { cancelled = true }
  }, [api, scope.kind, scope.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const change = async (action: () => Promise<AgentTeam>) => {
    if (busy) return
    setBusy(true); setError('')
    try { setTeam(await action()) }
    catch (e) { setError(String(e)); if (api) { try { setTeam(await api.read(scope)) } catch { /* Preserve the original error. */ } } }
    finally { setBusy(false) }
  }
  return <Dialog className="team-dialog" size="lg" title={t('tools.team.label', { ns: 'code' })} description={t('team.description')} onClose={onClose}>
    <div className="team-dialog-body">
      {error && <Notice intent="danger">{error}</Notice>}
      {!team && !error && <LoadingState label={t('team.loading')} />}
      {team && <>
        <h3>{team.name}</h3>
        <p className="team-note">{t('team.note')}</p>
        <ul className="team-members" aria-label={t('team.members')}>
          {team.members.filter(m => !m.archived).map(member => <li key={member.id}>
            <div><strong>{member.name}</strong><span>{roleLabel(member.role)}</span><span>{member.connection?.state === 'connected' ? member.connection.suspended ? t('team.connection.idle') : t('team.connection.connected') : member.connection ? t('team.connection.disconnected') : t('team.connection.none')}</span></div>
            <div className="team-member-actions">
              <Button size="sm" aria-label={t('team.messagesFor', { name: member.name })} aria-pressed={selected === member.id} onClick={() => setSelected(member.id)}>{t('team.messages')}</Button>
              {owner && member.connection?.state !== 'connected' && <Button size="sm" variant="primary" disabled={busy} title={t('team.connectTitle')} onClick={() => void change(() => api!.connect(scope, team.revision, member.id, owner))}>{t('team.connect')}<span className="sr-only">: {member.name}</span></Button>}
              {member.connection?.state === 'connected' && member.connection.owner.kind === 'thread' && <Button size="sm" disabled={busy} aria-pressed={Boolean(member.connection.deliveryEnabled)} onClick={() => void change(() => api!.delivery(scope, team.revision, member.id, !member.connection?.deliveryEnabled))}>{member.connection.deliveryEnabled ? t('team.pauseDelivery') : t('team.enableDelivery')}<span className="sr-only">: {member.name}</span></Button>}
              {member.connection && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void change(() => api!.disconnect(scope, team.revision, member.id))}>{t('team.disconnect')}<span className="sr-only">: {member.name}</span></Button>}
              {member.role !== 'coordinator' && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void change(() => api!.coordinator(scope, team.revision, member.id))}>{t('team.makeCoordinator')}<span className="sr-only">: {member.name}</span></Button>}
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void change(() => api!.archive(scope, team.revision, member.id))}>{t('team.archive')}<span className="sr-only">: {member.name}</span></Button>
            </div>
          </li>)}
        </ul>
        {!team.members.some(m => !m.archived) && <p>{t('team.empty')}</p>}
        <form onSubmit={event => { event.preventDefault(); void change(async () => { const value = await api!.add(scope, team.revision, name, role); setName(''); return value }) }}>
          <label>{t('team.name')}<TextField value={name} onChange={e => setName(e.target.value)} required maxLength={100} placeholder={t('team.namePlaceholder')} /></label>
          <fieldset><legend>{t('team.role')}</legend><div className="team-role-options">{ROLES.map(value => <label key={value}><input type="radio" name="team-role" value={value} checked={role === value} onChange={() => setRole(value)} disabled={value === 'coordinator' && team.members.some(m => !m.archived && m.role === 'coordinator')} />{roleLabel(value)}</label>)}</div>{team.members.some(m => !m.archived && m.role === 'coordinator') && <small className="team-note">{t('team.oneCoordinator')}</small>}</fieldset>
          <Button type="submit" variant="primary" className="team-form-submit" disabled={busy || !name.trim()}>{busy ? t('team.saving') : t('team.add')}</Button>
        </form>
        {team.members.filter(m => m.id === selected && !m.archived).map(member => <TeamMessages key={member.id} scope={scope} member={member} members={team.members} />)}
      </>}
    </div>
  </Dialog>
}
