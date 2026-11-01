import { chunk } from '../../lib/chunk'

/**
 * The status bar's usage chip, out of the boot bundle. AppStatusBar renders it from this chunk, and OxeChat's view
 * chunk (src/components/Navigation/ModeViews.tsx) loads it with the view: the chip and the conversation reveal
 * together on the first switch (F7.3).
 */
export const USAGE_CHUNK = chunk(() => import('./UsageStatus'))
