import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useMoreBelow } from '../src/hooks/useMoreBelow'

/** The approval card's scroll fade (DESIGN, RC): there is more below only while the box can still scroll down. */

function Box({ height }: { height: number }) {
  const [ref, more] = useMoreBelow<HTMLDivElement>()
  return <div ref={node => {
    ref.current = node
    if (!node) return
    // jsdom does no layout: the box shows 100 px of `height`.
    Object.defineProperty(node, 'clientHeight', { configurable: true, value: 100 })
    Object.defineProperty(node, 'scrollHeight', { configurable: true, value: height })
  }} data-testid="box" data-more={more ? 'yes' : 'no'} />
}

afterEach(() => { cleanup() })

describe('useMoreBelow', () => {
  it('is true while the box can scroll further down, false at the bottom', () => {
    render(<Box height={300} />)
    const box = screen.getByTestId('box')
    expect(box.dataset.more).toBe('yes')
    act(() => { box.scrollTop = 200; fireEvent.scroll(box) })
    expect(box.dataset.more).toBe('no')
    act(() => { box.scrollTop = 120; fireEvent.scroll(box) })
    expect(box.dataset.more).toBe('yes')
  })

  it('is never true when everything fits', () => {
    render(<Box height={100} />)
    expect(screen.getByTestId('box').dataset.more).toBe('no')
  })
})
