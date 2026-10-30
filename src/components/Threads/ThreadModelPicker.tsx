import { useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ConversationThread, ThreadEvent } from '../../../shared/types/thread'
import { Select } from '../../ui'

export function ThreadModelPicker({ event, thread, pending, onSelect }: {
  event: Extract<ThreadEvent, { type: 'model-picker' }>; thread: ConversationThread; pending: boolean
  onSelect: (command: string) => Promise<void>
}) {
  const { t } = useTranslation('thread')
  const [modelId, setModelId] = useState(event.selectedModel || thread.model || '')
  const model = event.models.find(value => value.id === modelId)
  const [effort, setEffort] = useState(event.selectedEffort || thread.reasoningEffort || '')
  const selectedEffort = model?.efforts.includes(effort) ? effort : model?.defaultEffort || model?.efforts[0] || ''
  const [applied, setApplied] = useState(false)
  const confirmed = applied && thread.status === 'idle' && thread.model === model?.id && (thread.provider !== 'codex' || !selectedEffort || thread.reasoningEffort === selectedEffort)
  return <section className="thread-model-picker" aria-label={t('modelPicker.title')}>
    <header><strong>{t('modelPicker.title')}</strong><span>{thread.provider === 'codex' ? 'Codex' : 'Claude'}</span></header>
    <p>{t('modelPicker.hint')}</p>
    {event.models.length ? <form onSubmit={e => { e.preventDefault(); if (model) void onSelect(`/model ${model.id}${thread.provider === 'codex' && selectedEffort ? ` ${selectedEffort}` : ''}`).then(() => setApplied(true)).catch(() => {}) }}>
      <label>{t('modelPicker.model')}<div className="thread-model-select"><Select aria-label={t('modelPicker.model')} value={model?.id ?? ''} disabled={pending} onChange={e => { setModelId(e.target.value); setEffort(''); setApplied(false) }}><option value="" disabled>{t('modelPicker.placeholder')}</option>{event.models.map(value => <option key={value.id} value={value.id}>{value.label}</option>)}</Select><ChevronDown size={14} /></div></label>
      {model?.description && <p className="thread-model-description">{model.description}</p>}
      {model && model.efforts.length > 0 && <label>{t('modelPicker.effort')}<div className="thread-model-select"><Select aria-label={t('modelPicker.effort')} value={selectedEffort} disabled={pending} onChange={e => { setEffort(e.target.value); setApplied(false) }}>{model.efforts.map(value => <option key={value} value={value}>{value}</option>)}</Select><ChevronDown size={14} /></div></label>}
      <footer>{confirmed && <span role="status"><Check size={14} />{t('modelPicker.selected')}</span>}<button type="submit" disabled={!model || pending || confirmed}>{t('modelPicker.use')}</button></footer>
    </form> : <p>{t('modelPicker.none')}</p>}
  </section>
}
