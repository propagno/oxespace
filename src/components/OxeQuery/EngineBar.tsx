import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ContainerEngineCandidate } from '../../../shared/types/oxequery'
import { errorMessage, oq } from './client'
import { tq } from './catalog'
import { useOxeQueryStore } from './oxequery.store'
import { Select } from '../../ui/Field'

/** What to tell a person whose containers are not where OxeQuery is looking. Null when nothing needs saying. */
export function engineAdvice(candidates: ContainerEngineCandidate[], shown: number): string | null {
  const selected = candidates.find(entry => entry.selected)
  const elsewhere = candidates.filter(entry => !entry.selected && entry.state === 'ready' && (entry.containers ?? 0) > 0)
  const refused = candidates.filter(entry => !entry.selected && entry.state === 'denied')
  if (shown === 0 && elsewhere.length > 0) {
    return tq('engineBar.elsewhere', { count: elsewhere[0].containers ?? 0, selected: selected?.label ?? tq('engineBar.thisEngine'), other: elsewhere[0].label })
  }
  if (refused.length > 0 && (shown === 0 || !selected)) {
    return tq('engineBar.refused', { label: refused[0].label, endpoint: refused[0].endpoint })
  }
  return null
}

/** Which Docker engine OxeQuery is looking at, with a switch when the machine has more than one. */
export function EngineBar({ active, shown }: { active: boolean; shown: number }): ReactElement | null {
  const { t } = useTranslation('oxequery')
  const [candidates, setCandidates] = useState<ContainerEngineCandidate[]>([])
  const [failure, setFailure] = useState('')
  const refresh = useOxeQueryStore(state => state.refreshContainers)

  const load = useCallback(async (): Promise<void> => {
    try { setCandidates(await oq('containers.candidates', {})) } catch { setCandidates([]) }
  }, [])

  // Probing every daemon is not free, so it runs when the page opens and when nothing is listed, not on each refresh.
  useEffect(() => { if (active && shown === 0) void load() }, [active, shown, load])
  useEffect(() => { if (active) void load() }, [active, load])

  if (candidates.length < 2) return null
  const advice = engineAdvice(candidates, shown)
  const choose = async (id: string): Promise<void> => {
    setFailure('')
    try { setCandidates(await oq('containers.useCandidate', { id })); await refresh() } catch (cause) { setFailure(errorMessage(cause)) }
  }
  const selected = candidates.find(entry => entry.selected)
  return <div className="oq-engine-bar">
    <label>{t('engineBar.label')}
      <Select className="oq-select" value={selected?.id ?? ''} onChange={event => void choose(event.target.value)}>
        {candidates.map(entry => <option key={entry.id} value={entry.id} disabled={entry.state === 'not-checked'}>
          {entry.label}{entry.containers !== undefined ? ` (${entry.containers})` : ''}{entry.state === 'ready' ? '' : ` — ${t(`engineBar.state.${entry.state}`)}`}</option>)}
      </Select></label>
    {advice && <p className="oq-hint" role="note">{advice}</p>}
    {failure && <p role="alert" className="oq-error">{failure}</p>}
  </div>
}
