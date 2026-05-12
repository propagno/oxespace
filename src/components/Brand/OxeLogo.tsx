import type { ReactElement } from 'react'

interface OxeLogoProps {
  size?: number
  variant?: 'full' | 'compact'
}

export function OxeLogo({ size = 28, variant = 'full' }: OxeLogoProps): ReactElement {
  const r = Math.round(size * 0.25)
  const idSuffix = `${size}-${variant}`

  if (variant === 'compact') {
    const s = size
    const cell = Math.round(s * 0.33)
    const gap = Math.round(s * 0.08)
    const x2 = Math.round(s * 0.58)
    const y2 = Math.round(s * 0.58)
    return (
      <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} fill="none" aria-hidden="true">
        <rect x="0" y="0" width={cell} height={cell} rx="1" fill="white" opacity="0.9"/>
        <rect x={x2 - gap} y="0" width={cell} height={cell} rx="1" fill="white" opacity="0.55"/>
        <rect x="0" y={y2 - gap} width={cell} height={cell} rx="1" fill="white" opacity="0.35"/>
        <rect x={x2 - gap} y={y2 - gap} width={cell} height={cell} rx="1" fill="white" opacity="0.15"/>
      </svg>
    )
  }

  const pad = Math.round(size * 0.18)
  const cellSize = Math.round(size * 0.286)
  const gap = Math.round(size * 0.036)
  const col2 = pad + cellSize + gap
  const row2 = pad + cellSize + gap

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id={`oxe-bg-${idSuffix}`} x1="0" y1="0" x2={size} y2={size} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--brand-dark, #1e1b4b)"/>
          <stop offset="100%" stopColor="var(--brand, #4f46e5)"/>
        </linearGradient>
        <radialGradient id={`oxe-glow-${idSuffix}`} cx={Math.round(size * 0.25)} cy={Math.round(size * 0.25)} r={Math.round(size * 0.5)} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--brand-light, #818cf8)" stopOpacity="0.5"/>
          <stop offset="100%" stopColor="var(--brand, #4f46e5)" stopOpacity="0"/>
        </radialGradient>
      </defs>
      <rect width={size} height={size} rx={r} fill={`url(#oxe-bg-${idSuffix})`}/>
      <rect width={size} height={size} rx={r} fill={`url(#oxe-glow-${idSuffix})`}/>
      <rect x={pad} y={pad} width={cellSize} height={cellSize} rx="1.5" fill="white" opacity="0.95"/>
      <rect x={col2} y={pad} width={cellSize} height={cellSize} rx="1.5" fill="white" opacity="0.55"/>
      <rect x={pad} y={row2} width={cellSize} height={cellSize} rx="1.5" fill="white" opacity="0.35"/>
      <rect x={col2} y={row2} width={cellSize} height={cellSize} rx="1.5" fill="white" opacity="0.15"/>
    </svg>
  )
}
