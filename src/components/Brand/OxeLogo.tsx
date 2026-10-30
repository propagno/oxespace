import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import styles from './OxeLogo.module.css'

interface OxeLogoProps {
  size?: number
  variant?: 'full' | 'compact' | 'wordmark' | 'hero'
}

/** App-icon colors: caatinga green tile, white cactus, sertão sun (docs/design/brand.md). */
const TILE = '#1f6b4a'
const SUN = '#e8a33d'

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
  const stroke = tile ? '#ffffff' : 'currentColor'
  return <svg className={styles.mark} width={size} height={size} viewBox="0 0 44 44" fill="none" aria-hidden="true">
    {tile && <rect width="44" height="44" rx="11" fill={TILE} />}
    <g transform={tile ? 'translate(4.4 4.4) scale(0.8)' : undefined} stroke={stroke} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 39V8" />
      <path d="M22 27h-6a4 4 0 0 1-4-4v-7" />
      <path d="M22 21h6a4 4 0 0 0 4-4v-6" />
    </g>
    {size >= 20 && <circle cx={tile ? 12.4 : 10} cy={tile ? 11.2 : 8.5} r={tile ? 2.8 : 3.4} fill={SUN} />}
  </svg>
}
