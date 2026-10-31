import { useEffect, useState } from 'react'
import type { AgentTeam, TeamRole, TeamScope } from '../../../shared/types/team'
import './TeamDialog.css'
import { TeamMessages } from './TeamMessages'
import { Button, Dialog, Notice, TextField } from '../../ui'

const roles: Record<TeamRole, string> = { coordinator: 'Coordinator / integrator', 'project-manager': 'Project manager', 'product-manager': 'Product manager', developer: 'Developer', reviewer: 'Reviewer' }
export function TeamDialog({ scope, owner, onClose }: { scope: TeamScope; owner?: { kind: 'thread' | 'pane'; id: string }; onClose: () => void }) {
  const [team, setTeam] = useState<AgentTeam | null>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [name, setName] = useState(''), [role, setRole] = useState<TeamRole>('developer')
  const [selected, setSelected] = useState<string | null>(null)
  const api = window.oxe.team
  useEffect(() => {
    let cancelled = false
    if (!api) { setError('Team is unavailable in this runtime.'); return }
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
  return <Dialog className="team-dialog" size="lg" title="Team" description="Persistent roles for this project, shared by Code and Thread." onClose={onClose}>
    <div className="team-dialog-body">
      {error && <Notice intent="danger">{error}</Notice>}
      {!team && !error && <p role="status">Loading team…</p>}
      {team && <>
        <h3>{team.name}</h3>
        <p className="team-note">Members are saved independently of sessions. Creating a role does not start an agent. Automatic delivery sends inbox messages to a connected idle Thread. It pauses after failure, interruption or restart; Code sessions read their inbox through MCP.</p>
        <ul className="team-members" aria-label="Team members">
          {team.members.filter(m => !m.archived).map(member => <li key={member.id}>
            <div><strong>{member.name}</strong><span>{roles[member.role]}</span><span>{member.connection?.state === 'connected' ? member.connection.suspended ? 'Session connected · idle, a message starts it again' : 'Session connected' : member.connection ? 'Session disconnected · reconnect to authorize MCP' : 'No session connected'}</span></div>
            <div className="team-member-actions">
              <Button size="sm" aria-label={`Messages: ${member.name}`} aria-pressed={selected === member.id} onClick={() => setSelected(member.id)}>Messages</Button>
              {owner && member.connection?.state !== 'connected' && <Button size="sm" variant="primary" disabled={busy} title="Lets the active session read and send this member's messages through MCP" onClick={() => void change(() => api!.connect(scope, team.revision, member.id, owner))}>Connect current session<span className="sr-only">: {member.name}</span></Button>}
              {member.connection?.state === 'connected' && member.connection.owner.kind === 'thread' && <Button size="sm" disabled={busy} aria-pressed={Boolean(member.connection.deliveryEnabled)} onClick={() => void change(() => api!.delivery(scope, team.revision, member.id, !member.connection?.deliveryEnabled))}>{member.connection.deliveryEnabled ? 'Pause automatic delivery' : 'Enable automatic delivery'}<span className="sr-only">: {member.name}</span></Button>}
              {member.connection && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void change(() => api!.disconnect(scope, team.revision, member.id))}>Disconnect<span className="sr-only">: {member.name}</span></Button>}
              {member.role !== 'coordinator' && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void change(() => api!.coordinator(scope, team.revision, member.id))}>Make coordinator<span className="sr-only">: {member.name}</span></Button>}
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void change(() => api!.archive(scope, team.revision, member.id))}>Archive<span className="sr-only">: {member.name}</span></Button>
            </div>
          </li>)}
        </ul>
        {!team.members.some(m => !m.archived) && <p>No members yet. Add a coordinator or another project role.</p>}
        <form onSubmit={event => { event.preventDefault(); void change(async () => { const value = await api!.add(scope, team.revision, name, role); setName(''); return value }) }}>
          <label>Member name<TextField value={name} onChange={e => setName(e.target.value)} required maxLength={100} placeholder="e.g. Authentication developer" /></label>
          <fieldset><legend>Role</legend><div className="team-role-options">{Object.entries(roles).map(([value, label]) => <label key={value}><input type="radio" name="team-role" value={value} checked={role === value} onChange={() => setRole(value as TeamRole)} disabled={value === 'coordinator' && team.members.some(m => !m.archived && m.role === 'coordinator')} />{label}</label>)}</div>{team.members.some(m => !m.archived && m.role === 'coordinator') && <small className="team-note">A team has one coordinator. Use Make coordinator on a member to hand the role over.</small>}</fieldset>
          <Button type="submit" variant="primary" className="team-form-submit" disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Add member'}</Button>
        </form>
        {team.members.filter(m => m.id === selected && !m.archived).map(member => <TeamMessages key={member.id} scope={scope} member={member} members={team.members} />)}
      </>}
    </div>
  </Dialog>
}
