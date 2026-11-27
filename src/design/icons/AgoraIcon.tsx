import type { ReactElement, SVGProps } from 'react'

// Obsidian Minimal mode icon (OXE-469): Agora, clean concentric amphitheater arcs around a center node.
// 24 px grid, 2 px stroke, round caps and joins.
type Props = SVGProps<SVGSVGElement> & { size?: number; title?: string }

export function AgoraIcon({ size = 24, title, ...rest }: Props): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      <path d="M3 17a9 9 0 0 1 18 0" />
      <path d="M6.5 17a5.5 5.5 0 0 1 11 0" />
      <circle cx="12" cy="15.5" r="1.5" />
    </svg>
  )
}
