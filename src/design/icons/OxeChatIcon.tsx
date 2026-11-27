import type { ReactElement, SVGProps } from 'react'

// Obsidian Minimal mode icon (OXE-469): OxeChat, a clean rounded speech bubble with two subtle text lines.
// 24 px grid, 2 px stroke, round caps and joins.
type Props = SVGProps<SVGSVGElement> & { size?: number; title?: string }

export function OxeChatIcon({ size = 24, title, ...rest }: Props): ReactElement {
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
      <path d="M21 14a2 2 0 0 1-2 2H7l-4 4V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M8 8.5h8M8 12h5" />
    </svg>
  )
}
