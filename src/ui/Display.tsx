import type { CSSProperties, ReactElement, ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, WifiOff } from 'lucide-react'
import { Tabs as RadixTabs } from 'radix-ui'
import { i18n } from '../i18n'
import { BrandLoader, BrandMark } from './BrandLoader'
import { cx } from './cx'
import styles from './Display.module.css'

export type Intent = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent'

/** A short label of state or count. Color only reinforces the text; it never carries the meaning alone. */
export function Badge({ children, intent = 'neutral', className, title }: { children: ReactNode; intent?: Intent; className?: string; title?: string }): ReactElement {
  return <span className={cx(styles.badge, intent !== 'neutral' && styles[intent], className)} title={title}>{children}</span>
}

export type Status = 'idle' | 'running' | 'success' | 'attention' | 'danger'

/** A status dot with an accessible label; running pulses unless motion is reduced. */
export function StatusDot({ status, label }: { status: Status; label: string }): ReactElement {
  return <span className={cx(styles.dot, status !== 'idle' && styles[status])} data-status-dot={status} role="img" aria-label={label} title={label} />
}

export interface PanelProps {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  /** No fill: for panels that sit directly on a surface. */
  flat?: boolean
  className?: string
  bodyClassName?: string
  label?: string
}

/** A bordered region with an optional header row of title and actions. */
export function Panel({ title, actions, children, flat, className, bodyClassName, label }: PanelProps): ReactElement {
  return <section className={cx(styles.panel, flat && styles.flat, className)} aria-label={label}>
    {(title || actions) && <header className={styles.panelHeader}>{title && <h3 className={styles.panelTitle}>{title}</h3>}{actions && <div className={styles.panelActions}>{actions}</div>}</header>}
    <div className={cx(styles.panelBody, bodyClassName)}>{children}</div>
  </section>
}

export function Toolbar({ children, label, className }: { children: ReactNode; label: string; className?: string }): ReactElement {
  return <div role="toolbar" aria-label={label} className={cx(styles.toolbar, className)}>{children}</div>
}
export const ToolbarSpacer = (): ReactElement => <span className={styles.toolbarSpacer} />

/** What a place looks like with nothing in it: what belongs here and how to add the first one. */
export function EmptyState({ icon, title, children, actions, compact = false }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; actions?: ReactNode; /** A quiet one-line message for lists and small panels. */ compact?: boolean }): ReactElement {
  return <div className={cx(styles.empty, compact && styles.emptyCompact)}>
    {icon && <span className={styles.emptyIcon} aria-hidden="true">{icon}</span>}
    <p className={styles.emptyTitle}>{title}</p>
    {children && <p className={styles.emptyText}>{children}</p>}
    {actions && <div className={styles.emptyActions}>{actions}</div>}
  </div>
}

/**
 * Something failed: what, why in words a person can act on (pass it through humanizeError), and how to try again.
 * The technical detail stays folded. Compact is a one-line version for lists and small panels; `brand` puts the mark
 * above a failure that takes a whole view or the window, so it reads as OXESpace speaking, not a broken page.
 */
export function ErrorState({ title, message, detail, onRetry, retryLabel = i18n.t('ui.tryAgain'), actions, compact = false, brand = false, icon, heading, children }: {
  title: ReactNode; message?: ReactNode; detail?: string; onRetry?: () => void; retryLabel?: string; actions?: ReactNode; compact?: boolean; brand?: boolean
  /** What the failure is about (the containers engine, a server), drawn like EmptyState's icon. */
  icon?: ReactNode
  /** How to fix it, when it takes more than Try again: steps or a command, below the message. */
  children?: ReactNode
  /** The title as a heading of this level, when the failure takes the place of a whole view's content. */
  heading?: 2 | 3
}): ReactElement {
  const Title = heading ? (`h${heading}` as const) : 'p'
  return <div className={cx(styles.error, compact && styles.errorCompact)} role="alert">
    {brand && !compact && <BrandMark size={40} />}
    {icon && !brand && !compact && <span className={styles.emptyIcon} aria-hidden="true">{icon}</span>}
    <Title className={styles.errorTitle}>{title}</Title>
    {message && <p className={styles.errorText}>{message}</p>}
    {children && <div className={styles.errorFix}>{children}</div>}
    {detail && <details className={styles.errorDetail}><summary>{i18n.t('ui.details')}</summary><code>{detail}</code></details>}
    {(onRetry || actions) && <div className={styles.errorActions}>
      {onRetry && <button type="button" className={styles.errorRetry} onClick={onRetry}>{retryLabel}</button>}
      {actions}
    </div>}
  </div>
}

/**
 * Something finished well and the person should know before moving on: what was done and, when it helps, what to do
 * next. Announced politely; a toast is enough for a quick confirmation that needs no next step.
 */
export function SuccessState({ title, message, actions, compact = false }: { title: ReactNode; message?: ReactNode; actions?: ReactNode; compact?: boolean }): ReactElement {
  return <div className={cx(styles.successState, compact && styles.successCompact)} role="status">
    <span className={styles.successIcon} aria-hidden="true"><CheckCircle2 size={compact ? 14 : 20} /></span>
    <p className={styles.successTitle}>{title}</p>
    {message && <p className={styles.successText}>{message}</p>}
    {actions && <div className={styles.successActions}>{actions}</div>}
  </div>
}

/**
 * The computer has no network, so this place cannot load or send: what is unavailable, that it comes back by itself,
 * and a way to check again. The full version carries the brand loader, waiting; compact is one line for a panel.
 */
export function OfflineState({ title = i18n.t('ui.offline.title'), message = i18n.t('ui.offline.message'), onRetry, retryLabel = i18n.t('ui.offline.retry'), compact = false }: {
  title?: ReactNode; message?: ReactNode; onRetry?: () => void; retryLabel?: string; compact?: boolean
}): ReactElement {
  return <div className={cx(styles.offline, compact && styles.offlineCompact)} role="status">
    {compact ? <WifiOff size={14} aria-hidden="true" className={styles.offlineIcon} /> : <BrandLoader decorative />}
    <p className={styles.offlineTitle}>{title}</p>
    {message && !compact && <p className={styles.offlineText}>{message}</p>}
    {onRetry && <button type="button" className={styles.errorRetry} onClick={onRetry}>{retryLabel}</button>}
  </div>
}

export type NoticeIntent = 'info' | 'success' | 'warning' | 'danger'
const NOTICE_ICONS = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: AlertTriangle } as const
const NOTICE_STYLES = { info: styles.noticeInfo, success: styles.noticeSuccess, warning: styles.noticeWarning, danger: styles.noticeDanger }

/**
 * A short message inside a form or panel that stays until its cause goes away: a risk to weigh before acting, a
 * setting that could not be applied, an action that failed. Warning and danger are announced at once; info and
 * success politely. For a whole place that failed to load, use ErrorState.
 */
export function Notice({ intent = 'info', title, children, actions, className }: { intent?: NoticeIntent; title?: ReactNode; children?: ReactNode; actions?: ReactNode; className?: string }): ReactElement {
  const Icon = NOTICE_ICONS[intent]
  return <div className={cx(styles.notice, NOTICE_STYLES[intent], className)} role={intent === 'warning' || intent === 'danger' ? 'alert' : 'status'} data-intent={intent}>
    <Icon size={14} aria-hidden="true" className={styles.noticeIcon} />
    <div className={styles.noticeBody}>
      {title && <strong>{title}</strong>}
      {children && <div>{children}</div>}
      {actions && <div className={styles.noticeActions}>{actions}</div>}
    </div>
  </div>
}

/** The shape of content on its way: lines of text, or one block. Announced once as loading, never read line by line. */
export function Skeleton({ lines = 3, variant = 'text', label = i18n.t('ui.loading'), decorative = false }: { lines?: number; variant?: 'text' | 'block'; label?: string; decorative?: boolean }): ReactElement {
  // `decorative`: next to something that already announces the loading (a busy region, a status beside it).
  return <div className={styles.skeleton} data-skeleton="" {...(decorative ? { 'aria-hidden': true as const } : { role: 'status' as const, 'aria-label': label })}>
    {variant === 'block'
      ? <span className={cx(styles.skeletonBar, styles.skeletonBlock)} aria-hidden="true" />
      : Array.from({ length: Math.max(1, lines) }, (_, index) => <span key={index} className={styles.skeletonBar} aria-hidden="true" />)}
  </div>
}

/**
 * A view's sidebar on its way: the sidebar frame (its width comes from the app shell's grid, so nothing moves when the
 * real one arrives), the header with the view's name and placeholder rows. The region is busy and says "Loading…"
 * once, politely (the Skeleton's status); collapsed to the rail it shows a few short bars without the header.
 */
/** Busy (aria-busy) but silent: the view's work area announces the one loading, so a switch is not announced twice. */
export function SidebarSkeleton({ label, title, collapsed = false }: { label: string; title: string; collapsed?: boolean }): ReactElement {
  return <aside className={cx('thread-navigation', collapsed && 'thread-navigation-collapsed')} aria-label={label} aria-busy="true">
    <div className={cx('nav-panel', styles.sidebarRows)}>{!collapsed && <div className="nav-panel-title"><strong>{title}</strong></div>}<Skeleton decorative lines={collapsed ? 3 : 5} /></div>
  </aside>
}

/**
 * A turning ring. With a label it is announced as loading; `decorative` hides it from assistive technology when the
 * text next to it already says what is happening (a "Saving…" button).
 */
export function Spinner({ label = i18n.t('ui.loading'), size = 'md', decorative = false }: { label?: string; size?: 'sm' | 'md'; decorative?: boolean }): ReactElement {
  return decorative
    ? <span className={cx(styles.spinner, size === 'sm' && styles.spinnerSm)} aria-hidden="true" />
    : <span className={cx(styles.spinner, size === 'sm' && styles.spinnerSm)} role="status" aria-label={label} />
}

/**
 * A spinner with a short line of text, for a panel or list whose content is on its way. `brand` is for a whole view
 * that takes a while: the mandacaru loader, centered, above the text.
 */
export function LoadingState({ label = i18n.t('ui.loadingEllipsis'), brand = false }: { label?: string; brand?: boolean }): ReactElement {
  return brand
    ? <div className={styles.loadingBrand} role="status"><BrandLoader decorative /><span>{label}</span></div>
    : <div className={styles.loading} role="status"><span className={styles.spinner} aria-hidden="true" /><span>{label}</span></div>
}

export function Separator({ orientation = 'horizontal' }: { orientation?: 'horizontal' | 'vertical' }): ReactElement {
  return <span className={styles.separator} role="separator" aria-orientation={orientation} data-orientation={orientation} />
}

export interface TabsProps<T extends string> {
  value: T
  onChange: (value: T) => void
  tabs: Array<{ value: T; label: ReactNode; content: ReactNode }>
  label: string
  className?: string
}

/** Tabs with their panels; arrow keys move between tabs. */
export function Tabs<T extends string>({ value, onChange, tabs, label, className }: TabsProps<T>): ReactElement {
  return <RadixTabs.Root value={value} onValueChange={next => onChange(next as T)} className={className}>
    <RadixTabs.List className={styles.tabList} aria-label={label}>
      {tabs.map(tab => <RadixTabs.Trigger key={tab.value} value={tab.value} className={styles.tab}>{tab.label}</RadixTabs.Trigger>)}
    </RadixTabs.List>
    {tabs.map(tab => <RadixTabs.Content key={tab.value} value={tab.value} className={styles.tabPanel}>{tab.content}</RadixTabs.Content>)}
  </RadixTabs.Root>
}

/** A measured amount against a limit, such as context or quota. Turns warning at 75% and danger at 90%. */
export function Meter({ label, value, max = 100, detail }: { label: ReactNode; value: number; max?: number; detail?: ReactNode }): ReactElement {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0
  const tone = ratio >= 0.9 ? styles.danger : ratio >= 0.75 ? styles.warning : undefined
  return <div className={styles.meter}>
    <div className={styles.meterHead}><span>{label}</span><span>{detail ?? `${Math.round(ratio * 100)}%`}</span></div>
    {/* A meter's value stays within its range (ARIA): past the limit it is full, and `detail` says by how much. */}
    <div className={styles.meterTrack} role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(max, Math.max(0, value))} aria-label={typeof label === 'string' ? label : undefined}>
      <div className={cx(styles.meterFill, tone)} style={{ width: `${ratio * 100}%` }} />
    </div>
  </div>
}

/** Initials on an identity color, for agents and providers. */
export function Avatar({ name, color, size = 20 }: { name: string; color?: string; size?: number }): ReactElement {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || '?'
  return <span className={styles.avatar} style={{ width: size, height: size, background: color ?? 'var(--avatar-1)' } as CSSProperties} aria-hidden="true">{initials}</span>
}

export { styles as displayStyles }
