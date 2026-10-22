import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Splitter } from '../src/ui/Splitter'

afterEach(cleanup)

// jsdom has no PointerEvent, so pointer events would arrive without coordinates.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number
    constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 0 }
  }
  window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent
}

describe('Splitter', () => {
  it('resizes from the keyboard within its limits and restores the default on double click', () => {
    const onChange = vi.fn()
    render(<Splitter orientation="horizontal" label="Editor height" value={170} min={80} max={400} defaultValue={170} onChange={onChange} />)
    const separator = screen.getByRole('separator', { name: 'Editor height' })
    expect(separator).toHaveAttribute('aria-orientation', 'horizontal')
    fireEvent.keyDown(separator, { key: 'ArrowDown' })
    fireEvent.keyDown(separator, { key: 'ArrowUp' })
    fireEvent.keyDown(separator, { key: 'Home' })
    fireEvent.keyDown(separator, { key: 'End' })
    fireEvent.doubleClick(separator)
    expect(onChange.mock.calls.map(([size]) => size)).toEqual([186, 154, 80, 400, 170])
  })

  it('shrinks a panel that comes after it when dragged toward it, and never past its limits', () => {
    const onChange = vi.fn()
    render(<Splitter orientation="vertical" label="Panel width" value={300} min={200} max={500} defaultValue={300} after onChange={onChange} />)
    const separator = screen.getByRole('separator', { name: 'Panel width' })
    separator.setPointerCapture = vi.fn()
    fireEvent.pointerDown(separator, { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(separator, { clientX: 150, pointerId: 1 })
    fireEvent.pointerMove(separator, { clientX: -400, pointerId: 1 })
    fireEvent.keyDown(separator, { key: 'ArrowRight' })
    expect(onChange.mock.calls.map(([size]) => size)).toEqual([250, 500, 284])
  })
})
