import { useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import type { ConversationThread, ThreadEvent } from '../../../shared/types/thread'

export function ThreadModelPicker({ event, thread, pending, onSelect }: {
  event: Extract<ThreadEvent, { type: 'model-picker' }>; thread: ConversationThread; pending: boolean
  onSelect: (command: string) => Promise<void>
}) {
  const [modelId, setModelId] = useState(event.selectedModel || thread.model || '')
  const model = event.models.find(value => value.id === modelId)
  const [effort, setEffort] = useState(event.selectedEffort || thread.reasoningEffort || '')
  const selectedEffort = model?.efforts.includes(effort) ? effort : model?.defaultEffort || model?.efforts[0] || ''
  const [applied, setApplied] = useState(false)
  const confirmed = applied && thread.status === 'idle' && thread.model === model?.id && (thread.provider !== 'codex' || !selectedEffort || thread.reasoningEffort === selectedEffort)
  return <section className="thread-model-picker" aria-label="Choose model">
    <header><strong>Choose model</strong><span>{thread.provider === 'codex' ? 'Codex' : 'Claude'}</span></header>
    <p>Choose the model for this conversation.</p>
    {event.models.length ? <form onSubmit={e => { e.preventDefault(); if (model) void onSelect(`/model ${model.id}${thread.provider === 'codex' && selectedEffort ? ` ${selectedEffort}` : ''}`).then(() => setApplied(true)).catch(() => {}) }}>
      <label>Model<div className="thread-model-select"><select aria-label="Model" value={model?.id ?? ''} disabled={pending} onChange={e => { setModelId(e.target.value); setEffort(''); setApplied(false) }}><option value="" disabled>Select a model</option>{event.models.map(value => <option key={value.id} value={value.id}>{value.label}</option>)}</select><ChevronDown size={14} /></div></label>
      {model?.description && <p className="thread-model-description">{model.description}</p>}
      {model && model.efforts.length > 0 && <label>Reasoning effort<div className="thread-model-select"><select aria-label="Reasoning effort" value={selectedEffort} disabled={pending} onChange={e => { setEffort(e.target.value); setApplied(false) }}>{model.efforts.map(value => <option key={value} value={value}>{value}</option>)}</select><ChevronDown size={14} /></div></label>}
      <footer>{confirmed && <span role="status"><Check size={13} />Model selected</span>}<button type="submit" disabled={!model || pending || confirmed}>Use model</button></footer>
    </form> : <p>No models returned by the CLI. Reopen /model after checking your connection.</p>}
  </section>
}
