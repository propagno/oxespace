import type { ReactElement, SVGProps } from 'react'

// Mandacaru own icon (T85): History (time travel), a clock face with a rewind arrow. 24 px grid, 2 px stroke.
type Props = SVGProps<SVGSVGElement> & { size?: number; title?: string }

export function HistoryIcon({ size = 24, title, ...rest }: Props): ReactElement {
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
      <path d="M4 12a8 8 0 1 0 2.3-5.6" />
      <path d="M4 4v4h4" />
      <path d="M12 8v4l3 2" />
    </svg>
  )
}
