import type { ReactElement, SVGProps } from 'react'

// Mandacaru own icon (T85): OxeCode mode, a terminal window with a prompt. 24 px grid, 2 px stroke.
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
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 10l3 2-3 2" />
      <path d="M13 15h4" />
    </svg>
  )
}
