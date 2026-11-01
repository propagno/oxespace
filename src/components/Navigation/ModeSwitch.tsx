import { useTranslation } from 'react-i18next'
import { cx } from '../../ui'
import { describeAttention, useAttentionSummary, type AttentionCounts } from '../../hooks/useAttentionSummary'
import type { NavigationMode } from './NavigationChrome'
import { shortcutLabel, useKeybindings, type KeybindingId } from '../../keyboard/keybindings'
import styles from './ModeSwitch.module.css'
import { prefetchView } from '../../app/viewSwitch'

// Product names, never translated.
const MODES: Array<{ mode: NavigationMode; label: string }> = [
  { mode: 'code', label: 'OxeCode' },
  { mode: 'thread', label: 'OxeChat' },
  { mode: 'data', label: 'OxeQuery' },
  { mode: 'pods', label: 'OxePod' },
  { mode: 'post', label: 'OxePost' }
]

/**
 * The application's views, as one segmented control in the middle of the title bar; Ctrl+1…5 switch between them.
 * `pending`: the view being switched to while it loads. Its button is selected and busy at once (the first feedback),
 * and a view's chunk starts loading as soon as its button is hovered or focused (docs/design/motion.md).
 */
export function ModeSwitch({ mode, pending = null, onSelect }: { mode: NavigationMode; pending?: NavigationMode | null; onSelect: (mode: NavigationMode) => void }) {
  const { t } = useTranslation()
  const attention = useAttentionSummary()
  const shown = pending ?? mode
  const go = (next: NavigationMode) => () => { if (next !== shown) onSelect(next) }
  useKeybindings({ 'view.code': go('code'), 'view.thread': go('thread'), 'view.data': go('data'), 'view.pods': go('pods'), 'view.post': go('post') })
  return <nav className={styles.switch} aria-label={t('nav.applicationView')} data-focus-region="modes">
    {MODES.map(item => {
      const counts = item.mode === 'code' ? attention.code : item.mode === 'thread' ? attention.thread : null
      const attentionId = counts && counts.needsYou + counts.failed + counts.working > 0 ? `mode-attention-${item.mode}` : undefined
      // The badge sits beside the button, not inside it: its count would otherwise be visible text missing from
      // the button's name (WCAG 2.5.3). It describes the button instead, so focus reads "OxeChat … 1 needs you".
      return <span key={item.mode} className={styles.item}>
        <button type="button" className={styles.option} aria-label={item.label} data-app-mode={item.mode} aria-pressed={shown === item.mode} aria-busy={pending === item.mode} title={withKey(t(`nav.modeTitle.${item.mode}`), item.mode)} aria-describedby={attentionId}
          onPointerEnter={() => prefetchView(item.mode)} onFocus={() => prefetchView(item.mode)}
          onClick={() => { if (item.mode !== shown) onSelect(item.mode) }}>
          {item.label}
        </button>
        {counts && attentionId && <Attention id={attentionId} counts={counts} scope={item.mode === 'code' ? 'code' : 'thread'} />}
      </span>
    })}
  </nav>
}

const withKey = (title: string, mode: NavigationMode): string => { const key = shortcutLabel(`view.${mode}` as KeybindingId); return key ? `${title} (${key})` : title }

function Attention({ id, counts, scope }: { id: string; counts: AttentionCounts; scope: 'code' | 'thread' }) {
  const total = counts.needsYou + counts.failed
  const label = describeAttention(counts, scope)
  if (total === 0) return <span id={id} className={styles.working} role="status" aria-label={label} data-testid="working-indicator" />
  return <span id={id} className={cx(styles.badge, counts.needsYou === 0 && styles.badgeFailed)} role="status" aria-label={label} data-testid="attention-badge">{total > 9 ? '9+' : total}</span>
}
