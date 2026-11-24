/**
 * The memory budgets of e2e/memory-footprint.spec.ts and how a sample is held to them (OXE-389), pure so a unit test
 * can check it (tests/unit/ci-perf-gate-outcome.test.ts).
 *
 * Windows reports private bytes per process (app.getAppMetrics); Linux does not (privateBytes is 0 there), so Linux is
 * held to its working set. A reading of 0 MB is never a pass: it means nothing was measured.
 */

export type MemoryKey = 'total' | 'browser' | 'renderer'

/**
 * Private megabytes per process type with the memory-footprint scenario, 25% above what the memory-footprint work
 * measured on Windows (total 544, main 213, renderer 158, with 20,000 lines in each of four terminals).
 */
export const WINDOWS_PRIVATE_BUDGETS_MB: Record<MemoryKey, number> = { total: 680, browser: 270, renderer: 200 }

/**
 * Working-set megabytes on Linux, 25% above the median of the "[MEMORY] thread scrolled" line of main's last 5 ci.yml
 * runs before OXE-389 (job "E2E and native tests (linux-x64, 3/3)"): runs 45227150398 (cfe78e55f), 45215169599
 * (0deae0fdb), 45209063244 (beff4a0ad), 45191886755 (07df6b657) and 45186569599 (08cd3275b).
 *   total    786.9  787.2  786.3  787.4  691.3  → median 786.9 → 984
 *   browser  319.0  318.7  318.4  318.6  222.5  → median 318.6 → 398
 *   renderer 255.3  255.1  255.8  256.1  256.0  → median 255.8 → 320
 * The browser's two levels (about 222 and 319) are the bimodal jump of OXE-412; once that is fixed this budget only
 * goes down, from the new series.
 */
export const LINUX_WORKING_SET_BUDGETS_MB: Record<MemoryKey, number> = { total: 984, browser: 398, renderer: 320 }

export interface MemorySample {
  byType: Record<string, number>
  totalMb: number
  workingSetByType: Record<string, number>
  workingSetTotalMb: number
}

export interface MemoryCheck {
  key: MemoryKey
  reading: 'private' | 'working set'
  value: number
  budget: number
  ok: boolean
  message: string
}

/**
 * The budget checks for one sample on one platform: total, browser (the main process) and renderer (Tab).
 * `overrides` are the OXESPACE_MEMORY_BUDGET_*_MB values, read by the spec; a missing one keeps the platform's budget.
 */
export function memoryBudgetChecks(sample: MemorySample, platform: NodeJS.Platform, overrides: Partial<Record<MemoryKey, number>> = {}): MemoryCheck[] {
  const windows = platform === 'win32'
  if (!windows && platform !== 'linux') return []
  const reading: MemoryCheck['reading'] = windows ? 'private' : 'working set'
  const budgets = windows ? WINDOWS_PRIVATE_BUDGETS_MB : LINUX_WORKING_SET_BUDGETS_MB
  const values: Record<MemoryKey, number> = windows
    ? { total: sample.totalMb, browser: sample.byType.Browser ?? 0, renderer: sample.byType.Tab ?? 0 }
    : { total: sample.workingSetTotalMb, browser: sample.workingSetByType.Browser ?? 0, renderer: sample.workingSetByType.Tab ?? 0 }
  return (['total', 'browser', 'renderer'] as const).map(key => {
    const value = values[key]
    const budget = overrides[key] || budgets[key]
    if (!(value > 0)) return { key, reading, value, budget, ok: false, message: `${key} ${reading} memory read 0 MB: not a measurement` }
    return { key, reading, value, budget, ok: value <= budget, message: `${key} ${reading} memory ${value} MB exceeded ${budget} MB` }
  })
}
