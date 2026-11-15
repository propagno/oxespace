import { useRef, type KeyboardEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { cx } from '../../ui'
import { displayStyles } from '../../ui/Display'
import { describeAttention, useAttentionSummary, type AttentionCounts } from '../../hooks/useAttentionSummary'
import type { NavigationMode } from './NavigationChrome'
import { shortcutLabel, useKeybindings, type KeybindingId } from '../../keyboard/keybindings'
import styles from './ModeSwitch.module.css'
import { prefetchView, usePendingView } from '../../app/viewSwitch'
import { OxeCodeIcon } from '../../design/icons/OxeCodeIcon'
import { OxeChatIcon } from '../../design/icons/OxeChatIcon'
import { OxeQueryIcon } from '../../design/icons/OxeQueryIcon'

// Product names, never translated.
const MODES: Array<{ mode: NavigationMode; label: string; Icon: (props: { size?: number; className?: string }) => ReactElement }> = [
  { mode: 'code', label: 'OxeCode', Icon: OxeCodeIcon },
  { mode: 'thread', label: 'OxeChat', Icon: OxeChatIcon },
  { mode: 'data', label: 'OxeQuery', Icon: OxeQueryIcon }
]

const MOVE_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End'])

/**
 * The application's views as the src/ui Tabs list in the title bar (BRD-09, OXE-72): one [data-ui=tabs] tablist, a tab
 * per view at --bar-md with a 12/500 label, and inside each tab the count of what needs a person in that view.
 * Ctrl+1…3 switch between them; the arrow keys, Home and End move focus along the tabs, Enter or Space opens one.
 * The view being switched to (usePendingView, src/app/viewSwitch.ts): its tab is selected and busy at once (the first
 * feedback), and a view's chunk starts loading as soon as its tab is hovered or focused (docs/design/motion.md).
 */
export function ModeSwitch({ mode, allowReselect, onSelect }: { mode: NavigationMode; allowReselect?: boolean; onSelect: (mode: NavigationMode) => void }) {
  const pending = usePendingView()
  const { t } = useTranslation()
  const attention = useAttentionSummary()
  const listRef = useRef<HTMLDivElement>(null)
  const shown = pending ?? mode
  const go = (next: NavigationMode) => () => { if (allowReselect || next !== shown) onSelect(next) }
  useKeybindings({ 'view.code': go('code'), 'view.thread': go('thread'), 'view.data': go('data') })
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!MOVE_KEYS.has(event.key)) return
    const all = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])]
    if (!all.length) return
    const at = Math.max(0, all.indexOf(document.activeElement as HTMLButtonElement))
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? all.length - 1 : (at + (event.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length
    event.preventDefault()
    all[next]?.focus()
  }
  return <div ref={listRef} role="tablist" data-ui="tabs" className={styles.switch} aria-label={t('nav.applicationView')} data-focus-region="modes" onKeyDown={onKeyDown}>
    {MODES.map(item => {
      const counts = item.mode === 'code' ? attention.code : item.mode === 'thread' ? attention.thread : null
      const attentionId = counts && counts.needsYou + counts.failed + counts.working > 0 ? `mode-attention-${item.mode}` : undefined
      const selected = shown === item.mode
      const ModeIcon = item.Icon
      // The tab is named by the product name, plus its count when one shows ("OxeChat 1"), so the name holds the visible
      // text (axe label-content-name-mismatch); the count's words describe it, so focus reads "OxeChat 1 … 1 needs you".
      const shownCount = counts && counts.needsYou > 0 ? (counts.needsYou > 9 ? '9+' : String(counts.needsYou)) : null
      return <button key={item.mode} type="button" role="tab" className={cx(displayStyles.tab, styles.option)} data-state={selected ? 'active' : 'inactive'}
        aria-selected={selected} tabIndex={selected ? 0 : -1} aria-label={shownCount ? `${item.label} ${shownCount}` : item.label} data-app-mode={item.mode} aria-busy={pending === item.mode}
        title={withKey(t(`nav.modeTitle.${item.mode}`), item.mode)} aria-describedby={attentionId}
        onPointerEnter={() => prefetchView(item.mode)} onFocus={() => prefetchView(item.mode)}
        onClick={() => { if (allowReselect || item.mode !== shown) onSelect(item.mode) }}>
        <ModeIcon size={13} className={styles.modeIcon} aria-hidden="true" />
        <span>{item.label}</span>
        {shownCount ? ' ' : null}
        {counts && attentionId && <Attention id={attentionId} counts={counts} scope={item.mode === 'code' ? 'code' : 'thread'} />}
      </button>
    })}
  </div>
}

const withKey = (title: string, mode: NavigationMode): string => { const key = shortcutLabel(`view.${mode}` as KeybindingId); return key ? `${title} (${key})` : title }

/** The tab's number is what needs you there; a failure alone or busy agents are a dot, never a number. */
function Attention({ id, counts, scope }: { id: string; counts: AttentionCounts; scope: 'code' | 'thread' }) {
  const label = describeAttention(counts, scope)
  if (counts.needsYou > 0) return <span id={id} className={styles.badge} role="status" aria-label={label} aria-hidden="true" data-testid="attention-badge">{counts.needsYou > 9 ? '9+' : counts.needsYou}</span>
  if (counts.failed > 0) return <span id={id} className={cx(styles.working, styles.failed)} role="status" aria-label={label} aria-hidden="true" data-testid="attention-failed" />
  return <span id={id} className={styles.working} role="status" aria-label={label} aria-hidden="true" data-testid="working-indicator" />
}
