import { useEffect, useState } from 'react'
import type { SemanticStatus } from '../../../shared/types/ipc'
import { useTranslation } from 'react-i18next'
import { Checkbox, ErrorState } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'
import { formatNumber } from '../../utils/formatTime'

/**
 * Semantic search for a Thread project: off unless the person turns it on here. With it on, the project's files are
 * indexed locally and agents can search them by meaning (oxespace_semantic_search, oxespace_hybrid_explore).
 */
export function ThreadProjectSemantic({ rootPath, disabled }: { rootPath: string; disabled?: boolean }) {
  const { t } = useTranslation('thread')
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
    // The switch moves at once; it moves back if the change could not be saved.
    const before = state
    setBusy(true); setError('')
    setState(current => current && { ...current, on: enabled })
    try { setState(await api.setProjectEnabled({ rootPath, enabled })) }
    catch (cause) { setState(before); setError(humanizeError(cause, t('semantic.failed'))) }
    finally { setBusy(false) }
  }
  const files = state?.status.coverage?.lexicalDocuments ?? 0
  return <div className="thread-create-section"><strong>{t('semantic.title')}</strong>
    <Checkbox className="thread-project-check" checked={state?.on ?? false} disabled={!state || busy || disabled}
      onChange={event => void toggle(event.target.checked)} label={t('semantic.toggle')} />
    <p>{t('semantic.hint')}</p>
    {state?.on && <p role="status">{!state.status.enabled ? t('semantic.starting') : state.status.indexing ? t('semantic.indexing', { files: formatNumber(files) }) : t('semantic.indexed', { files: formatNumber(files) })}</p>}
    {error && <ErrorState compact title={error} />}
  </div>
}
