import { cx } from '../../ui'
import { describeAttention, useAttentionSummary, type AttentionCounts } from '../../hooks/useAttentionSummary'
import type { NavigationMode } from './NavigationChrome'
import styles from './ModeSwitch.module.css'

const MODES: Array<{ mode: NavigationMode; label: string; title: string }> = [
  { mode: 'code', label: 'Code', title: 'Code: terminals and agents in your workspaces' },
  { mode: 'thread', label: 'Thread', title: 'Thread: conversations with an agent' },
  { mode: 'data', label: 'OxeQuery', title: 'OxeQuery: containers and databases' }
]

/** The application's three views, as one segmented control in the middle of the title bar. */
export function ModeSwitch({ mode, onSelect }: { mode: NavigationMode; onSelect: (mode: NavigationMode) => void }) {
  const attention = useAttentionSummary()
  return <nav className={styles.switch} aria-label="Application view">
    {MODES.map(item => {
      const counts = item.mode === 'code' ? attention.code : item.mode === 'thread' ? attention.thread : null
      // An explicit name, so a badge inside does not change what the button is called.
      return <button key={item.mode} type="button" className={styles.option} aria-label={item.label} aria-pressed={mode === item.mode} title={item.title}
        onClick={() => { if (item.mode !== mode) onSelect(item.mode) }}>
        {item.label}
        {counts && counts.needsYou + counts.failed + counts.working > 0 && <Attention counts={counts} />}
      </button>
    })}
  </nav>
}

function Attention({ counts }: { counts: AttentionCounts }) {
  const total = counts.needsYou + counts.failed
  if (total === 0) return <span className={styles.working} role="status" aria-label={describeAttention(counts)} data-testid="working-indicator" />
  return <span className={cx(styles.badge, counts.needsYou === 0 && styles.badgeFailed)} role="status" aria-label={describeAttention(counts)} data-testid="attention-badge">{total > 9 ? '9+' : total}</span>
}
