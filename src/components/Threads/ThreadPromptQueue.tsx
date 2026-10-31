import { useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, Check, Clock3, Pencil, SendHorizontal, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ThreadQueuedInput, ThreadQueuePause } from '../../../shared/types/thread'
import { ConfirmDialog, TextField } from '../../ui'

export function ThreadPromptQueue({ items, disabled, running = false, pause, onClear, onDelete, onResume, onRestore, onReorder, onSendNow, onUpdate }: {
  items: ThreadQueuedInput[]; disabled: boolean
  /** A turn is running: sending an item now stops it first, after a confirmation. */
  running?: boolean
  pause?: ThreadQueuePause
  onClear?: () => Promise<void>; onResume?: () => Promise<void>; onSendNow?: (id: string) => Promise<void>
  onDelete: (id: string) => Promise<void>; onRestore: (item: ThreadQueuedInput) => Promise<void>; onReorder: (ids: string[]) => Promise<void>; onUpdate: (id: string, text: string) => Promise<void>
}) {
  const { t } = useTranslation('thread')
  const [editing, setEditing] = useState<string | null>(null), [text, setText] = useState('')
  const [confirmSend, setConfirmSend] = useState<ThreadQueuedInput | null>(null)
  const sendNow = (item: ThreadQueuedInput) => { if (running) setConfirmSend(item); else void onSendNow?.(item.id) }
  if (!items.length) return null
  const move = (index: number, offset: number) => {
    const next = [...items], target = index + offset
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    void onReorder(next.map(item => item.id))
  }
  return <section className="thread-prompt-queue" aria-label={t('queue.title')}><header><Clock3 size={14} /><strong>{t('queue.title')}</strong><small>{items.length}</small></header>
    {pause && <div className="thread-queue-pause" role="status"><span>{pause.reason === 'failed' ? t('queue.pausedFailed') : t('queue.pausedInterrupted')}</span>
      {onResume && <button type="button" disabled={disabled} onClick={() => void onResume()}>{t('queue.resume')}</button>}
      {onSendNow && items.some(item => item.state === 'queued') && <button type="button" disabled={disabled} onClick={() => void onSendNow(items.find(item => item.state === 'queued')!.id)}>{t('queue.sendNext')}</button>}
      {onClear && <button type="button" disabled={disabled} onClick={() => void onClear()}>{t('queue.clear')}</button>}
    </div>}
    {items.map((item, index) => <div key={item.id} className={`thread-queue-item is-${item.state}`}>{editing === item.id ? <TextField autoFocus aria-label={t('queue.editLabel')} value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setEditing(null); if (event.key === 'Enter' && text.trim()) void onUpdate(item.id, text.trim()).then(() => setEditing(null)) }} /> : <span title={item.text}>{item.text}</span>}<small>{t(`queue.state.${item.state}`)}</small>{item.error && <p role="status"><AlertTriangle size={12} aria-hidden="true" />{item.error}</p>}{editing === item.id ? <><button type="button" aria-label={t('queue.save')} disabled={disabled || !text.trim()} onClick={() => void onUpdate(item.id, text.trim()).then(() => setEditing(null))}><Check size={12} /></button><button type="button" aria-label={t('queue.cancelEditing')} onClick={() => setEditing(null)}><X size={12} /></button></> : <>{onSendNow && <button type="button" aria-label={t('queue.sendNow')} title={running ? t('queue.sendNowRunning') : t('queue.sendNowTitle')} disabled={disabled || item.state !== 'queued'} onClick={() => sendNow(item)}><SendHorizontal size={12} /></button>}<button type="button" aria-label={t('queue.editLabel')} disabled={disabled || item.state !== 'queued'} onClick={() => { setEditing(item.id); setText(item.text) }}><Pencil size={12} /></button><button type="button" aria-label={t('queue.up')} disabled={disabled || index === 0 || item.state !== 'queued'} onClick={() => move(index, -1)}><ArrowUp size={12} /></button><button type="button" aria-label={t('queue.down')} disabled={disabled || index === items.length - 1 || item.state !== 'queued'} onClick={() => move(index, 1)}><ArrowDown size={12} /></button><button type="button" aria-label={item.state === 'unknown' ? t('queue.dismiss') : t('queue.restore')} title={item.state === 'unknown' ? t('queue.dismissTitle') : t('queue.restoreTitle')} disabled={disabled || item.state === 'sending'} onClick={() => void (item.state === 'unknown' ? onDelete(item.id) : onRestore(item))}><Trash2 size={12} /></button></>}</div>)}
    {confirmSend && <ConfirmDialog cancelLabel={t('common.cancel')} title={t('queue.confirmTitle')} confirmLabel={t('queue.confirmLabel')} description={t('queue.confirmBody')}
      onCancel={() => setConfirmSend(null)} onConfirm={() => { const item = confirmSend; setConfirmSend(null); void onSendNow?.(item.id) }}><p className="thread-queue-confirm">{confirmSend.text}</p></ConfirmDialog>}
  </section>
}
