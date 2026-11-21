import { useId, type ReactElement, type ReactNode } from 'react'
import { i18n } from '../i18n'
import { cx } from './cx'
import { toast } from './Toast'
import styles from './Settings.module.css'

/**
 * The title of a Settings page (BRD-06): 20 px in both densities, weight 600, in the display face at the title stretch.
 * Found by [data-ui=settings-page-title], never by its heading level.
 */
export function SettingsPageTitle({ id, children, className }: { id?: string; children: ReactNode; className?: string }): ReactElement {
  return <h2 id={id} data-ui="settings-page-title" className={cx(styles.pageTitle, className)}>{children}</h2>
}

/**
 * One group of settings on a page (U2, X3, BRD-23): the one mould, a raised card (--radius-lg, a subtle border) with a
 * sentence-case title at 14/600, an optional line under it, and its rows. `actions` sits in the header (Send a test,
 * Add, Custom agent) instead of floating in the page. There is no variant.
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
export function SettingRow({ label, description, control, htmlFor, wide = false, children, testId }: {
  label: ReactNode
  description?: ReactNode
  control?: ReactNode
  htmlFor?: string
  wide?: boolean
  /** More of the row under the text and the control: a note, an error, a list the control edits. */
  children?: ReactNode
  /** A test hook on the row itself, for the tests and e2e that read a setting by id. */
  testId?: string
}): ReactElement {
  return <div data-ui="setting-row" data-testid={testId} className={cx(styles.row, wide && styles.wide)}>
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
