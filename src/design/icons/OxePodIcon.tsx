import type { ReactElement, SVGProps } from 'react'

// Obsidian Minimal mode icon (OXE-469): OxePod, a clean isometric container cube.
// 24 px grid, 2 px stroke, round caps and joins.
type Props = SVGProps<SVGSVGElement> & { size?: number; title?: string }

export function OxePodIcon({ size = 24, title, ...rest }: Props): ReactElement {
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
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M4 7.5 12 12l8-4.5M12 12v9" />
    </svg>
  )
}
