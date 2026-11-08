import type { ReactElement, SVGProps } from 'react'

// Mandacaru own icon (T85, CR-02): OxePod mode, a container box with two thorns on top.
// Approved drawing from playground icons.ts @718ddfcf, 24 px grid, 2 px stroke.
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
      <path d="M8 5.2 7 3.6M16 5.2l1-1.6" />
    </svg>
  )
}
