import { useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, Check, Clock3, Pencil, Trash2, X } from 'lucide-react'
import type { ThreadQueuedInput } from '../../../shared/types/thread'

export function ThreadPromptQueue({ items, disabled, onDelete, onRestore, onReorder, onUpdate }: {
  items: ThreadQueuedInput[]; disabled: boolean
  onDelete: (id: string) => Promise<void>; onRestore: (item: ThreadQueuedInput) => Promise<void>; onReorder: (ids: string[]) => Promise<void>; onUpdate: (id: string, text: string) => Promise<void>
}) {
  const [editing, setEditing] = useState<string | null>(null), [text, setText] = useState('')
  if (!items.length) return null
  const move = (index: number, offset: number) => {
    const next = [...items], target = index + offset
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    void onReorder(next.map(item => item.id))
  }
  return <section className="thread-prompt-queue" aria-label="Queued follow-ups"><header><Clock3 size={13} /><strong>Queued follow-ups</strong><small>{items.length}</small></header>
    {items.map((item, index) => <div key={item.id} className={`thread-queue-item is-${item.state}`}>{editing === item.id ? <input autoFocus aria-label="Edit queued input" value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setEditing(null); if (event.key === 'Enter' && text.trim()) void onUpdate(item.id, text.trim()).then(() => setEditing(null)) }} /> : <span title={item.text}>{item.text}</span>}<small>{item.state}</small>{item.error && <p role="status"><AlertTriangle size={12} aria-hidden="true" />{item.error}</p>}{editing === item.id ? <><button type="button" aria-label="Save queued input" disabled={disabled || !text.trim()} onClick={() => void onUpdate(item.id, text.trim()).then(() => setEditing(null))}><Check size={12} /></button><button type="button" aria-label="Cancel editing" onClick={() => setEditing(null)}><X size={12} /></button></> : <><button type="button" aria-label="Edit queued input" disabled={disabled || item.state !== 'queued'} onClick={() => { setEditing(item.id); setText(item.text) }}><Pencil size={12} /></button><button type="button" aria-label="Move queued input up" disabled={disabled || index === 0 || item.state !== 'queued'} onClick={() => move(index, -1)}><ArrowUp size={12} /></button><button type="button" aria-label="Move queued input down" disabled={disabled || index === items.length - 1 || item.state !== 'queued'} onClick={() => move(index, 1)}><ArrowDown size={12} /></button><button type="button" aria-label={item.state === 'unknown' ? 'Dismiss input with unknown delivery' : 'Return queued input to draft'} title={item.state === 'unknown' ? 'Remove this local record without retrying it' : 'Restore text, attachments and configuration to the composer'} disabled={disabled || item.state === 'sending'} onClick={() => void (item.state === 'unknown' ? onDelete(item.id) : onRestore(item))}><Trash2 size={12} /></button></>}</div>)}
  </section>
}
