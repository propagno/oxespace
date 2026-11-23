import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button, Card, Chip, SearchInput, Tooltip, TooltipProvider } from '../../../src/ui'
import { DesignSystemPage } from '../../../src/components/DesignSystem/DesignSystemPage'

afterEach(() => {
  cleanup()
  delete document.documentElement.dataset.density
})

describe('OXE-373 · Chip primitive', () => {
  it('supports interactive toggle with aria-pressed and variants', () => {
    const onClick = vi.fn()
    const { rerender } = render(
      <Chip variant="accent" size="sm" pressed={false} onClick={onClick}>
        Active
      </Chip>
    )
    const btn = screen.getByRole('button', { name: 'Active' })
    expect(btn).toHaveAttribute('data-ui', 'chip')
    expect(btn).toHaveAttribute('data-variant', 'accent')
    expect(btn).toHaveAttribute('data-size', 'sm')
    expect(btn).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(btn)
    expect(onClick).toHaveBeenCalledTimes(1)

    rerender(
      <Chip variant="danger" pressed={true} onClick={onClick}>
        Active
      </Chip>
    )
    expect(btn).toHaveAttribute('data-variant', 'danger')
    expect(btn).toHaveAttribute('aria-pressed', 'true')
  })

  it('renders an accessible remove button when onRemove is provided without nesting buttons', () => {
    const onRemove = vi.fn()
    const onClick = vi.fn()
    render(
      <Chip variant="attention" pressed={true} onClick={onClick} onRemove={onRemove} removeLabel="Remove tag">
        Needs review
      </Chip>
    )
    const toggle = screen.getByRole('button', { name: 'Needs review' })
    const remove = screen.getByRole('button', { name: 'Remove tag' })
    expect(toggle.contains(remove)).toBe(false)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(remove)
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('OXE-373 · SearchInput primitive', () => {
  it('updates value, shows clear button when non-empty, and clears on Escape or click', () => {
    const onChange = vi.fn()
    const onClear = vi.fn()
    const { rerender } = render(
      <SearchInput aria-label="Filter items" value="" onChange={onChange} onClear={onClear} />
    )
    const input = screen.getByRole('searchbox', { name: 'Filter items' })
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()

    fireEvent.change(input, { target: { value: 'mandacaru' } })
    expect(onChange).toHaveBeenCalledWith('mandacaru')

    rerender(
      <SearchInput aria-label="Filter items" value="mandacaru" onChange={onChange} onClear={onClear} />
    )
    const clearBtn = screen.getByRole('button', { name: 'Clear search' })
    fireEvent.click(clearBtn)
    expect(onChange).toHaveBeenLastCalledWith('')
    expect(onClear).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onChange).toHaveBeenLastCalledWith('')
    expect(onClear).toHaveBeenCalledTimes(2)
  })
})

describe('OXE-373 · Card primitive', () => {
  it('renders surface and padding data attributes and switches to button when interactive', () => {
    const onClick = vi.fn()
    const { container } = render(
      <>
        <Card surface="sunken" padding="lg">Static card</Card>
        <Card surface="base" padding="sm" interactive onClick={onClick}>Action card</Card>
      </>
    )
    const staticCard = container.querySelector('[data-surface="sunken"]')
    expect(staticCard).toHaveAttribute('data-ui', 'card')
    expect(staticCard).toHaveAttribute('data-padding', 'lg')
    expect(staticCard?.tagName).toBe('DIV')

    const actionCard = screen.getByRole('button', { name: 'Action card' })
    expect(actionCard).toHaveAttribute('data-surface', 'base')
    expect(actionCard).toHaveAttribute('data-padding', 'sm')
    expect(actionCard).toHaveAttribute('data-interactive', 'true')
    fireEvent.click(actionCard)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('OXE-373 · TooltipProvider shared and isolated fallback', () => {
  it('renders multiple tooltips under a shared TooltipProvider without error', () => {
    render(
      <TooltipProvider>
        <Tooltip content="First hint"><Button>One</Button></Tooltip>
        <Tooltip content="Second hint"><Button>Two</Button></Tooltip>
      </TooltipProvider>
    )
    expect(screen.getByRole('button', { name: 'One' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Two' })).toBeInTheDocument()
  })

  it('renders a standalone Tooltip in isolation via fallback provider without throwing', () => {
    render(<Tooltip content="Isolated hint"><Button>Solo</Button></Tooltip>)
    expect(screen.getByRole('button', { name: 'Solo' })).toBeInTheDocument()
  })
})

describe('OXE-373 · DesignSystemPage showcase', () => {
  it('renders canonical --tx-* and --bd-* color swatches instead of broken --text-*/--border-*', () => {
    render(<DesignSystemPage onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Color' }))

    expect(screen.getAllByText('--tx-primary').length).toBeGreaterThan(0)
    expect(screen.getAllByText('--bd-subtle').length).toBeGreaterThan(0)
    expect(screen.queryByText('--text-primary')).toBeNull()
    expect(screen.queryByText('--border-subtle')).toBeNull()
  })

  it('toggles density between compact and comfortable and exposes the 1.5.2 Primitives section', () => {
    render(<DesignSystemPage onClose={() => {}} />)
    const dialog = screen.getByRole('dialog', { name: 'Design system' })
    expect(dialog).toHaveAttribute('data-density', 'compact')

    fireEvent.click(screen.getByRole('radio', { name: 'Comfortable' }))
    expect(dialog).toHaveAttribute('data-density', 'comfortable')
    expect(document.documentElement.dataset.density).toBe('comfortable')

    fireEvent.click(screen.getByRole('button', { name: '1.5.2 Primitives' }))
    expect(screen.getByRole('heading', { level: 2, name: '1.5.2 Primitives' })).toBeInTheDocument()
    expect(screen.getAllByRole('searchbox', { name: 'Search primitives' }).length).toBeGreaterThan(0)
  })
})
