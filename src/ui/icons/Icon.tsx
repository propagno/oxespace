import type { ReactElement, ReactNode } from 'react'

/**
 * OXESpace's own icons (docs/design/brand.md › Icons and signals), drawn with the Ramo's gesture on a 16-unit grid:
 * a 1.75 stroke, round ends and joins, lines at 0, 45 and 90 degrees. 16px in the product; the stroke scales with
 * the size. Each icon lives in its own file, so a screen pulls only the ones it draws. Lucide stays the reserve for
 * concepts not drawn yet.
 */
export interface IconProps {
  /** Pixel size of the square; 16 in the product, 24 on empty states and the phone. */
  size?: number
  /** The accessible name. Without it the icon is decorative (aria-hidden), which is right next to a visible label. */
  label?: string
  className?: string
}

export type OxeIcon = ((props: IconProps) => ReactElement) & { iconName: string }

export function createIcon(name: string, drawing: ReactNode): OxeIcon {
  const Icon = ({ size = 16, label, className }: IconProps): ReactElement => (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      data-icon={name}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {drawing}
    </svg>
  )
  return Object.assign(Icon, { iconName: name })
}
