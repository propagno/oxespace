import { useEffect, useState } from 'react'
import type { DelegationSnapshot } from '../../../shared/types/delegation'
import type { ThreadProjectSummary } from '../../../shared/types/thread'
import { useThreadStore } from '../../store/thread.store'
import { useTranslation } from 'react-i18next'
import { Button, Checkbox, Dialog, ErrorState, TextField } from '../../ui'
import { errorText, humanizeError } from '../../utils/humanizeError'
import { ThreadProjectSemantic } from './ThreadProjectSemantic'
import { formatDate } from '../../utils/formatTime'

export function ThreadProjectSettingsDialog({ project, unavailable, onClose, returnFocusTo }: { project: ThreadProjectSummary; unavailable: boolean; onClose(): void; returnFocusTo?: () => HTMLElement | null }) {
  const { t } = useTranslation('thread')
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
    catch (cause) { setError(humanizeError(cause, t('projectSettings.saveFailed'))) }
    finally { setBusy(false) }
  }
  const needsRelink = unavailable || directoryMissing
  return <Dialog closeLabel={t('common.close')} className="thread-create-dialog thread-project-dialog thread-project-settings" title={t('projectSettings.title', { name: project.displayName })}
    description={t('projectSettings.description')} onClose={onClose} returnFocusTo={returnFocusTo}>
    <div className="thread-project-settings-body"><div className="thread-create-section"><strong>{t('projectSettings.directory')}</strong><p className="thread-project-current-path" title={project.contexts[0]?.rootPath}>{project.contexts[0]?.rootPath}</p>
      {needsRelink && <ErrorState compact title={t('projectSettings.unavailable')} />}
      <details className="thread-project-relink" open={needsRelink || undefined}><summary>{needsRelink ? t('projectSettings.relinkMissing') : t('projectSettings.change')}</summary>
        <label>{t('projectSettings.newDirectory')}<TextField aria-label={t('projectSettings.newDirectoryLabel')} value={relinkPath} onChange={event => setRelinkPath(event.target.value)} placeholder={t('projectSettings.newDirectoryPlaceholder')} /></label>
        <Button size="sm" disabled={busy || !relinkPath.trim()} onClick={() => void apply(async () => {
          await window.oxe.thread!.relinkProject(project.projectId, relinkPath.trim())
          await useThreadStore.getState().loadProjects()
          await useThreadStore.getState().load()
          setDirectoryMissing(false)
          setRelinkPath('')
        })}>{t('projectSettings.relink')}</Button>
      </details>
    </div>
    {project.contexts[0]?.rootPath && <ThreadProjectSemantic rootPath={project.contexts[0].rootPath} disabled={needsRelink} />}
    <div className="thread-create-section"><strong>{t('projectSettings.delegation')}</strong>
      <Checkbox className="thread-project-check" checked={snapshot?.enabled ?? false} disabled={!snapshot || busy}
        onChange={event => void apply(() => window.oxe.delegation.configure(scope, event.target.checked))} label={t('projectSettings.allow')} />
      <p>{t('projectSettings.optIn')}</p>
      <label>{t('projectSettings.destination')}<TextField value={path} onChange={event => { setPath(event.target.value); setConsent(false) }} placeholder={t('projectSettings.destinationPlaceholder')} /></label>
      <Checkbox className="thread-project-check" checked={evidence} onChange={event => { setEvidence(event.target.checked); setConsent(false) }} label={t('projectSettings.evidence')} />
      <Checkbox className="thread-project-check" checked={consent} onChange={event => setConsent(event.target.checked)} label={t('projectSettings.consent')} />
      <Button size="sm" disabled={!snapshot || busy || !path.trim() || !consent} onClick={() => void apply(async () => {
        await window.oxe.delegation.configureTarget(scope, path.trim(), true, evidence)
        await useThreadStore.getState().loadProjects()
        setPath(''); setConsent(false)
      })}>{t('projectSettings.authorize')}</Button>
      {(snapshot?.targets ?? []).map(target => <div className="thread-project-destination" key={target.workspaceId}>
        <strong>{target.name}</strong><small>{t('projectSettings.until', { path: target.rootPath, date: formatDate(target.expiresAt) })}</small>
        <Button size="sm" variant="danger" disabled={busy} onClick={() => void apply(() => window.oxe.delegation.configureTarget(scope, target.rootPath, false, false))}>{t('projectSettings.revoke')}</Button>
      </div>)}
    </div>
    {error && <ErrorState compact title={error} />}
    </div>
  </Dialog>
}
