import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useModalSurface } from '../src/ui'

function Panel({ onClose }: { onClose: () => void }) {
  const surface = useModalSurface<HTMLElement>(onClose)
  return <section role="dialog" aria-label="Panel" {...surface}>
    <button>first</button>
    <button>last</button>
  </section>
}

function Collapsed({ onClose }: { onClose: () => void }) {
  const surface = useModalSurface<HTMLElement>(onClose)
  return <section role="dialog" aria-label="Panel" {...surface}>
    <button>first</button>
    <div style={{ display: 'none' }}><button>collapsed</button></div>
    <button>last</button>
    <button style={{ visibility: 'hidden' }}>invisible</button>
  </section>
}

describe('useModalSurface', () => {
  it('Tab never lands on a control hidden by CSS (FE-M-13)', () => {
    render(<Collapsed onClose={vi.fn()} />)
    const last = screen.getByText('last')
    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(screen.getByText('first')).toHaveFocus()
    fireEvent.keyDown(screen.getByText('first'), { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()
  })

  it('makes the rest of the window inert while open, and gives it back on close (FE-M-13)', () => {
    const outside = document.createElement('main')
    const alreadyInert = document.createElement('aside')
    alreadyInert.setAttribute('inert', '')
    document.body.append(outside, alreadyInert)
    const { unmount, container } = render(<Panel onClose={vi.fn()} />)
    expect(outside).toHaveAttribute('inert')
    expect(container).not.toHaveAttribute('inert')
    unmount()
    expect(outside).not.toHaveAttribute('inert')
    // What was inert before stays inert.
    expect(alreadyInert).toHaveAttribute('inert')
    outside.remove(); alreadyInert.remove()
  })

  it('moves focus in, closes on Escape and keeps Tab inside', () => {
    const close = vi.fn()
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const { unmount } = render(<Panel onClose={close} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveFocus()

    const last = screen.getByText('last')
    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(screen.getByText('first')).toHaveFocus()

    fireEvent.keyDown(screen.getByText('first'), { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()

    fireEvent.keyDown(last, { key: 'Escape' })
    expect(close).toHaveBeenCalledTimes(1)

    unmount()
    expect(opener).toHaveFocus()
    opener.remove()
  })
})
