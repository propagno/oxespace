import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useListKeyboard } from '../src/hooks/useListKeyboard'

function List({ onOpen }: { onOpen: (id: string) => void }) {
  const nav = useListKeyboard<HTMLElement>()
  return <nav ref={nav.ref} onKeyDown={nav.onKeyDown} aria-label="Items">
    <div><button type="button" data-list-item onClick={() => onOpen('alpha')}>Alpha</button><button type="button" data-list-action aria-label="Alpha side">S</button><button type="button" data-list-action aria-label="Alpha menu">M</button></div>
    <div><button type="button" data-list-item aria-current="page" onClick={() => onOpen('beta')}>Beta</button><button type="button" data-list-action aria-label="Beta side">S</button></div>
    <div role="button" data-list-item tabIndex={0} onClick={() => onOpen('gamma')}>Gamma</div>
    <input aria-label="Rename" />
  </nav>
}

const key = (element: Element, value: string, init: KeyboardEventInit = {}): void => { fireEvent.keyDown(element, { key: value, ...init }) }

describe('useListKeyboard', () => {
  it('keeps one tab stop on the current row and none on row actions', async () => {
    render(<List onOpen={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Beta').tabIndex).toBe(0))
    expect(screen.getByText('Alpha').tabIndex).toBe(-1)
    expect(screen.getByText('Gamma').tabIndex).toBe(-1)
    expect(screen.getByLabelText('Alpha side').tabIndex).toBe(-1)
  })

  it('moves with arrows, j/k, Home and End, and moves the tab stop with focus', async () => {
    render(<List onOpen={vi.fn()} />)
    const beta = screen.getByText('Beta')
    beta.focus()
    key(beta, 'ArrowDown')
    expect(screen.getByText('Gamma')).toHaveFocus()
    await waitFor(() => expect(screen.getByText('Gamma').tabIndex).toBe(0))
    expect(beta.tabIndex).toBe(-1)
    key(screen.getByText('Gamma'), 'k')
    expect(beta).toHaveFocus()
    key(beta, 'Home')
    expect(screen.getByText('Alpha')).toHaveFocus()
    key(screen.getByText('Alpha'), 'End')
    expect(screen.getByText('Gamma')).toHaveFocus()
    key(screen.getByText('Gamma'), 'j')
    expect(screen.getByText('Gamma')).toHaveFocus()
  })

  it('reaches row actions with Right and returns with Left', () => {
    render(<List onOpen={vi.fn()} />)
    const alpha = screen.getByText('Alpha')
    alpha.focus()
    key(alpha, 'ArrowRight')
    expect(screen.getByLabelText('Alpha side')).toHaveFocus()
    key(screen.getByLabelText('Alpha side'), 'ArrowRight')
    expect(screen.getByLabelText('Alpha menu')).toHaveFocus()
    key(screen.getByLabelText('Alpha menu'), 'ArrowLeft')
    key(screen.getByLabelText('Alpha side'), 'ArrowLeft')
    expect(alpha).toHaveFocus()
    key(alpha, 'ArrowRight')
    key(screen.getByLabelText('Alpha side'), 'ArrowDown')
    expect(screen.getByText('Beta')).toHaveFocus()
  })

  it('opens a non-button row with Enter and leaves text fields and modified keys alone', () => {
    const onOpen = vi.fn()
    render(<List onOpen={onOpen} />)
    const gamma = screen.getByText('Gamma')
    gamma.focus()
    key(gamma, 'Enter')
    expect(onOpen).toHaveBeenCalledWith('gamma')
    const input = screen.getByLabelText('Rename')
    input.focus()
    key(input, 'j')
    expect(input).toHaveFocus()
    gamma.focus()
    key(gamma, 'ArrowUp', { ctrlKey: true })
    expect(gamma).toHaveFocus()
  })
})
