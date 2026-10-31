import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { describeAttention, useAttentionSummary } from '../src/hooks/useAttentionSummary'
import { useThreadStore } from '../src/store/thread.store'
import { useWorkspaceStore } from '../src/store/workspace.store'

describe('useAttentionSummary', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ workspaces: [] })
    useThreadStore.setState({ threads: [], unreadIds: [] })
  })

  it('counts conversations that need approval or failed, across projects', () => {
    useThreadStore.setState({
      threads: [{ id: 'a', status: 'approval' }, { id: 'b', status: 'failed' }, { id: 'c', status: 'idle' }, { id: 'd', status: 'approval' }, { id: 'e', status: 'running' }] as never,
      unreadIds: ['b']
    })
    const { result } = renderHook(() => useAttentionSummary())
    expect(result.current.thread).toEqual({ needsYou: 2, failed: 1, working: 1 })
    expect(result.current.code).toEqual({ needsYou: 0, failed: 0, working: 0 })
  })

  it('stops counting a failure once the conversation was opened', () => {
    useThreadStore.setState({ threads: [{ id: 'b', status: 'failed' }] as never, unreadIds: ['b'] })
    const { result, rerender } = renderHook(() => useAttentionSummary())
    expect(result.current.thread.failed).toBe(1)
    useThreadStore.getState().markRead('b')
    rerender()
    expect(result.current.thread).toEqual({ needsYou: 0, failed: 0, working: 0 })
  })

  it('says how many are working only when nothing else needs attention', () => {
    expect(describeAttention({ needsYou: 0, failed: 0, working: 2 })).toBe('2 working')
    expect(describeAttention({ needsYou: 1, failed: 0, working: 2 })).toBe('1 needs you')
  })
  it('words the count so it is not color alone', () => {
    expect(describeAttention({ needsYou: 1, failed: 0, working: 0 })).toBe('1 needs you')
    expect(describeAttention({ needsYou: 3, failed: 2, working: 0 })).toBe('3 need you, 2 failed')
  })
})
