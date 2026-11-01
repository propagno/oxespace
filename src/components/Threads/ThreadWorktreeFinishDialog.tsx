import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ThreadWorktreeFinishAction, ThreadWorktreeInspection } from '../../../shared/threadWorktree'
import type { ConversationThread } from '../../../shared/types/thread'
import { useThreadStore } from '../../store/thread.store'
import { Button, ConfirmDialog, Dialog, ErrorState, toast } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'

/**
 * Ends a conversation that was started in its own worktree. The worktree is checked first: with nothing in it,
 * it is removed together with the conversation; with work in it, the person decides what happens to that work.
 * Nothing is deleted before they answer, and discarding asks a second time.
 */
export function ThreadWorktreeFinishDialog({ thread, action, onOpenInCode, onClose }: {
  thread: ConversationThread
  action: ThreadWorktreeFinishAction
  onOpenInCode?: (rootPath: string) => Promise<void>
  onClose: () => void
}) {
  const { t } = useTranslation('thread')
  const owned = thread.ownedWorktree
  // undefined: still reading; null: the reading failed (treated as "cannot tell", never as empty).
  const [inspection, setInspection] = useState<ThreadWorktreeInspection | null | undefined>(undefined)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    let current = true
    const api = window.oxe?.thread
    const reading = api?.worktreeInspect ? api.worktreeInspect(thread.id) : Promise.resolve(null)
    reading.then(value => { if (current) setInspection(value) }, () => { if (current) setInspection(null) })
    return () => { current = false }
  }, [thread.id])

  const finish = async (choice: 'auto' | 'keep' | 'discard') => {
    const api = window.oxe?.thread
    if (!api?.worktreeFinish) { setError(t('worktreeFinish.unavailable')); return }
    setBusy(true); setError('')
    try {
      const result = await api.worktreeFinish(thread.id, action, choice)
      await useThreadStore.getState().load()
      const branch = owned?.branch ?? ''
      if (result.removed) toast({ title: t('worktreeFinish.removedToast', { branch }), intent: 'success' })
      else if (result.left === 'changes') toast({ title: t('worktreeFinish.changedToast', { branch }), intent: 'warning' })
      else if (result.left === 'refused') toast({ title: t('worktreeFinish.refusedToast', { branch }), description: result.detail, intent: 'warning' })
      onClose()
    } catch (cause) { setError(humanizeError(cause, t('worktreeFinish.failed'))) } finally { setBusy(false) }
  }

  const branch = owned?.branch ?? ''
  const title = t(`confirm.${action}.title`)
  if (confirmingDiscard) {
    return <ConfirmDialog cancelLabel={t('worktreeFinish.back')} danger busy={busy} error={error}
      title={t('worktreeFinish.discardTitle')} description={t('worktreeFinish.discardDescription', { branch })} confirmLabel={t('worktreeFinish.discardConfirm')}
      onCancel={() => setConfirmingDiscard(false)} onConfirm={() => void finish('discard')} />
  }
  const decision = inspection?.decision
  if (decision?.kind === 'remove') {
    return <ConfirmDialog cancelLabel={t('common.cancel')} busy={busy} error={error} title={title} confirmLabel={t(`worktreeFinish.${action}AndRemove`)}
      description={t('worktreeFinish.cleanDescription', { branch })} onCancel={onClose} onConfirm={() => void finish('auto')} />
  }
  if (decision?.kind === 'gone') {
    return <ConfirmDialog cancelLabel={t('common.cancel')} busy={busy} error={error} title={title} confirmLabel={t(`confirm.${action}.confirm`)}
      description={t('worktreeFinish.goneDescription', { branch })} onCancel={onClose} onConfirm={() => void finish('keep')} />
  }
  if (inspection === undefined) {
    return <Dialog closeLabel={t('common.close')} size="sm" title={title} description={t('worktreeFinish.checking', { branch })} onClose={onClose}
      footer={<Button onClick={onClose}>{t('common.cancel')}</Button>}>{null}</Dialog>
  }
  // Work in the worktree, or Git could not be read: ask, and offer the choices that lose nothing first.
  const ask = decision?.kind === 'ask' ? decision : null
  return <Dialog closeLabel={t('common.close')} className="thread-worktree-finish" size="md" title={title} description={t('worktreeFinish.askDescription', { branch })} onClose={() => { if (!busy) onClose() }}
    footer={<>
      <Button disabled={busy} onClick={onClose}>{t('common.cancel')}</Button>
      {onOpenInCode && owned && <Button disabled={busy} onClick={() => { void onOpenInCode(owned.path).then(onClose, cause => setError(humanizeError(cause, t('sidebar.openInCodeFailed')))) }}>{t('worktreeFinish.openInCode')}</Button>}
      <Button loading={busy} variant="primary" onClick={() => void finish('keep')}>{t(`worktreeFinish.${action}AndKeep`)}</Button>
      {inspection && <Button variant="danger" disabled={busy} onClick={() => setConfirmingDiscard(true)}>{t('worktreeFinish.discard')}</Button>}
    </>}>
    <ul className="thread-worktree-finish-list">
      {ask?.unreadable || !ask ? <li>{t('worktreeFinish.unreadable')}</li> : null}
      {ask && ask.uncommitted > 0 && <li>{t('worktreeFinish.uncommitted', { count: ask.uncommitted })}</li>}
      {ask && ask.untracked > 0 && <li>{t('worktreeFinish.untracked', { count: ask.untracked })}</li>}
      {ask && ask.unpushed > 0 && <li>{t('worktreeFinish.unpushed', { count: ask.unpushed })}</li>}
    </ul>
    <p>{t('worktreeFinish.keepHint')}</p>
    {error && <ErrorState compact title={error} />}
  </Dialog>
}
