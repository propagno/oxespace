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
