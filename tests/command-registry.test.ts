import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { registerCommands, useContributedCommands } from '../src/utils/commandRegistry'

describe('command registry', () => {
  it('turns contributed commands into palette actions and removes them on dispose', () => {
    const run = vi.fn()
    const { result } = renderHook(() => useContributedCommands())
    expect(result.current).toEqual([])
    let dispose = () => {}
    act(() => { dispose = registerCommands('oxequery', [{ id: 'oxequery.open', label: 'Open OxeQuery', category: 'OxeQuery', keywords: ['sql'], run }]) })
    expect(result.current).toHaveLength(1)
    expect(result.current[0]).toMatchObject({ id: 'oxequery.open', title: 'Open OxeQuery', category: 'OxeQuery', keywords: ['sql'] })
    result.current[0].run()
    expect(run).toHaveBeenCalled()
    act(() => dispose())
    expect(result.current).toEqual([])
  })
})
