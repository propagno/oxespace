import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TitleTooltips } from '../src/ui'

describe('TitleTooltips', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shows a styled hint after a delay and puts the title back afterwards', () => {
    render(<><TitleTooltips /><button title="Open settings">Gear</button></>)
    const button = screen.getByText('Gear')
    fireEvent.pointerOver(button)
    expect(button).not.toHaveAttribute('title')
    expect(screen.queryByRole('tooltip')).toBeNull()
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.getByRole('tooltip')).toHaveTextContent('Open settings')
    fireEvent.pointerOut(button, { relatedTarget: document.body })
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(button).toHaveAttribute('title', 'Open settings')
  })

  it('leaves terminals alone and drops the hint on press', () => {
    render(<><TitleTooltips /><div className="xterm"><span title="cell">x</span></div><button title="Save">Save</button></>)
    fireEvent.pointerOver(screen.getByText('x'))
    expect(screen.getByText('x')).toHaveAttribute('title', 'cell')
    const save = screen.getByText('Save')
    fireEvent.pointerOver(save)
    act(() => { vi.advanceTimersByTime(500) })
    fireEvent.pointerDown(save)
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(save).toHaveAttribute('title', 'Save')
  })
})
