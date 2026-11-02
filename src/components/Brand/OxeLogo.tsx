import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { MARK_ARM_LEFT, MARK_ARM_RIGHT, MARK_ON_TILE, MARK_STROKE, MARK_SUN, MARK_TRUNK, MARK_VIEWBOX, TILE_RADIUS, TILE_SUN } from '../../design/brand'
import styles from './OxeLogo.module.css'

interface OxeLogoProps {
  size?: number
  variant?: 'full' | 'compact' | 'wordmark' | 'hero'
}

/**
 * The OXESpace mark: a mandacaru drawn as one branching stroke (a task that
 * splits into agents) with the sertão sun beside it.
 *
 * variant="full"     — white cactus on the caatinga tile (app icon, title bar)
 * variant="compact"  — cactus in the current text color, no tile
 * variant="wordmark" — compact mark + "oxespace"
 * variant="hero"     — tile + wordmark + tagline, for empty states
 */
export function OxeLogo({ size = 28, variant = 'full' }: OxeLogoProps): ReactElement {
  const { t } = useTranslation()
  if (variant === 'wordmark') {
    return <span className={styles.wordmark} aria-label="OXESpace">
      <OxeMark size={size} tile={false} />
      <span className={styles.word} style={{ fontSize: Math.round(size * 0.72) }}>oxespace</span>
    </span>
  }
  if (variant === 'hero') {
    return <span className={styles.hero} aria-label="OXESpace">
      <OxeMark size={size} tile />
      <span className={styles.word} style={{ fontSize: Math.round(size * 0.46) }}>oxespace</span>
      <span className={styles.tagline}>{t('brand.tagline')}</span>
    </span>
  }
  return <OxeMark size={size} tile={variant === 'full'} />
}

export function OxeMark({ size, tile }: { size: number; tile: boolean }): ReactElement {
  // Drawn on a 44-unit grid; the stroke is 1/11 of the size. The sun drops below 20px.
  return <svg className={styles.mark} width={size} height={size} viewBox={MARK_VIEWBOX} fill="none" aria-hidden="true">
    {tile && <rect className={styles.tile} width="44" height="44" rx={TILE_RADIUS} />}
    <g transform={tile ? MARK_ON_TILE : undefined} className={tile ? styles.onTile : styles.inline} strokeWidth={MARK_STROKE} strokeLinecap="round" strokeLinejoin="round">
      <path d={MARK_TRUNK} />
      <path d={MARK_ARM_LEFT} />
      <path d={MARK_ARM_RIGHT} />
    </g>
    {size >= 20 && <circle {...(tile ? TILE_SUN : MARK_SUN)} className={styles.sun} />}
  </svg>
}
