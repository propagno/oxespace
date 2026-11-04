import type { ReactElement, SVGProps } from 'react'

// Mandacaru own icon (T85): OxePost mode, a request arrow hitting an endpoint. 24 px grid, 2 px stroke.
type Props = SVGProps<SVGSVGElement> & { size?: number; title?: string }

export function OxePostIcon({ size = 24, title, ...rest }: Props): ReactElement {
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
      <path d="M4 12h11" />
      <path d="M11 7l5 5-5 5" />
      <path d="M20 5v14" />
    </svg>
  )
}
