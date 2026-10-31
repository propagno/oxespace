import { useTranslation } from 'react-i18next'
import { cx } from '../../ui'
import { describeAttention, useAttentionSummary, type AttentionCounts } from '../../hooks/useAttentionSummary'
import type { NavigationMode } from './NavigationChrome'
import { shortcutLabel, useKeybindings, type KeybindingId } from '../../keyboard/keybindings'
import styles from './ModeSwitch.module.css'

// Product names, never translated.
const MODES: Array<{ mode: NavigationMode; label: string }> = [
  { mode: 'code', label: 'OxeCode' },
  { mode: 'thread', label: 'OxeChat' },
  { mode: 'data', label: 'OxeQuery' },
  { mode: 'pods', label: 'OxePod' },
  { mode: 'post', label: 'OxePost' }
]

/** The application's four views, as one segmented control in the middle of the title bar; Ctrl+1…4 switch between them. */
export function ModeSwitch({ mode, onSelect }: { mode: NavigationMode; onSelect: (mode: NavigationMode) => void }) {
  const { t } = useTranslation()
  const attention = useAttentionSummary()
  const go = (next: NavigationMode) => () => { if (next !== mode) onSelect(next) }
  useKeybindings({ 'view.code': go('code'), 'view.thread': go('thread'), 'view.data': go('data'), 'view.pods': go('pods'), 'view.post': go('post') })
  return <nav className={styles.switch} aria-label={t('nav.applicationView')}>
    {MODES.map(item => {
      const counts = item.mode === 'code' ? attention.code : item.mode === 'thread' ? attention.thread : null
      const attentionId = counts && counts.needsYou + counts.failed + counts.working > 0 ? `mode-attention-${item.mode}` : undefined
      // The badge sits beside the button, not inside it: its count would otherwise be visible text missing from
      // the button's name (WCAG 2.5.3). It describes the button instead, so focus reads "OxeChat … 1 needs you".
      return <span key={item.mode} className={styles.item}>
        <button type="button" className={styles.option} aria-label={item.label} data-app-mode={item.mode} aria-pressed={mode === item.mode} title={withKey(t(`nav.modeTitle.${item.mode}`), item.mode)} aria-describedby={attentionId}
          onClick={() => { if (item.mode !== mode) onSelect(item.mode) }}>
          {item.label}
        </button>
        {counts && attentionId && <Attention id={attentionId} counts={counts} />}
      </span>
    })}
  </nav>
}

const withKey = (title: string, mode: NavigationMode): string => { const key = shortcutLabel(`view.${mode}` as KeybindingId); return key ? `${title} (${key})` : title }

function Attention({ id, counts }: { id: string; counts: AttentionCounts }) {
  const total = counts.needsYou + counts.failed
  if (total === 0) return <span id={id} className={styles.working} role="status" aria-label={describeAttention(counts)} data-testid="working-indicator" />
  return <span id={id} className={cx(styles.badge, counts.needsYou === 0 && styles.badgeFailed)} role="status" aria-label={describeAttention(counts)} data-testid="attention-badge">{total > 9 ? '9+' : total}</span>
}
