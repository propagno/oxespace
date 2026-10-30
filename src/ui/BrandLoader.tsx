import type { CSSProperties, ReactElement } from 'react'
import { MARK_ARM_LEFT, MARK_ARM_LEFT_ORIGIN, MARK_ARM_RIGHT, MARK_ARM_RIGHT_ORIGIN, MARK_STROKE, MARK_SUN, MARK_TRUNK, MARK_VIEWBOX } from '../design/brand'
import { i18n } from '../i18n'
import styles from './BrandLoader.module.css'

/**
 * The brand's loader: the mandacaru's arms sprout from the trunk in turn while the sun breathes (docs/design/motion.md).
 * For waits longer than a moment (a whole view, the boot splash, reconnecting); a control or a row uses Spinner.
 * With reduced motion the cactus stands still, fully grown.
 */
export function BrandLoader({ label = i18n.t('ui.loading'), size = 40, decorative = false }: { label?: string; size?: number; decorative?: boolean }): ReactElement {
  return <span className={styles.loader} {...(decorative ? { 'aria-hidden': true } : { role: 'status', 'aria-label': label })} data-brand-loader="">
    <svg width={size} height={size} viewBox={MARK_VIEWBOX} fill="none" aria-hidden="true">
      <g stroke="currentColor" strokeWidth={MARK_STROKE} strokeLinecap="round" strokeLinejoin="round">
        <path d={MARK_TRUNK} />
        <path className={styles.arm} style={{ transformOrigin: MARK_ARM_LEFT_ORIGIN } as CSSProperties} d={MARK_ARM_LEFT} />
        <path className={styles.arm} style={{ transformOrigin: MARK_ARM_RIGHT_ORIGIN, animationDelay: 'calc(var(--duration-pulse) / -2)' } as CSSProperties} d={MARK_ARM_RIGHT} />
      </g>
      <circle className={styles.sun} cx={MARK_SUN.cx} cy={MARK_SUN.cy} r={MARK_SUN.r} />
    </svg>
  </span>
}

/** The mark standing still, in the muted text color with its sun: what a full-page message (a crash, offline) carries. */
export function BrandMark({ size = 40 }: { size?: number }): ReactElement {
  return <svg className={styles.still} width={size} height={size} viewBox={MARK_VIEWBOX} fill="none" aria-hidden="true">
    <g stroke="currentColor" strokeWidth={MARK_STROKE} strokeLinecap="round" strokeLinejoin="round"><path d={MARK_TRUNK} /><path d={MARK_ARM_LEFT} /><path d={MARK_ARM_RIGHT} /></g>
    <circle className={styles.stillSun} cx={MARK_SUN.cx} cy={MARK_SUN.cy} r={MARK_SUN.r} />
  </svg>
}
