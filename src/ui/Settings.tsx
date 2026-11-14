import { useId, type ReactElement, type ReactNode } from 'react'
import { i18n } from '../i18n'
import { cx } from './cx'
import { toast } from './Toast'
import styles from './Settings.module.css'

/**
 * One group of settings on a page (U2, X3): a card with a sentence-case title, an optional line under it, and its
 * rows. `actions` sits in the header (Send a test, Add) instead of floating in the page.
 */
export function SettingsSection({ title, description, actions, children, className }: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}): ReactElement {
  const id = useId()
  return <section data-ui="settings-section" className={cx(styles.section, className)} aria-labelledby={`${id}-title`}>
    <header className={styles.sectionHeader}>
      <div>
        <h3 id={`${id}-title`} className={styles.sectionTitle}>{title}</h3>
        {description ? <p className={styles.sectionDescription}>{description}</p> : null}
      </div>
      {actions ? <div className={styles.sectionActions}>{actions}</div> : null}
    </header>
    <div className={styles.rows}>{children}</div>
  </section>
}

/**
 * One setting (U2): its name and what it does on the left, the control on the right. `wide` puts the control under
 * the text, for a list, a text area or a preview. `htmlFor` names the control by the label; without it the control
 * names itself (a switch or a select with its own label).
 */
export function SettingRow({ label, description, control, htmlFor, wide = false, children }: {
  label: ReactNode
  description?: ReactNode
  control?: ReactNode
  htmlFor?: string
  wide?: boolean
  /** More of the row under the text and the control: a note, an error, a list the control edits. */
  children?: ReactNode
}): ReactElement {
  return <div data-ui="setting-row" className={cx(styles.row, wide && styles.wide)}>
    <div className={styles.text}>
      {htmlFor ? <label htmlFor={htmlFor} className={styles.label}>{label}</label> : <span className={styles.label}>{label}</span>}
      {description ? <p className={styles.description}>{description}</p> : null}
    </div>
    {control ? <div className={styles.control}>{control}</div> : null}
    {children ? <div className={styles.extra}>{children}</div> : null}
  </div>
}

/**
 * Settings apply at once (U2). A change that widens what an agent may do, or that can lose work, says so in a toast
 * with Undo (the risky list in docs/design/plan-1.5-ui.md). An action that can't be undone keeps its confirmation
 * dialog instead. Returns whether the change applied.
 */
export async function applyWithUndo({ apply, undo, done }: {
  apply: () => Promise<unknown>
  undo: () => Promise<unknown>
  /** What changed, as the toast says it: "Default shell is now PowerShell". */
  done: string
}): Promise<boolean> {
  try { await apply() } catch { return false }
  toast({ title: done, intent: 'info', action: { label: i18n.t('ui.undo'), run: () => void undo() } })
  return true
}
