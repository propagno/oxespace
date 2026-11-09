import { useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { AnchoredMenu, Button, type MenuEntry } from '../../ui'
import type { ThreadPathResolution, ThreadPathStep, ThreadPlace } from '../../../shared/types/thread-places'
import { useThreadStore } from '../../store/thread.store'
import { useThreadWorkbenchStore } from '../../store/thread-workbench.store'
import { openPlaceFile } from './openPlaceFile'
import { placeApi, relativeToPlace } from './OutsideFileTab'

/** Where a missing path was looked for: the first three steps show, the rest fold into "and N more". */
const FOLD = 3

type Candidate = Extract<ThreadPathResolution, { kind: 'ambiguous' }>['candidates'][number]
type Looked = Extract<ThreadPathResolution, { kind: 'missing' }>['looked']

/** Consecutive steps that looked at the same path read as one line. */
function grouped(looked: Looked): { path: string; steps: ThreadPathStep[] }[] {
  const out: { path: string; steps: ThreadPathStep[] }[] = []
  for (const entry of looked) {
    const last = out.at(-1)
    if (last && last.path === entry.path) last.steps.push(entry.step)
    else out.push({ path: entry.path, steps: [entry.step] })
  }
  return out
}

const withoutLine = (raw: string): string => raw.replace(/:\d+(?::\d+)?$/, '')

/**
 * A16 on screen (DESIGN U4.3): a path the agent named. Activating it asks main where it is (absolute, the turn's cwd,
 * its checkout, the task worktree, the project root, the task's places, sibling worktrees). Found opens it at its
 * line; ambiguous asks which one, each candidate named by its place; missing says where it looked.
 */
export function PathLink({ threadId, raw, turnId }: { threadId: string; raw: string; turnId?: string }): ReactElement {
  const { t } = useTranslation('thread')
  const link = useRef<HTMLAnchorElement>(null)
  const busy = useRef(false)
  const [choices, setChoices] = useState<{ label: string; candidate: Candidate }[] | null>(null)
  const [missing, setMissing] = useState<Looked | null>(null)
  const [failed, setFailed] = useState(false)

  const kindLabel = (place: ThreadPlace | undefined, placeId: string | null): string => {
    if (placeId === null) return t('pathLink.kind.sibling')
    switch (place?.kind) {
      case 'root': return t('pathLink.kind.root')
      case 'worktree': return t('pathLink.kind.worktree')
      case 'checkout': return t('pathLink.kind.checkout')
      case 'outside': return t('pathLink.kind.outside')
      default: return t('pathLink.kind.place')
    }
  }
  const stepLabel = (step: ThreadPathStep): string => {
    switch (step) {
      case 'absolute': return t('pathLink.step.absolute')
      case 'turn-cwd': return t('pathLink.step.turnCwd')
      case 'checkout-root': return t('pathLink.step.checkoutRoot')
      case 'task-worktree': return t('pathLink.step.taskWorktree')
      case 'project-root': return t('pathLink.step.projectRoot')
      case 'task-place': return t('pathLink.step.taskPlace')
      default: return t('pathLink.step.siblingWorktree')
    }
  }
  const candidateLabel = (places: ThreadPlace[], candidate: Candidate): string => {
    const place = candidate.placeId === null ? undefined : places.find(entry => entry.id === candidate.placeId)
    const path = (place && relativeToPlace(place.path, candidate.path)) ?? withoutLine(raw)
    const label = candidate.via === 'sibling-worktree' ? t('pathLink.kind.sibling') : kindLabel(place, candidate.placeId)
    return t('pathLink.candidate', { place: label, path })
  }

  const activate = async (): Promise<void> => {
    if (busy.current) return
    busy.current = true
    setChoices(null); setMissing(null); setFailed(false)
    try {
      const api = placeApi()
      if (!api?.resolvePath) throw new Error('thread.place.unavailable')
      const result = await api.resolvePath(threadId, raw, turnId ? { turnId } : {})
      if (result.kind === 'found') {
        await openPlaceFile({ threadId, path: result.path, placeId: result.placeId, ...(result.line !== undefined ? { line: result.line } : {}) })
        return
      }
      if (result.kind === 'missing') { setMissing(result.looked); return }
      const places = (api.places ? await api.places(threadId).catch(() => null) : null)?.places ?? []
      setChoices(result.candidates.map(candidate => ({ candidate, label: candidateLabel(places, candidate) })))
    } catch {
      setFailed(true)
    } finally {
      busy.current = false
    }
  }

  const findFile = (): void => { useThreadWorkbenchStore.getState().setView(threadId, { panel: 'search' }) }
  const askAgent = (): void => {
    const store = useThreadStore.getState()
    const draft = store.drafts[threadId] ?? ''
    store.setDraft(threadId, `${draft ? `${draft}\n` : ''}${t('pathLink.askDraft', { path: withoutLine(raw) })}`)
  }
  const items: MenuEntry[] = (choices ?? []).map(({ label, candidate }) => ({
    label,
    onSelect: () => { setChoices(null); void openPlaceFile({ threadId, path: candidate.path, placeId: candidate.placeId }) }
  }))

  return <span className="thread-path-link">
    <a ref={link} href="#" className="path-link"
      onClick={event => { event.preventDefault(); void activate() }}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void activate() } }}>
      <code>{raw}</code>
    </a>
    {choices && <AnchoredMenu open onOpenChange={open => { if (!open) setChoices(null) }} label={t('pathLink.which')} items={items} returnFocus={() => link.current} />}
    {missing && <span className="thread-path-missing" role="status">
      <span>{t('pathLink.missing', { path: raw })}</span>
      {grouped(missing.slice(0, FOLD)).map(entry => <span key={entry.path} className="thread-path-looked">{t('pathLink.lookedAt', { path: entry.path, step: entry.steps.map(stepLabel).join(', ') })}</span>)}
      {missing.length > FOLD && <span>{t('pathLink.more', { count: missing.length - FOLD })}</span>}
      <Button size="sm" variant="ghost" onClick={findFile}>{t('pathLink.findFile')}</Button>
      <Button size="sm" variant="ghost" onClick={askAgent}>{t('pathLink.askAgent')}</Button>
    </span>}
    {failed && <span className="thread-path-missing" role="status">{t('pathLink.failed', { path: raw })}</span>}
  </span>
}
