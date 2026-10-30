import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ContainerEngineCandidate } from '../../../shared/types/oxequery'
import { errorMessage, oq } from '../OxeQuery/client'
import { tp } from './catalog'
import { useOxePodStore } from './oxepod.store'
import { Select } from '../../ui/Field'
import styles from './OxePod.module.css'

/** What to tell a person whose containers are not where OxePod is looking. Null when nothing needs saying. */
export function engineAdvice(candidates: ContainerEngineCandidate[], shown: number): string | null {
  const selected = candidates.find(entry => entry.selected)
  const elsewhere = candidates.filter(entry => !entry.selected && entry.state === 'ready' && (entry.containers ?? 0) > 0)
  const refused = candidates.filter(entry => !entry.selected && entry.state === 'denied')
  if (shown === 0 && elsewhere.length > 0) {
    return tp('engineBar.elsewhere', { count: elsewhere[0].containers ?? 0, selected: selected?.label ?? tp('engineBar.thisEngine'), other: elsewhere[0].label })
  }
  if (refused.length > 0 && (shown === 0 || !selected)) {
    return tp('engineBar.refused', { label: refused[0].label, endpoint: refused[0].endpoint })
  }
  return null
}

/** Which Docker daemon OxePod is looking at, with a switch when the machine has more than one (contexts, the system socket). */
export function EngineBar({ shown }: { shown: number }): ReactElement | null {
  const { t } = useTranslation('pods')
  const [candidates, setCandidates] = useState<ContainerEngineCandidate[]>([])
  const [failure, setFailure] = useState('')
  const refresh = useOxePodStore(state => state.refresh)

  const load = useCallback(async (): Promise<void> => {
    try { setCandidates(await oq('containers.candidates', {})) } catch { setCandidates([]) }
  }, [])

  // Probing every daemon is not free, so it runs when the sidebar opens and when nothing is listed, not on each refresh.
  useEffect(() => { void load() }, [load])
  useEffect(() => { if (shown === 0) void load() }, [shown, load])

  if (candidates.length < 2) return null
  const advice = engineAdvice(candidates, shown)
  const choose = async (id: string): Promise<void> => {
    setFailure('')
    try { setCandidates(await oq('containers.useCandidate', { id })); await refresh() } catch (cause) { setFailure(errorMessage(cause)) }
  }
  const selected = candidates.find(entry => entry.selected)
  return <div className={styles.engineBar}>
    <Select label={t('engineBar.label')} error={failure || undefined} value={selected?.id ?? ''} onChange={event => void choose(event.target.value)}>
      {candidates.map(entry => <option key={entry.id} value={entry.id} disabled={entry.state === 'not-checked'}>
        {entry.label}{entry.containers !== undefined ? ` (${entry.containers})` : ''}{entry.state === 'ready' ? '' : ` — ${t(`engineBar.state.${entry.state}`)}`}</option>)}
    </Select>
    {advice && <p className={styles.note} role="note">{advice}</p>}
  </div>
}
