// Frozen acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-243, PM-02·1, CA-1 and CA-3; brand-approved POLISH-02 #1).
// Written by the planner; the executor must not edit it. Runs after T27 (BRD-09 makes the mode selector the src/ui Tabs
// list; its height is BRD-09's --bar-md tab list, so this card's own heights (CA-2) follow BRD-09 and are not pinned here).
// Today (main 4b7015c89) ModeSwitch.module.css styles the dark active option with :global([data-appearance='dark']), a
// selector no code sets (src/design/mode.ts writes data-mode), so in the dark theme the active mode falls back to the
// light rule.
// Contract:
// - SOURCE-TEXT check (marked: a sweep for a dead selector): no stylesheet under src/ selects on data-appearance.
// - The selected tab's colours in the dark theme are the e2e spec pm-02-1's (computed in the app). The frozen BRD-09 test
//   (T27) makes the mode selector the src/ui Tabs list, whose selected tab is --tx-primary with the accent indicator, so
//   the spec pins the dark-theme tokens of that look, not the card's --fill-selected / --tx-accent pair (planner, 15/11:
//   BRD-09 wins where the two differ, as the brand ruled for the other PU-03 conflicts; asked of the coordinator).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? cssFiles(full) : name.endsWith('.css') ? [full] : []
  })
}
const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '')

describe('OXE-243 PM-02·1 the selected mode reads in the dark theme', () => {
  it('no stylesheet under src/ selects on data-appearance', () => {
    const hits = cssFiles(join(ROOT, 'src')).filter(file => /data-appearance/.test(strip(readFileSync(file, 'utf8')))).map(file => relative(ROOT, file).replace(/\\/g, '/'))
    expect(hits).toEqual([])
  })
})
