import { useEffect, useState } from 'react'
import type { DelegationSnapshot } from '../../../shared/types/delegation'
import type { ThreadProjectSummary } from '../../../shared/types/thread'
import { DesktopDialog } from '../Navigation/DesktopDialog'
import { useThreadStore } from '../../store/thread.store'

export function ThreadProjectSettingsDialog({ project, unavailable, onClose }: { project: ThreadProjectSummary; unavailable: boolean; onClose(): void }) {
  const scope = `thread:${project.projectId}`
  const [snapshot, setSnapshot] = useState<DelegationSnapshot | null>(null)
  const [path, setPath] = useState('')
  const [relinkPath, setRelinkPath] = useState('')
  const [evidence, setEvidence] = useState(false)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void window.oxe.delegation.status(scope).then(value => { if (active) setSnapshot(value) })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { active = false }
  }, [scope])
  const apply = async (action: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await action(); setSnapshot(await window.oxe.delegation.status(scope)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save project settings.') }
    finally { setBusy(false) }
  }
  return <DesktopDialog className="thread-create-dialog thread-project-dialog thread-project-settings" title={`Thread project · ${project.displayName}`}
    description="These settings apply to this Thread project. Code workspace settings are separate." onClose={onClose}>
    <div className="thread-create-section"><strong>Project directory</strong><p className="thread-project-current-path" title={project.contexts[0]?.rootPath}>{project.contexts[0]?.rootPath}</p>
      {unavailable && <p role="alert">This directory is unavailable. Choose its new location to resume work.</p>}
      <details className="thread-project-relink" open={unavailable || undefined}><summary>{unavailable ? 'Relink missing directory' : 'Change project directory'}</summary>
        <label>New directory<input aria-label="New project directory" value={relinkPath} onChange={event => setRelinkPath(event.target.value)} placeholder="Absolute path to the project" /></label>
        <button type="button" disabled={busy || !relinkPath.trim()} onClick={() => void apply(async () => {
          await window.oxe.thread!.relinkProject(project.projectId, relinkPath.trim())
          await useThreadStore.getState().loadProjects()
          await useThreadStore.getState().load()
          setRelinkPath('')
        })}>Relink directory</button>
      </details>
    </div>
    <div className="thread-create-section"><strong>Agent delegation</strong>
      <label className="thread-project-check"><input type="checkbox" checked={snapshot?.enabled ?? false} disabled={!snapshot || busy}
        onChange={event => void apply(() => window.oxe.delegation.configure(scope, event.target.checked))} /> Allow agents in this Thread project to delegate work</label>
      <p>Each destination also needs its own opt-in. Cross-project transfers require a separate authorization.</p>
      <label>Destination directory<input value={path} onChange={event => { setPath(event.target.value); setConsent(false) }} placeholder="Absolute path to another local repository" /></label>
      <label className="thread-project-check"><input type="checkbox" checked={evidence} onChange={event => { setEvidence(event.target.checked); setConsent(false) }} /> Include selected committed text as evidence</label>
      <label className="thread-project-check"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} /> Authorize handoff to the destination agent for 30 days</label>
      <button type="button" disabled={!snapshot || busy || !path.trim() || !consent} onClick={() => void apply(async () => {
        await window.oxe.delegation.configureTarget(scope, path.trim(), true, evidence)
        await useThreadStore.getState().loadProjects()
        setPath(''); setConsent(false)
      })}>Authorize destination</button>
      {(snapshot?.targets ?? []).map(target => <div className="thread-project-destination" key={target.workspaceId}>
        <strong>{target.name}</strong><small>{target.rootPath} · until {new Date(target.expiresAt).toLocaleDateString()}</small>
        <button type="button" disabled={busy} onClick={() => void apply(() => window.oxe.delegation.configureTarget(scope, target.rootPath, false, false))}>Revoke</button>
      </div>)}
    </div>
    {error && <p role="alert">{error}</p>}
    <footer><button type="button" onClick={onClose}>Done</button></footer>
  </DesktopDialog>
}
