// Frozen acceptance test for 1.5.2 152p1c (phase F1, Jira OXE-364). Written by the planner; the executor must not edit it.
// rigor: source-assertion — the scenes are captures, not comparisons; their own run (e2e/visual/hml-scenes.spec.ts on
// CI) is the behavioural half. This file pins the shape that keeps them honest: in the four scenes below, no silent
// `if (await x.isVisible())` guard, and every capture comes after an `await expect(...)` that follows the scene's last
// action (click, key press, hover, state push), so a scene that does not reach its target fails instead of shooting
// the wrong screen. The thread-tools-menu scene is out of this card's first pass (it follows OXC-4 after F5's T17).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const SPEC = readFileSync(join(process.cwd(), 'e2e/visual/hml-scenes.spec.ts'), 'utf8').split(/\r?\n/)
const ACTION = /\.(click|press|hover|dblclick|fill|check)\(|setThreadState\(|__oxeE2eAgentState|openSettings\(/

/** The lines of the test whose title starts with the scene's name, up to the next test. */
function block(scene: string): string[] {
  const start = SPEC.findIndex(line => line.includes(`test('${scene}`))
  expect(start, `the scene ${scene} is in hml-scenes.spec.ts`).toBeGreaterThanOrEqual(0)
  const next = SPEC.findIndex((line, index) => index > start && /^\s*test\(/.test(line))
  return SPEC.slice(start, next < 0 ? SPEC.length : next)
}

function noGuard(scene: string): void {
  expect(block(scene).filter(line => /\.isVisible\(/.test(line))).toEqual([])
}

function assertsBeforeEachCapture(scene: string): void {
  const lines = block(scene)
  const captures = lines.map((line, index) => (/\bcapture\(page,/.test(line) ? index : -1)).filter(index => index >= 0)
  expect(captures.length, `${scene} captures`).toBeGreaterThan(0)
  let from = 0
  for (const at of captures) {
    const window = lines.slice(from, at)
    const lastAction = window.reduce((last, line, index) => (ACTION.test(line) ? index : last), -1)
    const assertion = window.findIndex((line, index) => index > lastAction && /await expect\(/.test(line))
    expect(assertion, `${lines[at].trim()} follows an await expect(...) after the scene's last action`).toBeGreaterThanOrEqual(0)
    from = at + 1
  }
}

describe('OXE-364 · the homologation scenes assert their target', () => {
  test('usage-antigravity-groups has no silent visibility guard', () => { noGuard('usage-antigravity-groups') })
  test('usage-antigravity-groups asserts its target before every capture', () => { assertsBeforeEachCapture('usage-antigravity-groups') })
  test('code-needs-you-ring has no silent visibility guard', () => { noGuard('code-needs-you-ring') })
  test('code-needs-you-ring asserts its target before every capture', () => { assertsBeforeEachCapture('code-needs-you-ring') })
  test('code-changes-comments has no silent visibility guard', () => { noGuard('code-changes-comments') })
  test('code-changes-comments asserts its target before every capture', () => { assertsBeforeEachCapture('code-changes-comments') })
  test('thread-parallel has no silent visibility guard', () => { noGuard('thread-parallel') })
  test('thread-parallel asserts its target before every capture', () => { assertsBeforeEachCapture('thread-parallel') })
})
