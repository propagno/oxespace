import { useEffect, useState } from 'react'
import type { DelegationSnapshot } from '../../../shared/types/delegation'
import type { ThreadProjectSummary } from '../../../shared/types/thread'
import { useThreadStore } from '../../store/thread.store'
import { Button, Checkbox, Dialog, TextField } from '../../ui'
import { errorText, humanizeError } from '../../utils/humanizeError'
import { ThreadProjectSemantic } from './ThreadProjectSemantic'

export function ThreadProjectSettingsDialog({ project, unavailable, onClose, returnFocusTo }: { project: ThreadProjectSummary; unavailable: boolean; onClose(): void; returnFocusTo?: () => HTMLElement | null }) {
  const scope = `thread:${project.projectId}`
  const [snapshot, setSnapshot] = useState<DelegationSnapshot | null>(null)
  const [path, setPath] = useState('')
  const [relinkPath, setRelinkPath] = useState('')
  const [evidence, setEvidence] = useState(false)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [directoryMissing, setDirectoryMissing] = useState(unavailable)
  useEffect(() => {
    if (unavailable) { setDirectoryMissing(true); setSnapshot(null); return }
    let active = true
    void window.oxe.delegation.status(scope).then(value => { if (active) setSnapshot(value) })
      .catch(cause => {
        if (!active) return
        if (errorText(cause).includes('ENOENT')) { setDirectoryMissing(true); setSnapshot(null) }
        else setError(humanizeError(cause))
      })
    return () => { active = false }
  }, [scope, unavailable])
  const apply = async (action: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await action(); setSnapshot(await window.oxe.delegation.status(scope)) }
    catch (cause) { setError(humanizeError(cause, 'Could not save project settings.')) }
    finally { setBusy(false) }
  }
  const needsRelink = unavailable || directoryMissing
  return <Dialog className="thread-create-dialog thread-project-dialog thread-project-settings" title={`Thread project · ${project.displayName}`}
    description="These settings apply to this Thread project. Code workspace settings are separate." onClose={onClose} returnFocusTo={returnFocusTo}>
    <div className="thread-project-settings-body"><div className="thread-create-section"><strong>Project directory</strong><p className="thread-project-current-path" title={project.contexts[0]?.rootPath}>{project.contexts[0]?.rootPath}</p>
      {needsRelink && <p role="alert">This directory is unavailable. Choose its new location to resume work.</p>}
      <details className="thread-project-relink" open={needsRelink || undefined}><summary>{needsRelink ? 'Relink missing directory' : 'Change project directory'}</summary>
        <label>New directory<TextField aria-label="New project directory" value={relinkPath} onChange={event => setRelinkPath(event.target.value)} placeholder="Absolute path to the project" /></label>
        <Button size="sm" disabled={busy || !relinkPath.trim()} onClick={() => void apply(async () => {
          await window.oxe.thread!.relinkProject(project.projectId, relinkPath.trim())
          await useThreadStore.getState().loadProjects()
          await useThreadStore.getState().load()
          setDirectoryMissing(false)
          setRelinkPath('')
        })}>Relink directory</Button>
      </details>
    </div>
    {project.contexts[0]?.rootPath && <ThreadProjectSemantic rootPath={project.contexts[0].rootPath} disabled={needsRelink} />}
    <div className="thread-create-section"><strong>Agent delegation</strong>
      <Checkbox className="thread-project-check" checked={snapshot?.enabled ?? false} disabled={!snapshot || busy}
        onChange={event => void apply(() => window.oxe.delegation.configure(scope, event.target.checked))} label="Allow agents in this Thread project to delegate work" />
      <p>Each destination also needs its own opt-in. Cross-project transfers require a separate authorization.</p>
      <label>Destination directory<TextField value={path} onChange={event => { setPath(event.target.value); setConsent(false) }} placeholder="Absolute path to another local repository" /></label>
      <Checkbox className="thread-project-check" checked={evidence} onChange={event => { setEvidence(event.target.checked); setConsent(false) }} label="Include selected committed text as evidence" />
      <Checkbox className="thread-project-check" checked={consent} onChange={event => setConsent(event.target.checked)} label="Authorize handoff to the destination agent for 30 days" />
      <Button size="sm" disabled={!snapshot || busy || !path.trim() || !consent} onClick={() => void apply(async () => {
        await window.oxe.delegation.configureTarget(scope, path.trim(), true, evidence)
        await useThreadStore.getState().loadProjects()
        setPath(''); setConsent(false)
      })}>Authorize destination</Button>
      {(snapshot?.targets ?? []).map(target => <div className="thread-project-destination" key={target.workspaceId}>
        <strong>{target.name}</strong><small>{target.rootPath} · until {new Date(target.expiresAt).toLocaleDateString()}</small>
        <Button size="sm" variant="danger" disabled={busy} onClick={() => void apply(() => window.oxe.delegation.configureTarget(scope, target.rootPath, false, false))}>Revoke</Button>
      </div>)}
    </div>
    {error && <p role="alert">{error}</p>}
    </div>
  </Dialog>
}
