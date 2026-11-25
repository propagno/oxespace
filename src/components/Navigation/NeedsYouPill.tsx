import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { chunk, lazyFrom } from '../../lib/chunk'
import { connectAttentionFeed } from '../../store/activity.feed'
import { useActivityStore } from '../../store/activity.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { cx } from '../../ui'
import { pendingCount, useAgentsOverview, withWaitingPanes } from './needsYouModel'
import styles from './TitleBar.module.css'

connectAttentionFeed()

const QUEUE_CHUNK = chunk(() => import('./NeedsYouQueue'))
const NeedsYouQueue = lazyFrom(QUEUE_CHUNK, module => module.NeedsYouQueue)
const preloadQueue = (): void => { void QUEUE_CHUNK.load().catch(() => undefined) }

/**
 * Title-bar needs-you pill (BRD-09, BRD-10): there only while something waits on a person. Its number is the queue's
 * pending rows (OXE-176): every answerable request of main's agents overview plus every waiting terminal (the overview's
 * pane rows, with the panes main's agent-state broadcast reports as waiting, one row per pane). A click opens the
 * needs-you queue in place (NeedsYouQueue); Esc there brings the focus back here. With nothing waiting it is not drawn:
 * an invisible slot as wide as the pill holds its place, so the command field beside it never moves.
 */
export function NeedsYouPill(): ReactElement {
  const { t } = useTranslation()
  const overview = useAgentsOverview()
  const liveCode = useActivityStore(state => state.live.code)
  const waiting = useActivityStore(state => state.waiting.code)
  const workspaces = useWorkspaceStore(state => state.workspaces)
  const agents = useMemo(() => withWaitingPanes(overview, liveCode, waiting, workspaces), [overview, liveCode, waiting, workspaces])
  const count = pendingCount(agents)
  const [open, setOpen] = useState(false)
  const pill = useRef<HTMLButtonElement>(null)
  const hasPending = count > 0
  useEffect(() => { if (hasPending) preloadQueue() }, [hasPending])
  useEffect(() => { if (count === 0 && open) setOpen(false) }, [count, open])
  const close = useCallback((restore: boolean) => {
    if (restore) pill.current?.focus()
    setOpen(false)
  }, [])
  if (count === 0) {
    return (
      <span className={cx(styles.needs, styles.needsSlot)} aria-hidden="true">
        <span className={styles.sun} />
        <span>{t('attention.needsYou', { count: 1 })}</span>
      </span>
    )
  }
  return (
    <>
      <button
        ref={pill}
        type="button"
        className={styles.needs}
        title={t('attention.approvalsWaiting')}
        data-testid="needs-you-pill"
        aria-haspopup="dialog"
        aria-expanded={open}
        onPointerEnter={preloadQueue}
        onFocus={preloadQueue}
        onClick={() => setOpen(value => !value)}
      >
        <span className={styles.sun} aria-hidden="true" />
        <span>{t('attention.needsYou', { count })}</span>
      </button>
      {open && <Suspense fallback={null}><NeedsYouQueue agents={agents} anchor={pill} onClose={close} /></Suspense>}
    </>
  )
}
