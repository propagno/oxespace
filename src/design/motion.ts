/**
 * Motion: the person chooses System, Reduced or Full; the document root carries
 * the resolved value as `data-motion` ('reduce' or 'full'), which the tokens and
 * the global reduced-motion rule in base.css read. System follows the
 * operating system's prefers-reduced-motion.
 */
export type MotionPreference = 'system' | 'reduce' | 'full'
export type ResolvedMotion = 'reduce' | 'full'

const SETTINGS_KEY = 'oxe-settings'
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

export function systemPrefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.(REDUCED_MOTION_QUERY).matches === true
}

export function resolveMotion(preference: MotionPreference, systemReduce: boolean = systemPrefersReducedMotion()): ResolvedMotion {
  return preference === 'system' ? (systemReduce ? 'reduce' : 'full') : preference
}

export function motionPreference(value: unknown): MotionPreference {
  return value === 'reduce' || value === 'full' ? value : 'system'
}

export function applyMotion(motion: ResolvedMotion): void {
  document.documentElement.dataset.motion = motion
}

/** The saved choice, read synchronously before the first paint so nothing animates that should not. */
export function savedMotion(): MotionPreference {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY)
    return motionPreference(raw ? (JSON.parse(raw) as { state?: { motion?: unknown } }).state?.motion : undefined)
  } catch { return 'system' }
}
