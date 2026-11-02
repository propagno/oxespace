import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useRef, useState } from 'react'
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

// FL-09 (e2e/thread-view.spec.ts:331): a parent that applies the size later, as a slow store does. Keys that arrive
// before it renders must each count.
function LateParent({ onChange }: { onChange: (size: number) => void }) {
  const [value, setValue] = useState(360)
  const pending = useRef<number | null>(null)
  return <>
    <Splitter orientation="vertical" label="Sidebar width" value={value} min={240} max={520} defaultValue={280} step={8}
      onChange={size => { pending.current = size; onChange(size) }} />
    <button type="button" onClick={() => { if (pending.current !== null) setValue(pending.current) }}>apply</button>
  </>
}

describe('Splitter: every request counts before the new size renders (FL-09)', () => {
  it('two ArrowLeft without a render in between are two steps', () => {
    const onChange = vi.fn()
    render(<LateParent onChange={onChange} />)
    const separator = screen.getByRole('separator', { name: 'Sidebar width' })
    fireEvent.keyDown(separator, { key: 'ArrowLeft' })
    fireEvent.keyDown(separator, { key: 'ArrowLeft' })
    expect(onChange.mock.calls.map(([size]) => size)).toEqual([352, 344])
    fireEvent.click(screen.getByRole('button', { name: 'apply' }))
    expect(separator).toHaveAttribute('aria-valuenow', '344')
    // After the render, the next key starts from the rendered size.
    fireEvent.keyDown(separator, { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenLastCalledWith(336)
  })

  it('two Smaller from the menu without a render in between are two steps', async () => {
    const onChange = vi.fn()
    render(<LateParent onChange={onChange} />)
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Sidebar width' }), { key: 'Enter' })
    const menu = await screen.findByRole('menu', { name: 'Sidebar width: size options' })
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Smaller' }))
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Smaller' }))
    expect(onChange.mock.calls.map(([size]) => size)).toEqual([352, 344])
  })

  it('a size the parent sets on its own becomes the starting point', () => {
    const onChange = vi.fn()
    const { rerender } = render(<Splitter orientation="vertical" label="Width" value={300} min={200} max={500} defaultValue={300} step={10} onChange={onChange} />)
    const separator = screen.getByRole('separator', { name: 'Width' })
    fireEvent.keyDown(separator, { key: 'ArrowRight' })
    rerender(<Splitter orientation="vertical" label="Width" value={250} min={200} max={500} defaultValue={300} step={10} onChange={onChange} />)
    fireEvent.keyDown(separator, { key: 'ArrowRight' })
    expect(onChange.mock.calls.map(([size]) => size)).toEqual([310, 260])
  })
})

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
    // The parent here never renders the new size, so each key starts from the last one requested (FL-09).
    expect(onChange.mock.calls.map(([size]) => size)).toEqual([186, 170, 80, 400, 170])
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
    expect(onChange.mock.calls.map(([size]) => size)).toEqual([250, 500, 484])
  })

  it('resizes without dragging (WCAG 2.5.7): a click opens Smaller, Larger and Restore, and the separator keeps a valid role', async () => {
    const onChange = vi.fn()
    render(<Splitter orientation="vertical" label="Sidebar width" value={300} min={240} max={520} defaultValue={280} onChange={onChange} />)
    const separator = screen.getByRole('separator', { name: 'Sidebar width' })
    separator.setPointerCapture = vi.fn()
    // A press that barely moves is a click, not a drag.
    fireEvent.pointerDown(separator, { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(separator, { clientX: 102, pointerId: 1 })
    fireEvent.pointerUp(separator, { clientX: 102, pointerId: 1 })
    expect(onChange).not.toHaveBeenCalled()
    const menu = await screen.findByRole('menu', { name: 'Sidebar width: size options' })
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Larger' }))
    // Larger keeps the menu open, so it can be repeated.
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Smaller' }))
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Restore the default size' }))
    expect(onChange.mock.calls.map(([size]) => size)).toEqual([316, 300, 280])
    expect(separator).not.toHaveAttribute('aria-expanded')
    expect(separator).not.toHaveAttribute('aria-haspopup')
  })

  it('opens the same choices from the keyboard with Enter', async () => {
    render(<Splitter orientation="horizontal" label="Editor height" value={170} min={80} max={400} defaultValue={170} onChange={vi.fn()} />)
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Editor height' }), { key: 'Enter' })
    expect(await screen.findByRole('menuitem', { name: 'Restore the default size' })).toHaveAttribute('data-disabled')
  })

  it('opens the same menu from the context-menu keys, as a keydown or as a contextmenu event, like the grid dividers', async () => {
    render(<Splitter orientation="vertical" label="Sidebar width" value={300} min={240} max={520} defaultValue={280} onChange={vi.fn()} />)
    const separator = screen.getByRole('separator', { name: 'Sidebar width' })
    expect(separator).toHaveAttribute('aria-keyshortcuts', 'Enter Shift+F10')
    for (const open of [() => fireEvent.keyDown(separator, { key: 'F10', shiftKey: true }), () => fireEvent.keyDown(separator, { key: 'ContextMenu' }), () => fireEvent.contextMenu(separator)]) {
      open()
      expect(await screen.findByRole('menu', { name: 'Sidebar width: size options' })).toBeInTheDocument()
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    }
    // The browser's own menu stays shut.
    expect(fireEvent.contextMenu(separator)).toBe(false)
  })
})
