import type { ReactElement, SVGProps } from 'react'

// Mandacaru own icon (T85, CR-02): OxeCode mode, a terminal with a prompt and a spine on top.
// Approved drawing from playground icons.ts @718ddfcf, 24 px grid, 2 px stroke.
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
      <path d="M17 4V2.5" />
    </svg>
  )
}
