import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type { ContainerEngineCandidate } from '../../../shared/types/oxequery'
import { errorMessage, oq } from './client'
import { useOxeQueryStore } from './oxequery.store'
import { Select } from '../../ui/Field'

/** What to tell a person whose containers are not where OxeQuery is looking. Null when nothing needs saying. */
export function engineAdvice(candidates: ContainerEngineCandidate[], shown: number): string | null {
  const selected = candidates.find(entry => entry.selected)
  const elsewhere = candidates.filter(entry => !entry.selected && entry.state === 'ready' && (entry.containers ?? 0) > 0)
  const refused = candidates.filter(entry => !entry.selected && entry.state === 'denied')
  if (shown === 0 && elsewhere.length > 0) {
    return `No containers in “${selected?.label ?? 'this engine'}”, but “${elsewhere[0].label}” has ${elsewhere[0].containers}. Choose it below.`
  }
  if (refused.length > 0 && (shown === 0 || !selected)) {
    return `“${refused[0].label}” is a Docker engine on this computer, but your user is not allowed to use it (${refused[0].endpoint}). Add your user to the docker group and sign in again, or choose another engine.`
  }
  return null
}

const stateLabel: Record<ContainerEngineCandidate['state'], string> = { ready: '', denied: ' — no permission', unreachable: ' — not running', 'not-checked': ' — remote, not used' }

/** Which Docker engine OxeQuery is looking at, with a switch when the machine has more than one. */
export function EngineBar({ active, shown }: { active: boolean; shown: number }): ReactElement | null {
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
    <label>Docker engine
      <Select className="oq-select" value={selected?.id ?? ''} onChange={event => void choose(event.target.value)}>
        {candidates.map(entry => <option key={entry.id} value={entry.id} disabled={entry.state === 'not-checked'}>
          {entry.label}{entry.containers !== undefined ? ` (${entry.containers})` : ''}{stateLabel[entry.state]}</option>)}
      </Select></label>
    {advice && <p className="oq-hint" role="note">{advice}</p>}
    {failure && <p role="alert" className="oq-error">{failure}</p>}
  </div>
}
