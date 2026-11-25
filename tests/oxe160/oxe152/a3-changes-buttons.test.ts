// Frozen acceptance test for 1.6.0 program 160-152 (Jira OXE-152, A3). Written by the planner; the executor must not
// edit it. Changes and review on main b3491f620 write 30 raw <button> tags (ThreadFileActivity 11, ThreadDockChanges 6,
// ThreadPatch 4, ThreadHunkReview 4, ThreadChangesPanel 3, ThreadTurnReview 2). Contract: none.
import { describe, expect, it } from 'vitest'
import { offenders } from './raw-buttons'

const CHANGES = ['ThreadFileActivity.tsx', 'ThreadDockChanges.tsx', 'ThreadPatch.tsx', 'ThreadHunkReview.tsx', 'ThreadChangesPanel.tsx', 'ThreadTurnReview.tsx']

describe('OXE-152 · A3 changes and review on the src/ui primitives', () => {
  it('changes and review have no raw button', () => {
    expect(offenders(CHANGES)).toEqual([])
  })
})
