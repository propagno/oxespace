import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import type { Workspace } from '../../../shared/types/workspace'
import type { ConversationThread } from '../../../shared/types/thread'
import { i18n } from '../../i18n'
import { useThreadStore } from '../../store/thread.store'
import { Splitter } from '../../ui'
import { ThreadView } from './ThreadView'
import { SPLIT_RATIO_DEFAULT, SPLIT_RATIO_MAX, SPLIT_RATIO_MIN } from './threadGridLayout'

/** One arrow key moves the side-by-side divider by this many percent. */
const SPLIT_RATIO_STEP = 5

/** View context for reusable file/Git panels; never persisted as a Code workspace. */
function projectView(thread: ConversationThread | undefined, name: string | undefined): Workspace | undefined {
  if (!thread) return undefined
  return { id: `thread:${thread.projectId}`, name: name ?? thread.rootPath.split(/[\\/]/).filter(Boolean).at(-1) ?? i18n.t('thread:common.project'), rootPath: thread.rootPath,
    layout: '1x1', layoutPreset: 1, themeId: 'midnight', uiDensity: 'compact', defaultShellProfileId: '', autoStart: false, isActive: false, color: null, panes: [] }
}

export function ThreadGrid({ onNewThread, onAccounts, onDelegations }: { onNewThread?: () => void; onAccounts?: () => void; onDelegations?: () => void }) {
  const { t } = useTranslation('thread')
  const selectedId = useThreadStore(state => state.selectedId)
  // The conversation on screen: while the next one loads (F7.2) it is still the previous one, which keeps its view
  // mounted (its scroll position, review state and project) until the next one replaces it.
  const shownId = useThreadStore(state => state.snapshot?.thread.id ?? state.selectedId)
  const secondaryId = useThreadStore(state => state.secondaryId)
  const activeCell = useThreadStore(state => state.activeCell)
  const splitRatio = useThreadStore(state => state.splitRatio)
  const setSplitRatio = useThreadStore(state => state.setSplitRatio)
  const threads = useThreadStore(state => state.threads)
  const projects = useThreadStore(state => state.projects)
  const primary = threads.find(thread => thread.id === shownId)
  const secondary = threads.find(thread => thread.id === secondaryId)
  const primaryWorkspace = projectView(primary, projects.find(project => project.projectId === primary?.projectId)?.displayName)
  const secondaryWorkspace = projectView(secondary, projects.find(project => project.projectId === secondary?.projectId)?.displayName)

  // The divider's value is a share of the grid in percent: while dragging, one point is a hundredth of its width.
  const gridRef = useRef<HTMLDivElement>(null)
  const [unit, setUnit] = useState(1)
  const measure = useCallback(() => {
    const width = gridRef.current?.getBoundingClientRect().width ?? 0
    setUnit(width > 0 ? width / 100 : 1)
  }, [])
  const split = Boolean(secondaryId)
  useLayoutEffect(() => { if (split) measure() }, [split, measure])
  useEffect(() => {
    const node = gridRef.current
    if (!split || !node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => measure())
    observer.observe(node)
    return () => observer.disconnect()
  }, [split, measure])

  const style = split ? { '--thread-split': `${splitRatio}%` } as CSSProperties : undefined
  return <div ref={gridRef} className={`thread-grid${split ? ' is-split' : ''}`} style={style} role="group" aria-label={split ? t('grid.split') : t('grid.single')}
      onPointerDownCapture={split ? measure : undefined}>
    <div className={`thread-cell${activeCell === 'primary' ? ' is-active' : ''}`}>
      <ThreadView key={shownId ?? 'empty-primary'} threadId={selectedId} workspace={primaryWorkspace} active={!secondaryId || activeCell === 'primary'} cell={secondaryId ? 'primary' : undefined} onActivate={() => useThreadStore.getState().setActiveCell('primary')} onNewThread={onNewThread} onAccounts={onAccounts} onDelegations={onDelegations} />
    </div>
    {secondaryId && <Splitter className="thread-split-handle" orientation="vertical" label={t('grid.resize')} value={splitRatio} min={SPLIT_RATIO_MIN} max={SPLIT_RATIO_MAX}
      defaultValue={SPLIT_RATIO_DEFAULT} step={SPLIT_RATIO_STEP} unit={unit} onChange={setSplitRatio} />}
    {secondaryId && <div className={`thread-cell${activeCell === 'secondary' ? ' is-active' : ''}`}>
      <ThreadView key={secondaryId} threadId={secondaryId} workspace={secondaryWorkspace} active={activeCell === 'secondary'} cell="secondary" onActivate={() => useThreadStore.getState().setActiveCell('secondary')} onNewThread={onNewThread} onAccounts={onAccounts} onDelegations={onDelegations} />
    </div>}
  </div>
}
