/**
 * The mandacaru mark's geometry (docs/design/brand.md), drawn on a 44-unit grid: one trunk and two arms, a task
 * that splits into agents. The logo, the brand loader and the boot splash draw from here so they never drift.
 */
export const MARK_VIEWBOX = '0 0 44 44'
export const MARK_STROKE = 4
export const MARK_TRUNK = 'M22 39V8'
export const MARK_ARM_LEFT = 'M22 27h-6a4 4 0 0 1-4-4v-7'
export const MARK_ARM_RIGHT = 'M22 21h6a4 4 0 0 0 4-4v-6'
/** Where each arm leaves the trunk: the loader grows the arms out of these points. */
export const MARK_ARM_LEFT_ORIGIN = '22px 27px'
export const MARK_ARM_RIGHT_ORIGIN = '22px 21px'
/** The sertão sun beside the cactus, without the tile. */
export const MARK_SUN = { cx: 10, cy: 8.5, r: 3.4 } as const
