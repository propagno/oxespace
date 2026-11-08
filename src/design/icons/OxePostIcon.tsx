import type { ReactElement, SVGProps } from 'react'

// Mandacaru own icon (T85, CR-02): OxePost mode, a request leaving a source as an arrow.
// Approved drawing from playground icons.ts @718ddfcf, 24 px grid, 2 px stroke.
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
      <circle cx="9" cy="12" r="5" />
      <path d="M14 12h7M18 9l3 3-3 3" />
      <path d="M9 9.5v5" />
    </svg>
  )
}
