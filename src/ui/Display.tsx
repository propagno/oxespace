import type { CSSProperties, ReactElement, ReactNode } from 'react'
import { Tabs as RadixTabs } from 'radix-ui'
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
  return <span className={cx(styles.dot, status !== 'idle' && styles[status])} role="img" aria-label={label} title={label} />
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

export function Spinner({ label = 'Loading' }: { label?: string }): ReactElement {
  return <span className={styles.spinner} role="status" aria-label={label} />
}

/** A spinner with a short line of text, for a panel or list whose content is on its way. */
export function LoadingState({ label = 'Loading…' }: { label?: string }): ReactElement {
  return <div className={styles.loading} role="status"><span className={styles.spinner} aria-hidden="true" /><span>{label}</span></div>
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
    <div className={styles.meterTrack} role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={typeof label === 'string' ? label : undefined}>
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
