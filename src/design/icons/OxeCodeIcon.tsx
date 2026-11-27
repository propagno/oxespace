import type { ReactElement, SVGProps } from 'react'

// Obsidian Minimal mode icon (OXE-469): OxeCode, a clean rounded terminal frame with >_ prompt.
// 24 px grid, 2 px stroke, round caps and joins.
type Props = SVGProps<SVGSVGElement> & { size?: number; title?: string }

export function OxeCodeIcon({ size = 24, title, ...rest }: Props): ReactElement {
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
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="m7 10 3 2-3 2M12.5 15H16" />
    </svg>
  )
}
