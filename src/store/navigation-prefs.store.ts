import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const SIDEBAR_WIDTH = 280
export const SIDEBAR_RAIL_WIDTH = 56
export const SIDEBAR_MIN_WIDTH = 240
// Wide enough to read long conversation titles at a larger zoom.
export const SIDEBAR_MAX_WIDTH = 520
export const SIDEBAR_RESIZE_STEP = 8

export function navigationWidth(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, value)) : SIDEBAR_WIDTH
}

function legacyThreadWidth(): number {
  try {
    const value = JSON.parse(localStorage.getItem('oxe.thread-navigation') ?? 'null')?.state?.width
    const width = navigationWidth(value)
    if (typeof value === 'number' && Number.isFinite(value) && localStorage.getItem('oxe.navigation') === null) {
      localStorage.setItem('oxe.navigation', JSON.stringify({ state: { width, expanded: {} }, version: 0 }))
    }
    return width
  } catch { return SIDEBAR_WIDTH }
}

/** The first-run guide: agent CLIs, account, first folder and answer; GitHub is optional. */
export const FIRST_RUN_STEPS = ['agents', 'account', 'folder', 'github'] as const
export type FirstRunStep = typeof FIRST_RUN_STEPS[number]
export interface FirstRunState {
  done: FirstRunStep[]
  dismissed: boolean
  /** When the guide first appeared; the local "time to first answer" clock starts here. */
  startedAt: number | null
  /** Milliseconds from startedAt to the first agent answer, kept on this computer only. */
  firstAnswerMs: number | null
}
const FIRST_RUN: FirstRunState = { done: [], dismissed: false, startedAt: null, firstAnswerMs: null }

export function firstRunState(value: unknown): FirstRunState {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const time = (raw: unknown): number | null => typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : null
  return {
    done: Array.isArray(input.done) ? FIRST_RUN_STEPS.filter(step => (input.done as unknown[]).includes(step)) : [],
    dismissed: input.dismissed === true,
    startedAt: time(input.startedAt),
    firstAnswerMs: time(input.firstAnswerMs)
  }
}

export const useNavigationPrefs = create<{
  width: number; expanded: Record<string, boolean>
  threadDensity: 'comfortable' | 'compact'
  firstRun: FirstRunState
  setThreadDensity: (density: 'comfortable' | 'compact') => void
  setWidth: (width: number) => void; setExpanded: (id: string, expanded: boolean) => void
  completeFirstRunStep: (step: FirstRunStep) => void
  dismissFirstRun: () => void
  startFirstRunClock: (at: number) => void
  recordFirstAnswer: (durationMs: number) => void
}>()(persist((set) => ({
  width: legacyThreadWidth(), expanded: {},
  threadDensity: 'comfortable',
  firstRun: FIRST_RUN,
  setThreadDensity: threadDensity => set({ threadDensity }),
  setWidth: width => set({ width: navigationWidth(width) }),
  setExpanded: (id, expanded) => set(state => ({ expanded: { ...state.expanded, [id]: expanded } })),
  completeFirstRunStep: step => set(state => state.firstRun.done.includes(step) ? state : { firstRun: { ...state.firstRun, done: FIRST_RUN_STEPS.filter(item => item === step || state.firstRun.done.includes(item)) } }),
  dismissFirstRun: () => set(state => ({ firstRun: { ...state.firstRun, dismissed: true } })),
  startFirstRunClock: at => set(state => state.firstRun.startedAt !== null ? state : { firstRun: { ...state.firstRun, startedAt: at } }),
  recordFirstAnswer: durationMs => set(state => state.firstRun.firstAnswerMs !== null ? state : { firstRun: { ...state.firstRun, firstAnswerMs: Math.max(0, Math.round(durationMs)) } })
}), { name: 'oxe.navigation', merge: (saved, current) => {
  const value = saved as { width?: unknown; expanded?: Record<string, unknown>; threadDensity?: unknown; firstRun?: unknown } | null
  return { ...current, width: navigationWidth(value?.width ?? current.width),
    threadDensity: value?.threadDensity === 'compact' ? 'compact' : 'comfortable',
    firstRun: firstRunState(value?.firstRun),
    expanded: Object.fromEntries(Object.entries(value?.expanded ?? {}).filter(([, v]) => typeof v === 'boolean')) as Record<string, boolean> }
} }))
