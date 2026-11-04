import type { ReactElement, SVGProps } from 'react'

// Mandacaru own icon (T85): Agora, a square with agents gathered around a center. 24 px grid, 2 px stroke.
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
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="4" r="1.5" />
      <circle cx="20" cy="12" r="1.5" />
      <circle cx="12" cy="20" r="1.5" />
      <circle cx="4" cy="12" r="1.5" />
    </svg>
  )
}
