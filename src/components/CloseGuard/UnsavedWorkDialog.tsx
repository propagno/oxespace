import { useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { useTranslation } from 'react-i18next'
import type { CloseAnswer, CloseReason } from '../../../shared/types/app'
import { Button, Dialog, ErrorState } from '../../ui'
import type { RunningTurn } from '../../lib/closeGuard'
import { saveAllUnsaved, unsavedWork, type UnsavedItem } from '../../lib/unsavedWork'
import styles from './UnsavedWorkDialog.module.css'

/**
 * What closing the window now would do, and the ways on.
 *
 * With unsaved work: what would be lost, and Cancel (focused, and what Escape does), close without saving, or save
 * everything and close. A save that fails keeps the window open and says what is left.
 *
 * With only turns in progress (`running`): the conversations whose agent is working or waiting for the person, and
 * Cancel (focused) or close anyway. Nothing is lost: the turn stops and the conversation reopens paused.
 */
export function UnsavedWorkDialog({ reason, running = [], onDone }: { reason: CloseReason; running?: RunningTurn[]; onDone: (answer: CloseAnswer) => void }): ReactElement {
  const { t } = useTranslation('common')
  const [work, setWork] = useState(unsavedWork)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const items: UnsavedItem[] = work.flatMap(entry => entry.items)
  const saveAll = async (): Promise<void> => {
    setSaving(true)
    const left = await saveAllUnsaved()
    setSaving(false)
    if (!left.length) { onDone('proceed'); return }
    setWork(left)
    setFailed(true)
  }
  const quit = reason === 'quit'
  if (!items.length && running.length) {
    return <Dialog testId="unsaved-work-dialog" size="sm" title={t(quit ? 'closeGuard.runningTitleQuit' : 'closeGuard.runningTitleClose')}
      description={t('closeGuard.runningDescription', { count: running.length })} onClose={() => onDone('cancel')}
      footer={<>
        <Button variant="secondary" autoFocus onClick={() => onDone('cancel')}>{t('closeGuard.cancel')}</Button>
        <Button variant="danger" onClick={() => onDone('proceed')} data-testid="running-turns-proceed">{t(quit ? 'closeGuard.runningQuit' : 'closeGuard.runningClose')}</Button>
      </>}>
      <ul className={styles.list} aria-label={t('closeGuard.runningListLabel')} data-testid="running-turns-list">
        {running.map(turn => <li key={turn.id}><strong>{turn.title}</strong></li>)}
      </ul>
    </Dialog>
  }
  return <Dialog testId="unsaved-work-dialog" size="sm" title={t(quit ? 'closeGuard.titleQuit' : 'closeGuard.titleClose')}
    description={t('closeGuard.description', { count: items.length })} onClose={() => { if (!saving) onDone('cancel') }}
    footer={<>
      <Button variant="secondary" autoFocus disabled={saving} onClick={() => onDone('cancel')}>{t('closeGuard.cancel')}</Button>
      <Button variant="danger" disabled={saving} onClick={() => onDone('proceed')} data-testid="unsaved-work-discard">{t(quit ? 'closeGuard.discardQuit' : 'closeGuard.discardClose')}</Button>
      <Button variant="primary" loading={saving} onClick={() => void saveAll()} data-testid="unsaved-work-save">{t(quit ? 'closeGuard.saveQuit' : 'closeGuard.saveClose')}</Button>
    </>}>
    <ul className={styles.list} aria-label={t('closeGuard.listLabel')}>
      {items.map(item => <li key={item.id}><strong>{item.label}</strong>{item.detail ? <small>{item.detail}</small> : null}</li>)}
    </ul>
    {running.length ? <p className={styles.note} data-testid="running-turns-note">{t('closeGuard.runningAlso', { count: running.length })}</p> : null}
    {failed ? <div className={styles.error}><ErrorState compact title={t('closeGuard.saveFailed', { count: items.length })} /></div> : null}
  </Dialog>
}

/** Shows the dialog once and resolves with the answer for main. */
export function askAboutUnsavedWork(reason: CloseReason, running: RunningTurn[] = []): Promise<CloseAnswer> {
  return new Promise(resolve => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    let settled = false
    const done = (answer: CloseAnswer): void => {
      if (settled) return
      settled = true
      resolve(answer)
      setTimeout(() => { root.unmount(); container.remove() }, 0)
    }
    root.render(<UnsavedWorkDialog reason={reason} running={running} onDone={done} />)
  })
}
