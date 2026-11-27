import type { ReactElement } from 'react'
import { MARK_PATH, MARK_VIEWBOX } from '../design/brand'
import { i18n } from '../i18n'
import styles from './BrandLoader.module.css'

/**
 * Quiet Obsidian Minimal circular arc spinner for view-level waits (a whole view, reconnecting).
 * Uses the global `oxe-spin` keyframe, slowing smoothly under `data-motion="reduce"`.
 */
export function BrandLoader({ label = i18n.t('ui.loading'), size = 40, decorative = false }: { label?: string; size?: number; decorative?: boolean }): ReactElement {
  return <span className={styles.loader} {...(decorative ? { 'aria-hidden': true } : { role: 'status', 'aria-label': label })} data-brand-loader="">
    <svg className={styles.spinner} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <circle className={styles.track} cx="12" cy="12" r="9" />
      <path className={styles.arc} d="M12 3a9 9 0 0 1 9 9" />
    </svg>
  </span>
}

/** Static monochrome Mandacaru Ramo mark in quiet ink, for full-page empty, offline, and crash states. */
export function BrandMark({ size = 40 }: { size?: number }): ReactElement {
  return <svg className={styles.still} width={size} height={size} viewBox={MARK_VIEWBOX} fill="currentColor" aria-hidden="true">
    <path d={MARK_PATH} />
  </svg>
}
