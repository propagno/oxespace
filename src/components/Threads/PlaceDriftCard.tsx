import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, ConfirmDialog, toast } from '../../ui'
import type { ThreadPlace, ThreadPlaceDriftAnswer } from '../../../shared/types/thread-places'
import { useThreadStore } from '../../store/thread.store'
import { useUIStore } from '../../store/ui.store'
import { clockTime, driftPaneHint, placesBridge, switchBackBlock } from './placesModel'

/**
 * U4.2: the branch drift card of one place. It names when the place moved, from which branch to which, and the pane
 * that probably moved it (a hint, never proof), and offers Switch back, Follow and Dismiss. Main records the answer.
 */
export function PlaceDriftCard(props: { threadId: string; place: ThreadPlace }): ReactElement {
  const { threadId, place } = props
  const { t } = useTranslation('thread')
  const [confirm, setConfirm] = useState<'switched-back' | 'followed' | null>(null)
  const [busy, setBusy] = useState(false)
  const running = useThreadStore(state => {
    const snapshot = state.snapshot
    return snapshot?.thread.id === threadId && snapshot.thread.status === 'running'
  })
  const drift = place.drift
  if (!drift) return <></>
  const detachedName = t('places.drift.detachedBranch')
  const from = drift.from.branch ?? detachedName
  const to = drift.to.branch ?? detachedName
  const time = clockTime(drift.seenAt)
  const hint = driftPaneHint(drift)
  const moved = hint.kind === 'one'
    ? t('places.drift.movedOne', { time, from, to, pane: hint.title })
    : hint.kind === 'many'
      ? t('places.drift.movedMany', { time, from, to, panes: hint.titles })
      : t('places.drift.moved', { time, from, to })
  const block = switchBackBlock(drift, running)

  const answer = async (value: ThreadPlaceDriftAnswer): Promise<void> => {
    const api = placesBridge()
    if (!api?.placeDriftAnswer) return
    setBusy(true)
    try {
      const result = await api.placeDriftAnswer(threadId, place.id, value)
      if (!result.ok) toast({ title: t('places.drift.failed'), intent: 'danger' })
    } catch {
      toast({ title: t('places.drift.failed'), intent: 'danger' })
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  return <div className="place-drift" data-tone="warning" data-drift-card={place.id}>
    <p className="place-drift-title">{t('places.drift.title')}</p>
    <p>{moved}</p>
    <div className="place-drift-actions">
      <Button size="sm" disabled={block !== null || busy} onClick={() => setConfirm('switched-back')}>
        {t('places.drift.switchBack', { branch: from })}
      </Button>
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirm('followed')}>{t('places.drift.follow')}</Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void answer('dismissed')}>{t('places.drift.dismiss')}</Button>
      {hint.kind === 'one'
        ? <Button size="sm" variant="ghost" onClick={() => openPane(hint.paneId)}>{t('places.drift.openTerminal')}</Button>
        : null}
    </div>
    {block ? <p className="place-drift-reason">{t(`places.drift.${block}`)}</p> : null}
    {confirm === 'followed'
      ? <ConfirmDialog title={t('places.drift.followTitle')} description={t('places.drift.followText', { branch: to })}
        confirmLabel={t('places.drift.followConfirm', { branch: to })} busy={busy}
        onConfirm={() => void answer('followed')} onCancel={() => setConfirm(null)} />
      : null}
    {confirm === 'switched-back'
      ? <ConfirmDialog title={t('places.drift.switchBackTitle')} description={t('places.drift.switchBackText', { branch: from, to })}
        confirmLabel={t('places.drift.switchBackConfirm')} busy={busy}
        onConfirm={() => void answer('switched-back')} onCancel={() => setConfirm(null)} />
      : null}
  </div>
}

/** Brings the pane that probably moved the branch to the front. */
function openPane(paneId: string): void {
  useUIStore.getState().setActivePane(paneId)
}
