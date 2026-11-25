// Frozen acceptance test for 1.6.0 program 160-152 (Jira OXE-152, A2). Written by the planner; the executor must not
// edit it. Requests and approvals on main b3491f620 write 18 raw <button> tags (ThreadRequestCard 9, ThreadDockRequests 3,
// ThreadPermissionsPanel 2, ThreadMcpDiagnose 2, ThreadApprovalDetails 1, ThreadDeliveryNote 1). Contract: none.
import { describe, expect, it } from 'vitest'
import { offenders } from './raw-buttons'

const REQUESTS = ['ThreadRequestCard.tsx', 'ThreadDockRequests.tsx', 'ThreadPermissionsPanel.tsx', 'ThreadMcpDiagnose.tsx', 'ThreadApprovalDetails.tsx', 'ThreadDeliveryNote.tsx']

describe('OXE-152 · A2 requests and approvals on the src/ui primitives', () => {
  it('requests and approvals have no raw button', () => {
    expect(offenders(REQUESTS)).toEqual([])
  })
})
