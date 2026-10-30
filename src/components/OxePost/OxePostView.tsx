import { Suspense, lazy, useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen } from 'lucide-react'
import { ConfirmDialog, EmptyState, ErrorState, Skeleton } from '../../ui'
import { useKeybindings } from '../../keyboard/keybindings'
import { useWorkspaceStore } from '../../store/workspace.store'
import { usePostCatalog } from './catalog'
import { useOxePostStore } from './oxepost.store'
import { RequestEditor } from './RequestEditor'
import { ResponsePanel } from './ResponsePanel'
import styles from './OxePost.module.css'

// Dialogs are only fetched when asked for.
const ImportDialog = lazy(() => import('./ImportDialog').then(m => ({ default: m.ImportDialog })))
const EnvironmentsDialog = lazy(() => import('./EnvironmentsDialog').then(m => ({ default: m.EnvironmentsDialog })))

/** Main area of the OxePost mode: the request being edited and what came back. */
export function OxePostView({ active }: { active: boolean }): ReactElement {
  usePostCatalog()
  const { t } = useTranslation('post')
  const workspaceId = useWorkspaceStore(state => state.activeWorkspaceId)
  const error = useOxePostStore(state => state.error)
  const loading = useOxePostStore(state => state.loading)
  const loaded = useOxePostStore(state => state.workspaceId)
  const dialog = useOxePostStore(state => state.dialog)
  const pendingOpen = useOxePostStore(state => state.pendingOpen)
  const confirmSend = useOxePostStore(state => state.confirmSend)
  const environment = useOxePostStore(state => state.environments.find(item => item.id === state.environment))
  const selected = useOxePostStore(state => state.selected)
  const draftName = useOxePostStore(state => state.draft.name)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => { if (active) void useOxePostStore.getState().load(workspaceId) }, [active, workspaceId])
  useKeybindings({ 'oxepost.send': () => { if (!active) return false; void useOxePostStore.getState().send() } })

  let body: ReactElement
  if (!workspaceId) body = <div className={styles.center}><EmptyState icon={<FolderOpen size={22} aria-hidden="true" />} title={t('view.noWorkspaceTitle')}>{t('view.noWorkspaceText')}</EmptyState></div>
  else if (error && loaded === workspaceId) body = <div className={styles.center}><ErrorState title={t('view.failed')} message={error} onRetry={() => void useOxePostStore.getState().load(workspaceId)} retryLabel={t('view.retry')} /></div>
  else if (loading && loaded !== workspaceId) body = <div className={styles.center}><Skeleton lines={6} label={t('view.loading')} /></div>
  else body = <div className={styles.workbench}><RequestEditor onDelete={() => setDeleting(true)} /><ResponsePanel /></div>

  return <div className={styles.view} aria-label="OxePost">
    {body}
    <Suspense fallback={null}>
      {dialog === 'import' && <ImportDialog onClose={() => useOxePostStore.getState().show(null)} />}
      {dialog === 'environments' && <EnvironmentsDialog onClose={() => useOxePostStore.getState().show(null)} />}
    </Suspense>
    {pendingOpen !== undefined && <ConfirmDialog title={t('discard.title')} description={t('discard.text', { name: draftName })} confirmLabel={t('discard.confirm')} cancelLabel={t('common.cancel')} danger
      onConfirm={() => void useOxePostStore.getState().open(pendingOpen, true)} onCancel={() => useOxePostStore.getState().cancelOpen()} />}
    {deleting && selected && <ConfirmDialog title={t('request.deleteTitle', { name: draftName })} description={t('request.deleteText')} confirmLabel={t('request.delete')} cancelLabel={t('common.cancel')} danger
      onConfirm={() => { setDeleting(false); void useOxePostStore.getState().remove() }} onCancel={() => setDeleting(false)} />}
    {confirmSend && <ConfirmDialog title={t('production.title', { name: environment?.name ?? '' })} description={t('production.text', { method: useOxePostStore.getState().draft.method, url: useOxePostStore.getState().draft.url })}
      confirmLabel={t('production.confirm')} cancelLabel={t('common.cancel')} danger onConfirm={() => void useOxePostStore.getState().send(true)} onCancel={() => useOxePostStore.getState().setConfirmSend(false)} />}
  </div>
}
