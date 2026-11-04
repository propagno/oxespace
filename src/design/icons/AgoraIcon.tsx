import type { ReactElement, SVGProps } from 'react'

// Mandacaru own icon (T85, CR-02): Agora, an amphitheater around a center with rays above.
// Approved drawing from playground icons.ts @718ddfcf, 24 px grid, 2 px stroke.
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
      <path d="M3 19a9 9 0 0 1 18 0" />
      <path d="M6.5 19a5.5 5.5 0 0 1 11 0" />
      <circle cx="12" cy="17.5" r="1.5" />
      <path d="M12 4v4M5.6 6.6l1.8 1.8M18.4 6.6l-1.8 1.8" />
    </svg>
  )
}
