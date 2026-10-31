import { useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { useTranslation } from 'react-i18next'
import type { CloseAnswer, CloseReason } from '../../../shared/types/app'
import { Button, Dialog } from '../../ui'
import { saveAllUnsaved, unsavedWork, type UnsavedItem } from '../../lib/unsavedWork'
import styles from './UnsavedWorkDialog.module.css'

/**
 * What would be lost if the window closed now, and three ways on: Cancel (focused, and what Escape does), close
 * without saving, or save everything and close. A save that fails keeps the window open and says what is left.
 */
export function UnsavedWorkDialog({ reason, onDone }: { reason: CloseReason; onDone: (answer: CloseAnswer) => void }): ReactElement {
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
  return <Dialog testId="unsaved-work-dialog" size="sm" title={t(reason === 'quit' ? 'closeGuard.titleQuit' : 'closeGuard.titleClose')}
    description={t('closeGuard.description', { count: items.length })} onClose={() => { if (!saving) onDone('cancel') }}
    footer={<>
      <Button variant="secondary" autoFocus disabled={saving} onClick={() => onDone('cancel')}>{t('closeGuard.cancel')}</Button>
      <Button variant="danger" disabled={saving} onClick={() => onDone('proceed')} data-testid="unsaved-work-discard">{t(reason === 'quit' ? 'closeGuard.discardQuit' : 'closeGuard.discardClose')}</Button>
      <Button variant="primary" loading={saving} onClick={() => void saveAll()} data-testid="unsaved-work-save">{t(reason === 'quit' ? 'closeGuard.saveQuit' : 'closeGuard.saveClose')}</Button>
    </>}>
    <ul className={styles.list} aria-label={t('closeGuard.listLabel')}>
      {items.map(item => <li key={item.id}><strong>{item.label}</strong>{item.detail ? <small>{item.detail}</small> : null}</li>)}
    </ul>
    {failed ? <p role="alert" className={styles.error}>{t('closeGuard.saveFailed', { count: items.length })}</p> : null}
  </Dialog>
}

/** Shows the dialog once and resolves with the answer for main. */
export function askAboutUnsavedWork(reason: CloseReason): Promise<CloseAnswer> {
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
    root.render(<UnsavedWorkDialog reason={reason} onDone={done} />)
  })
}
