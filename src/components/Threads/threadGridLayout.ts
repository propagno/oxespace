/** The side-by-side grid (OXE-188, AG-06): the primary column's share of the width, in percent. */
export const SPLIT_RATIO_MIN = 35
export const SPLIT_RATIO_MAX = 65
export const SPLIT_RATIO_DEFAULT = 50

/** A share the screen can show: rounded to a whole percent and kept within 35–65; anything not a finite number is 50. */
export function clampSplitRatio(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return SPLIT_RATIO_DEFAULT
  return Math.min(SPLIT_RATIO_MAX, Math.max(SPLIT_RATIO_MIN, Math.round(value)))
}
