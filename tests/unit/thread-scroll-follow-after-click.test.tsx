import { act, renderHook } from '@testing-library/react'
import type { UIEvent } from 'react'
import { describe, expect, it } from 'vitest'
import type { ThreadSnapshot } from '../../shared/types/thread'
import { useThreadScrollAnchor } from '../../src/components/Threads/useThreadScrollAnchor'

const snapshot = (events: number): ThreadSnapshot => ({
  thread: { id: 'thread-follow' },
  events: Array.from({ length: events }, (_, index) => ({ type: 'message', id: `m${index}`, role: 'assistant', text: 'x' }))
} as unknown as ThreadSnapshot)

/** A scroller whose geometry the test sets, as jsdom lays nothing out. */
function scroller(scrollHeight: number, clientHeight: number) {
  const el = document.createElement('div')
  const size = { scrollHeight, clientHeight }
  Object.defineProperty(el, 'scrollHeight', { get: () => size.scrollHeight })
  Object.defineProperty(el, 'clientHeight', { get: () => size.clientHeight })
  let top = 0
  // The browser never keeps scrollTop past the end.
  Object.defineProperty(el, 'scrollTop', { get: () => Math.min(top, size.scrollHeight - size.clientHeight), set: (value: number) => { top = value } })
  return { el, size }
}

function followingConversation() {
  const { el, size } = scroller(1000, 500)
  const hook = renderHook(({ value }) => useThreadScrollAnchor(value, 'thread-follow'), { initialProps: { value: null as ThreadSnapshot | null } })
  hook.result.current.timeline.current = el
  hook.rerender({ value: snapshot(3) })
  const scrolled = () => act(() => hook.result.current.timelineProps.onScroll({ currentTarget: el } as unknown as UIEvent<HTMLDivElement>))
  scrolled()
  expect(el.scrollTop).toBe(500)
  expect(hook.result.current.showEnd).toBe(false)
  return { el, size, hook, scrolled }
}

describe('following the conversation after a click in it', () => {
  it('keeps following when the content gets shorter under the click (a request card after its answer)', () => {
    const { el, size, hook, scrolled } = followingConversation()
    act(() => hook.result.current.timelineProps.onPointerDown())
    size.scrollHeight = 900
    scrolled()
    expect(el.scrollTop).toBe(400)
    expect(hook.result.current.showEnd).toBe(false)
    // What comes next is still followed: the card of the turn's changes opening by itself, the next message.
    size.scrollHeight = 980
    act(() => hook.rerender({ value: snapshot(4) }))
    expect(el.scrollTop).toBe(480)
    expect(hook.result.current.showEnd).toBe(false)
    expect(hook.result.current.newMessages).toBe(0)
  })

  it('stops following when the person drags the view up', () => {
    const { el, hook, scrolled } = followingConversation()
    act(() => hook.result.current.timelineProps.onPointerDown())
    el.scrollTop = 300
    scrolled()
    expect(hook.result.current.showEnd).toBe(true)
  })
})
