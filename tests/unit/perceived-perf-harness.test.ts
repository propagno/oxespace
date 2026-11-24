// @vitest-environment node
// OXE-391 CA-1: OxeCode's cold first content is armed and clicked as soon as the first run's footer "OxeCode" is
// visible. A fixed wait there let the product preload the OxeCode screen (whenIdle(preloadCodeView)) before the measure
// started, so a regression of the cold open up to about 2x passed the gate.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const spec = readFileSync(join(process.cwd(), 'e2e', 'perceived-perf.spec.ts'), 'utf8')

describe('OXE-391: the perceived-perf harness', () => {
  it('CODE_COLD is measured with no fixed wait before the click', () => {
    const visible = spec.indexOf(".getByRole('button', { name: /^OxeCode\\b/ }).waitFor({ state: 'visible'")
    const measured = spec.indexOf("record('cold', CODE_COLD.name, await measure(page, CODE_COLD, 'cold', shots))")
    expect(visible, 'the session waits for the first run footer OxeCode to be visible').toBeGreaterThan(0)
    expect(measured, 'the session measures CODE_COLD').toBeGreaterThan(visible)
    const between = spec.slice(visible, measured)
    expect(between, 'nothing waits a fixed time between the footer becoming visible and the cold measure').not.toMatch(/waitForTimeout\(/)
    expect(between, 'nor sleeps another way').not.toMatch(/setTimeout\(|sleep\(/)
  })
})
