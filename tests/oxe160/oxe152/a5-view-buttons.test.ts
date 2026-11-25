// Frozen acceptance test for 1.6.0 program 160-152 (Jira OXE-152, A5). Written by the planner; the executor must not
// edit it. The conversation frame on main b3491f620 writes 17 raw <button> tags (ThreadView 3, ThreadFindBar 3,
// ThreadEventsPanel 3, ThreadRail 2, ThreadHeader 1, ThreadToolTabs 1, ThreadMarkdown 1, ThreadPromptNavigator 1,
// ThreadEmptyState 1, NowLine 1). A file the F5 work (#1126-#1128) removes counts as none. Contract: none.
import { describe, expect, it } from 'vitest'
import { offenders } from './raw-buttons'

const VIEW = ['ThreadView.tsx', 'ThreadHeader.tsx', 'ThreadFindBar.tsx', 'ThreadEventsPanel.tsx', 'ThreadRail.tsx', 'ThreadToolTabs.tsx', 'ThreadMarkdown.tsx', 'ThreadPromptNavigator.tsx', 'ThreadEmptyState.tsx', 'NowLine.tsx']

describe('OXE-152 · A5 the conversation frame on the src/ui primitives', () => {
  it('the conversation frame has no raw button', () => {
    expect(offenders(VIEW)).toEqual([])
  })
})
