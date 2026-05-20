import { useId, type ReactElement } from 'react'

interface OxeLogoProps {
  size?: number
  variant?: 'full' | 'compact' | 'wordmark' | 'hero'
}

/**
 * OXESpace mark — a 270° orbital arc with an agent node.
 *
 * Concept: an AI agent (node) orbiting a terminal workspace.
 * The arc opens at the bottom-right, suggesting forward motion.
 *
 * variant="full"     — arc on dark rounded-square background (app icon, collapsed sidebar)
 * variant="compact"  — arc on transparent background (inline use on dark surfaces)
 * variant="wordmark" — logo + "OXESpace" text inline, for sidebar header / about / settings
 * variant="hero"     — large logo + wordmark stacked, used in empty-states and splash
 */
export function OxeLogo({ size = 28, variant = 'full' }: OxeLogoProps): ReactElement {
  if (variant === 'wordmark') {
    return (
      <span className="oxe-wordmark" aria-label="OXESpace">
        <OxeLogo size={size} variant="compact" />
        <span className="oxe-wordmark-text" style={{ fontSize: `${Math.round(size * 0.62)}px` }}>
          <span className="oxe-wordmark-strong">OXE</span>Space
        </span>
      </span>
    )
  }

  if (variant === 'hero') {
    return (
      <span className="oxe-hero" aria-label="OXESpace">
        <OxeLogo size={size} variant="full" />
        <span className="oxe-hero-text" style={{ fontSize: `${Math.round(size * 0.45)}px` }}>
          <span className="oxe-wordmark-strong">OXE</span>Space
        </span>
        <span className="oxe-hero-tagline">Agentic Terminal Workspace</span>
      </span>
    )
  }

  return <OxeMark size={size} variant={variant} />
}

function OxeMark({ size, variant }: { size: number; variant: 'full' | 'compact' }): ReactElement {
  const uid = useId()

  const cx = size / 2
  const cy = size / 2
  const arcR = size * 0.32
  const f = 0.7071 // cos/sin 45°

  // Arc endpoints
  // Start: bottom-left  (225° in standard coords → SVG bottom-left)
  const sx = cx - arcR * f
  const sy = cy + arcR * f
  // End: top-right (315° in standard coords → SVG top-right)
  const ex = cx + arcR * f
  const ey = cy - arcR * f

  const sw = Math.max(1.4, size * 0.051)
  const nodeR = Math.max(1.4, size * 0.087)
  const coreR = Math.max(0.7, size * 0.046)

  // M startX startY A r r 0 large-arc sweep endX endY
  // large-arc=1, sweep=1 (clockwise) → 270° arc through left/top, gap at bottom-right
  const arcPath = `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${arcR.toFixed(2)} ${arcR.toFixed(2)} 0 1 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`

  const arcGradId = `${uid}-arc`
  const bgGradId  = `${uid}-bg`
  const ambGradId = `${uid}-amb`

  if (variant === 'compact') {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" aria-hidden="true">
        <defs>
          <linearGradient id={arcGradId} x1={sx} y1={sy} x2={ex} y2={ey} gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#12C79A"/>
            <stop offset="100%" stopColor="#38BDF8"/>
          </linearGradient>
        </defs>
        <path d={arcPath} stroke={`url(#${arcGradId})`} strokeWidth={sw} fill="none" strokeLinecap="round"/>
        <circle cx={ex} cy={ey} r={nodeR} fill="#38BDF8"/>
        <circle cx={ex} cy={ey} r={coreR} fill="white"/>
      </svg>
    )
  }

  const rx = size * 0.22

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id={bgGradId} x1="0" y1="0" x2={size} y2={size} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0E1F30"/>
          <stop offset="100%" stopColor="#070F1A"/>
        </linearGradient>
        <radialGradient id={ambGradId} cx={cx} cy={cy} r={size * 0.35} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#12C79A" stopOpacity="0.10"/>
          <stop offset="100%" stopColor="#12C79A" stopOpacity="0"/>
        </radialGradient>
        <linearGradient id={arcGradId} x1={sx} y1={sy} x2={ex} y2={ey} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#12C79A"/>
          <stop offset="100%" stopColor="#38BDF8"/>
        </linearGradient>
      </defs>
      <rect width={size} height={size} rx={rx} fill={`url(#${bgGradId})`}/>
      <rect width={size} height={size} rx={rx} fill={`url(#${ambGradId})`}/>
      <path d={arcPath} stroke={`url(#${arcGradId})`} strokeWidth={sw} fill="none" strokeLinecap="round"/>
      <circle cx={ex} cy={ey} r={nodeR} fill="#38BDF8"/>
      <circle cx={ex} cy={ey} r={coreR} fill="white"/>
    </svg>
  )
}
