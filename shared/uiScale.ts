/**
 * Interface scale: the zoom factor of the whole window, from 90% to 125%.
 * The renderer offers the steps; the main process clamps whatever it is sent,
 * saves it and passes it to the next window as its starting zoom.
 */
export const UI_SCALE_MIN = 0.9
export const UI_SCALE_MAX = 1.25
export const UI_SCALE_DEFAULT = 1
export const UI_SCALE_STEPS = [0.9, 1, 1.1, 1.25] as const

/** A finite factor clamped to the supported range, rounded to whole percents; anything else is 100%. */
export function clampUiScale(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return UI_SCALE_DEFAULT
  return Math.round(Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, value)) * 100) / 100
}

/** The window event the renderer fires once a new scale is in effect, so measured surfaces (the terminal) refit. */
export const UI_SCALE_EVENT = 'oxe:ui-scale-changed'
