import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { describeAttention, useAttentionSummary } from '../src/hooks/useAttentionSummary'
import { useThreadStore } from '../src/store/thread.store'
import { useWorkspaceStore } from '../src/store/workspace.store'

describe('useAttentionSummary', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ workspaces: [] })
    useThreadStore.setState({ threads: [] })
  })

  it('counts conversations that need approval or failed, across projects', () => {
    useThreadStore.setState({
      threads: [{ id: 'a', status: 'approval' }, { id: 'b', status: 'failed' }, { id: 'c', status: 'idle' }, { id: 'd', status: 'approval' }] as never
    })
    const { result } = renderHook(() => useAttentionSummary())
    expect(result.current.thread).toEqual({ needsYou: 2, failed: 1 })
    expect(result.current.code).toEqual({ needsYou: 0, failed: 0 })
  })

  it('words the count so it is not color alone', () => {
    expect(describeAttention({ needsYou: 1, failed: 0 })).toBe('1 needs you')
    expect(describeAttention({ needsYou: 3, failed: 2 })).toBe('3 need you, 2 failed')
  })
})
