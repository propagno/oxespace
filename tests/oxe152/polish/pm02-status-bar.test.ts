// Frozen acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-248, PM-02·11 as narrowed by the coordination on 15/11:
// ONLY (a), the 24px targets; the agents-working item leaves the status bar with BRD-09, T28). Written by the planner; the
// executor must not edit it. Runs after T28 (BRD-09 rebuilds the status bar in the same files).
// Today (main 4b7015c89) the usage reading (.usage, UsageStatus's button) and the background-sessions action (.action)
// are 17px tall, under the 24px target floor.
// Contract (SOURCE-TEXT check, marked: jsdom lays nothing out; the e2e spec pm-02-11 measures the usage button in the
// built app): AppStatusBar.module.css gives .usage and .action min-height var(--target-min) (24px, src/design/tokens).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(process.cwd(), 'src/components/Workspace/AppStatusBar.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const rule = (selector: string): string => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(match => match[1].split(',').map(part => part.trim()).includes(selector)).map(match => match[2]).join(';')

describe('OXE-248 PM-02·11 the status bar\'s targets are 24px', () => {
  it.each(['.usage', '.action'])('%s has min-height var(--target-min)', selector => {
    expect(rule(selector).length, `the ${selector} rule`).toBeGreaterThan(0)
    expect(rule(selector)).toMatch(/min-height\s*:\s*var\(--target-min\)/)
  })
})
