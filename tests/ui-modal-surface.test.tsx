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

describe('useModalSurface', () => {
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
