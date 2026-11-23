import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { Workspace } from '../../../shared/types/workspace'
import { RichText } from '../../i18n/RichText'
import { useWorkspaceStore } from '../../store/workspace.store'
import { Button, ConfirmDialog, ErrorState } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'

/**
 * OXE-367 (A16): whether the workspace's folder is still there, asked of main for this workspace and root. Null until
 * main answers, and when it cannot (an older main): the surface then shows the terminals as before.
 */
export function useWorkspaceRootAvailable(workspaceId: string, rootPath: string | undefined): boolean | null {
  const key = `${workspaceId}\u0000${rootPath ?? ''}`
  const [answer, setAnswer] = useState<{ key: string; available: boolean } | null>(null)
  useEffect(() => {
    let live = true
    const status = window.oxe?.workspace?.rootStatus?.(workspaceId)
    void status?.then(result => { if (live && typeof result?.available === 'boolean') setAnswer({ key, available: result.available }) }, () => undefined)
    return () => { live = false }
  }, [key, workspaceId])
  return answer?.key === key ? answer.available : null
}

/**
 * OXE-367 (A16): the workspace's folder was moved or deleted. In place of the grid (so no pane tries to start in it),
 * the existing ErrorState says so and offers Relink folder (pick the folder, main checks it as on create) and Remove
 * workspace (asks first, as the sidebar does). Nothing on disk is created, moved or deleted.
 */
export function WorkspaceMissingRoot({ workspace }: { workspace: Workspace }): ReactElement {
  const { t } = useTranslation('code')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const relink = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const folder = await window.oxe.workspace.pickFolder()
      if (folder) await useWorkspaceStore.getState().relinkWorkspace(workspace.id, folder)
    } catch (err) {
      setError(humanizeError(err, t('workspace.missingRoot.relinkFailed')))
    } finally {
      setBusy(false)
    }
  }

  return <div data-testid="workspace-missing-root">
    <ErrorState heading={2} title={t('workspace.missingRoot.title')} message={t('workspace.missingRoot.message', { path: workspace.rootPath })} detail={error ?? undefined}
      actions={<>
        <Button variant="primary" onClick={() => void relink()} loading={busy} disabled={busy}>{t('workspace.missingRoot.relink')}</Button>
        <Button variant="secondary" onClick={() => setConfirmRemove(true)} disabled={busy}>{t('sidebar.remove')}</Button>
      </>} />
    {confirmRemove ? <ConfirmDialog title={t('sidebar.removeTitle')} danger confirmLabel={t('sidebar.remove')} onCancel={() => setConfirmRemove(false)}
      onConfirm={() => { setConfirmRemove(false); void useWorkspaceStore.getState().closeWorkspace(workspace.id) }}
      description={<RichText text={t('sidebar.removeBody', { name: workspace.name })} />} /> : null}
  </div>
}
