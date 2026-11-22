// Frozen acceptance test for 1.5.2 152p1c (phase F1, Jira OXE-358 and OXE-155). Written by the planner; the executor
// must not edit it. It reads the production build, so its command builds first (`npm run build`, on CI).
// Contract: the main process entry (out/main/index.js, the artifact scripts/verify-bundle-budgets.mjs measures against
// 620 kB) keeps at least 8% headroom, by moving to first use (`await import()`) services that do not run at boot. The
// 620 kB budget does not move, and the 5% gate of verify-bundle-budgets.mjs stays as it is.
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const ENTRY = join(process.cwd(), 'out', 'main', 'index.js')
const BUDGET = 620 * 1024

describe('OXE-358 · the main process entry', () => {
  test('keeps at least 8% headroom against its 620 kB budget', () => {
    expect(existsSync(ENTRY), 'out/main/index.js: run npm run build first').toBe(true)
    const bytes = statSync(ENTRY).size
    const headroom = 1 - bytes / BUDGET
    expect(Math.round(headroom * 1000) / 10, `main process entry ${Math.round(bytes / 1024)} kB of 620 kB`).toBeGreaterThanOrEqual(8)
  })
})
