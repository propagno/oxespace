import { act, renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'
import { useThreadVirtualizer } from '../src/components/Threads/useThreadVirtualizer'

it('preserves the reading window while the Thread container is hidden', () => {
  const scroll = document.createElement('div'), space = document.createElement('div')
  let height = 400
  Object.defineProperty(scroll, 'clientHeight', { get: () => height })
  const keys = Array.from({ length: 1000 }, (_, index) => String(index))
  const { result, unmount } = renderHook(() => useThreadVirtualizer(keys, { current: scroll }, { current: false }))
  act(() => {
    result.current.spaceRef.current = space
    scroll.scrollTop = 66000
    result.current.updateViewport()
  })
  const visible = result.current.items.map(item => item.key)
  expect(visible).toContain('500')
  act(() => {
    height = 0
    scroll.scrollTop = 0
    result.current.updateViewport()
  })
  expect(result.current.items.map(item => item.key)).toEqual(visible)
  act(() => {
    height = 400
    scroll.scrollTop = 66000
    result.current.updateViewport()
  })
  expect(result.current.items.map(item => item.key)).toEqual(visible)
  unmount()
})

it('does not re-render while scrolling within the mounted rows, only when the window moves', () => {
  const scroll = document.createElement('div'), space = document.createElement('div')
  Object.defineProperty(scroll, 'clientHeight', { get: () => 400 })
  const keys = Array.from({ length: 1000 }, (_, index) => String(index))
  let renders = 0
  const { result, unmount } = renderHook(() => { renders++; return useThreadVirtualizer(keys, { current: scroll }, { current: false }) })
  act(() => {
    result.current.spaceRef.current = space
    scroll.scrollTop = 66050
    result.current.updateViewport()
  })
  const settled = renders
  // Rows are 132 px (the estimate): a few pixels stay on the same rows.
  for (const top of [66051, 66055, 66062, 66070]) act(() => { scroll.scrollTop = top; result.current.updateViewport() })
  expect(renders).toBe(settled)
  act(() => { scroll.scrollTop = 67000; result.current.updateViewport() })
  expect(renders).toBeGreaterThan(settled)
  expect(result.current.items.map(item => item.key)).toContain(String(Math.floor(67000 / 132)))
  unmount()
})
