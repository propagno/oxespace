import { beforeEach, describe, expect, it } from 'vitest'
import { mainMessage } from '../shared/messages'
import type { ApprovalRequest, ApprovalsApi } from '../shared/types/approvals'
import { useApprovalsStore } from '../src/components/Approvals/approvals.store'

/**
 * #243, found by documentation-preview: main sends a request to the window, gets no ack yet (the window's approval code
 * still loading) and answers it in the native dialog. The resolution can arrive while the window's first `sync` is still
 * reading main's list, which then brings back the request already settled: its dialog would stay up for good, and it
 * marks the Web Preview as covered.
 */
const request = (id: string, generation = 1): ApprovalRequest => ({ id, generation, kind: 'mcp', requester: { kind: 'agent', id: 'pane:p1', label: mainMessage('approvals.requester.app', {}) }, risk: 'high', title: mainMessage('approvals.requester.app', {}), summary: mainMessage('approvals.requester.app', {}), appNotes: [], agentText: { text: '', untrusted: true, length: 0, truncated: false }, options: [], defaultOptionId: 'deny', ackRequired: false, createdAt: 1 } as unknown as ApprovalRequest)

function apiWithListGate(): { api: ApprovalsApi; release: (requests: ApprovalRequest[]) => void } {
  let release: (requests: ApprovalRequest[]) => void = () => undefined
  const api = { list: () => new Promise<ApprovalRequest[]>(resolve => { release = resolve }), history: async () => [] } as unknown as ApprovalsApi
  return { api, release: requests => release(requests) }
}

beforeEach(() => { useApprovalsStore.getState().reset() })

describe('a request main settled while the window was still reading its list', () => {
  it('does not come back from that list', async () => {
    const { api, release } = apiWithListGate()
    const syncing = useApprovalsStore.getState().sync(api)
    useApprovalsStore.getState().resolved({ id: 'preview-1', generation: 1, outcome: 'deny', optionId: 'deny', by: 'native' } as never)
    release([request('preview-1')])
    await syncing
    expect(useApprovalsStore.getState().queue).toEqual([])
  })

  it('a newer generation of it still shows, and other requests are untouched', async () => {
    const { api, release } = apiWithListGate()
    const syncing = useApprovalsStore.getState().sync(api)
    useApprovalsStore.getState().resolved({ id: 'preview-1', generation: 1, outcome: 'deny', optionId: 'deny', by: 'native' } as never)
    release([request('preview-1', 2), request('other')])
    await syncing
    expect(useApprovalsStore.getState().queue.map(item => `${item.id}#${item.generation}`).sort()).toEqual(['other#1', 'preview-1#2'])
  })
})
