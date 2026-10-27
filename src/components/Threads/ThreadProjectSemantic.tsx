import { useEffect, useState } from 'react'
import type { SemanticStatus } from '../../../shared/types/ipc'
import { Checkbox } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'

/**
 * Semantic search for a Thread project: off unless the person turns it on here. With it on, the project's files are
 * indexed locally and agents can search them by meaning (oxespace_semantic_search, oxespace_hybrid_explore).
 */
export function ThreadProjectSemantic({ rootPath, disabled }: { rootPath: string; disabled?: boolean }) {
  const api = window.oxe.semantic
  const [state, setState] = useState<{ on: boolean; status: SemanticStatus } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!api?.projectStatus || disabled) return
    let live = true
    api.projectStatus(rootPath).then(next => { if (live) setState(next) }, cause => { if (live) setError(humanizeError(cause)) })
    return () => { live = false }
  }, [api, rootPath, disabled, tick])
  // While the first index is built, the count follows it.
  useEffect(() => {
    if (!state?.on || !state.status.indexing) return
    const timer = setTimeout(() => setTick(value => value + 1), 2000)
    return () => clearTimeout(timer)
  }, [state])
  if (!api?.projectStatus) return null
  const toggle = async (enabled: boolean): Promise<void> => {
    setBusy(true); setError('')
    try { setState(await api.setProjectEnabled({ rootPath, enabled })) }
    catch (cause) { setError(humanizeError(cause, 'Could not change semantic search.')) }
    finally { setBusy(false) }
  }
  const files = state?.status.coverage?.lexicalDocuments ?? 0
  return <div className="thread-create-section"><strong>Semantic search</strong>
    <Checkbox className="thread-project-check" checked={state?.on ?? false} disabled={!state || busy || disabled}
      onChange={event => void toggle(event.target.checked)} label="Index this project so agents can search it by meaning" />
    <p>The index stays on this computer. Agents still read the files they need; this only helps them find them.</p>
    {state?.on && <p role="status">{state.status.indexing ? `Indexing… ${files.toLocaleString('en-US')} files so far` : `${files.toLocaleString('en-US')} files indexed`}</p>}
    {error && <p role="alert">{error}</p>}
  </div>
}
