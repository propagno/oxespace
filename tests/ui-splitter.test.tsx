import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
    expect(onChange.mock.calls.map(([size]) => size)).toEqual([316, 284, 280])
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
