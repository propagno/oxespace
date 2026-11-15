import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { MARK_ON_TILE, MARK_PATH, MARK_VIEWBOX, TILE_RADIUS } from '../../design/brand'
import styles from './OxeLogo.module.css'

interface OxeLogoProps {
  size?: number
  variant?: 'full' | 'compact' | 'wordmark' | 'hero'
}

/**
 * The OXESpace mark, Ramo: a mandacaru in five solid columns (a task that
 * splits into agents).
 *
 * variant="full"     — caatinga cactus on the night tile (app icon, title bar)
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
  // Drawn on a 48-unit grid; solid columns hold down to 12px in one color.
  return <svg className={styles.mark} width={size} height={size} viewBox={MARK_VIEWBOX} aria-hidden="true">
    {tile && <rect className={styles.tile} width="48" height="48" rx={TILE_RADIUS} />}
    <path transform={tile ? MARK_ON_TILE : undefined} className={tile ? styles.onTile : styles.inline} d={MARK_PATH} />
  </svg>
}
