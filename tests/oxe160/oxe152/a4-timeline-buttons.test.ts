// Frozen acceptance test for 1.6.0 program 160-152 (Jira OXE-152, A4). Written by the planner; the executor must not
// edit it. The timeline rows on main b3491f620 write 12 raw <button> tags (ThreadMessageRow 4, ThreadActivityGroup 3,
// ThreadTimelineEntry 2, ThreadTurnFold 1, ThreadSubagentActivity 1, ThreadLiveActivity 1). Contract: none.
import { describe, expect, it } from 'vitest'
import { offenders } from './raw-buttons'

const TIMELINE = ['ThreadMessageRow.tsx', 'ThreadActivityGroup.tsx', 'ThreadTimelineEntry.tsx', 'ThreadTurnFold.tsx', 'ThreadSubagentActivity.tsx', 'ThreadLiveActivity.tsx']

describe('OXE-152 · A4 the timeline rows on the src/ui primitives', () => {
  it('the timeline rows have no raw button', () => {
    expect(offenders(TIMELINE)).toEqual([])
  })
})
