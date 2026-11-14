import type { ReactElement } from 'react'
import { cx } from './cx'
import styles from './StatusSignal.module.css'

/**
 * The seven state signals of Mandacaru Noite (docs/design/brand.md › Icons and signals): the same shape for the same
 * state everywhere (sidebar, pane header, phone, notifications). Shape carries the meaning, so it reads without color
 * (forced colors, color blindness); color only confirms it.
 *
 * needs-you    full sun with a ring (--attn): the only place the sun appears
 * working      a caatinga arc that turns (slower, not frozen, with reduced motion)
 * failed       a disc with an exclamation mark
 * done         a caatinga disc with a check
 * waiting      a neutral ring: stopped, waiting for input
 * interrupted  a ring with a square: stopped by someone
 * unconfirmed  a dashed ring: state not known yet (reconnecting, not reported)
 */
export const SIGNAL_STATES = ['needs-you', 'working', 'failed', 'done', 'waiting', 'interrupted', 'unconfirmed'] as const
export type SignalState = typeof SIGNAL_STATES[number]

export function StatusSignal({ state, label, size = 16, className }: { state: SignalState; label: string; size?: number; className?: string }): ReactElement {
  return <svg
    className={cx(styles.signal, styles[state], className)}
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    role="img"
    aria-label={label}
    data-ui="status-signal"
    data-state={state}
  >
    <title>{label}</title>
    {SHAPES[state]}
  </svg>
}

const SHAPES: Record<SignalState, ReactElement> = {
  'needs-you': <><circle className={styles.fill} cx="8" cy="8" r="4.5" /><circle className={styles.ring} cx="8" cy="8" r="6.75" /></>,
  working: <path className={cx(styles.arc, styles.spin)} d="M8 2.5a5.5 5.5 0 1 1-5.5 5.5" />,
  failed: <><circle className={styles.fill} cx="8" cy="8" r="5.5" /><path className={styles.mark} d="M8 5.25v3.25M8 10.75v.01" /></>,
  done: <><circle className={styles.fill} cx="8" cy="8" r="5.5" /><path className={styles.mark} d="M5.75 8.1l1.5 1.5 3-3" /></>,
  waiting: <circle className={styles.ring} cx="8" cy="8" r="5" />,
  interrupted: <><circle className={styles.ring} cx="8" cy="8" r="5.5" /><rect className={styles.fill} x="6" y="6" width="4" height="4" rx="0.75" /></>,
  unconfirmed: <circle className={cx(styles.ring, styles.dashed)} cx="8" cy="8" r="5.5" />
}
