import type { ReactElement, SVGProps } from 'react'

// Mandacaru own icon (T85, CR-02): History (time travel) as a scrubber, a track with ticks and a filled handle. Not a clock.
// Approved drawing from playground icons.ts @718ddfcf, 24 px grid, 2 px stroke.
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
      <path d="M3 12h18" />
      <path d="M5 9v6M9 10v4M15 10v4M19 9v6" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" />
    </svg>
  )
}
