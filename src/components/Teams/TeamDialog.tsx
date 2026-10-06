import { useEffect, useState } from 'react'
import type { AgentTeam, TeamRole, TeamScope } from '../../../shared/types/team'
import { DesktopDialog } from '../Navigation/DesktopDialog'
import './TeamDialog.css'
import { TeamMessages } from './TeamMessages'

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
  return <DesktopDialog className="team-dialog" title="Team" description="Persistent roles for this project, shared by Code and Thread." onClose={onClose}>
    <div className="team-dialog-body">
      {error && <p role="alert">{error}</p>}
      {!team && !error && <p role="status">Loading team…</p>}
      {team && <>
        <h3>{team.name}</h3>
        <p className="team-note">Members are saved independently of sessions. Creating a role does not start an agent. Automatic delivery sends inbox messages to a connected idle Thread. It pauses after failure, interruption or restart; Code sessions read their inbox through MCP.</p>
        <ul className="team-members" aria-label="Team members">
          {team.members.filter(m => !m.archived).map(member => <li key={member.id}>
            <div><strong>{member.name}</strong><span>{roles[member.role]}</span><span>{member.connection?.state === 'connected' ? 'Session connected' : member.connection ? 'Session disconnected · reconnect to authorize MCP' : 'No session connected'}</span></div>
            <div className="team-member-actions">
              <button type="button" aria-label={`Messages: ${member.name}`} aria-pressed={selected === member.id} onClick={() => setSelected(member.id)}>Messages</button>
              {owner && member.connection?.state !== 'connected' && <button type="button" disabled={busy} onClick={() => void change(() => api!.connect(scope, team.revision, member.id, owner))}>Connect current session<span className="sr-only">: {member.name}</span></button>}
              {member.connection?.state === 'connected' && member.connection.owner.kind === 'thread' && <button type="button" disabled={busy} aria-pressed={Boolean(member.connection.deliveryEnabled)} onClick={() => void change(() => api!.delivery(scope, team.revision, member.id, !member.connection?.deliveryEnabled))}>{member.connection.deliveryEnabled ? 'Pause automatic delivery' : 'Enable automatic delivery'}<span className="sr-only">: {member.name}</span></button>}
              {member.connection && <button type="button" disabled={busy} onClick={() => void change(() => api!.disconnect(scope, team.revision, member.id))}>Disconnect<span className="sr-only">: {member.name}</span></button>}
              {member.role !== 'coordinator' && <button type="button" disabled={busy} onClick={() => void change(() => api!.coordinator(scope, team.revision, member.id))}>Make coordinator<span className="sr-only">: {member.name}</span></button>}
              <button type="button" disabled={busy} onClick={() => void change(() => api!.archive(scope, team.revision, member.id))}>Archive<span className="sr-only">: {member.name}</span></button>
            </div>
          </li>)}
        </ul>
        {!team.members.some(m => !m.archived) && <p>No members yet. Add a coordinator or another project role.</p>}
        <form onSubmit={event => { event.preventDefault(); void change(async () => { const value = await api!.add(scope, team.revision, name, role); setName(''); return value }) }}>
          <label>Member name<input value={name} onChange={e => setName(e.target.value)} required maxLength={100} placeholder="e.g. Authentication developer" /></label>
          <fieldset><legend>Role</legend><div className="team-role-options">{Object.entries(roles).map(([value, label]) => <label key={value}><input type="radio" name="team-role" value={value} checked={role === value} onChange={() => setRole(value as TeamRole)} disabled={value === 'coordinator' && team.members.some(m => !m.archived && m.role === 'coordinator')} />{label}</label>)}</div></fieldset>
          <button type="submit" className="primary-action" disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Add member'}</button>
        </form>
        {team.members.filter(m => m.id === selected && !m.archived).map(member => <TeamMessages key={member.id} scope={scope} member={member} members={team.members} />)}
      </>}
    </div>
    <footer className="team-dialog-footer"><button type="button" className="secondary-action" onClick={onClose}>Done</button></footer>
  </DesktopDialog>
}
