// Frozen acceptance test for 1.6.0 program 160-152 (Jira OXE-152, A6). Written by the planner; the executor must not
// edit it. The project terminal and commands on main b3491f620 write 14 raw <button> tags (ThreadProjectTerminal 6,
// ThreadCommandDialog 5, ThreadBackgroundShells 2, ThreadTerminalTab 1). Contract: none.
import { describe, expect, it } from 'vitest'
import { offenders } from './raw-buttons'

const TERMINAL = ['ThreadProjectTerminal.tsx', 'ThreadCommandDialog.tsx', 'ThreadBackgroundShells.tsx', 'ThreadTerminalTab.tsx']

describe('OXE-152 · A6 the project terminal and commands on the src/ui primitives', () => {
  it('the project terminal and commands have no raw button', () => {
    expect(offenders(TERMINAL)).toEqual([])
  })
})
