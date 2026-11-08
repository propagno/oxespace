import type { ReactElement, SVGProps } from 'react'

// Mandacaru own icon (T85, CR-02): OxeChat mode, a speech bubble with a cactus inside.
// Approved drawing from playground icons.ts @718ddfcf, 24 px grid, 2 px stroke.
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
      <path d="M4 5h16v11H11l-5 4v-4H4z" />
      <path d="M12 9v4M12 11h-2.5V9.5M12 10.5h2.5V9" />
    </svg>
  )
}
