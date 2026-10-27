import { forwardRef } from 'react'
import type { LucideIcon, LucideProps } from 'lucide-react'
import { siGithub } from 'simple-icons'

/**
 * The GitHub mark, drawn like a lucide icon (`size`, `color`, `className`). lucide-react 1.x dropped brand icons,
 * so the mark comes from simple-icons, filled rather than stroked.
 */
export const Github: LucideIcon = forwardRef<SVGSVGElement, Omit<LucideProps, 'ref'>>(function Github(
  { size = 24, color = 'currentColor', strokeWidth: _strokeWidth, absoluteStrokeWidth: _absolute, children, ...rest }, ref
) {
  return <svg ref={ref} xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill={color} {...rest}>
    <path d={siGithub.path} />{children}
  </svg>
})
