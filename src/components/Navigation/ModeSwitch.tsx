import { useTranslation } from 'react-i18next'
import { cx } from '../../ui'
import { describeAttention, useAttentionSummary, type AttentionCounts } from '../../hooks/useAttentionSummary'
import type { NavigationMode } from './NavigationChrome'
import styles from './ModeSwitch.module.css'

// Product names, never translated.
const MODES: Array<{ mode: NavigationMode; label: string }> = [
  { mode: 'code', label: 'Code' },
  { mode: 'thread', label: 'Thread' },
  { mode: 'data', label: 'OxeQuery' }
]

/** The application's three views, as one segmented control in the middle of the title bar. */
export function ModeSwitch({ mode, onSelect }: { mode: NavigationMode; onSelect: (mode: NavigationMode) => void }) {
  const { t } = useTranslation()
  const attention = useAttentionSummary()
  return <nav className={styles.switch} aria-label={t('nav.applicationView')}>
    {MODES.map(item => {
      const counts = item.mode === 'code' ? attention.code : item.mode === 'thread' ? attention.thread : null
      const attentionId = counts && counts.needsYou + counts.failed + counts.working > 0 ? `mode-attention-${item.mode}` : undefined
      // The badge sits beside the button, not inside it: its count would otherwise be visible text missing from
      // the button's name (WCAG 2.5.3). It describes the button instead, so focus reads "Thread … 1 needs you".
      return <span key={item.mode} className={styles.item}>
        <button type="button" className={styles.option} aria-label={item.label} aria-pressed={mode === item.mode} title={t(`nav.modeTitle.${item.mode}`)} aria-describedby={attentionId}
          onClick={() => { if (item.mode !== mode) onSelect(item.mode) }}>
          {item.label}
        </button>
        {counts && attentionId && <Attention id={attentionId} counts={counts} />}
      </span>
    })}
  </nav>
}

function Attention({ id, counts }: { id: string; counts: AttentionCounts }) {
  const total = counts.needsYou + counts.failed
  if (total === 0) return <span id={id} className={styles.working} role="status" aria-label={describeAttention(counts)} data-testid="working-indicator" />
  return <span id={id} className={cx(styles.badge, counts.needsYou === 0 && styles.badgeFailed)} role="status" aria-label={describeAttention(counts)} data-testid="attention-badge">{total > 9 ? '9+' : total}</span>
}
