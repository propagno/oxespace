import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ViewportTooltip } from '../../src/components/common/ViewportTooltip'

describe('ViewportTooltip', () => {
  afterEach(() => vi.restoreAllMocks())

  test('portals outside a clipped pane and clamps itself to the right viewport edge', async () => {
    mockViewport(320, 200)
    mockRects(
      { bottom: 190, height: 20, left: 285, right: 305, top: 170, width: 20 },
      { bottom: 50, height: 50, left: 0, right: 220, top: 0, width: 220 }
    )
    const user = userEvent.setup()
    const { container } = render(
      <div style={{ overflow: 'hidden' }}>
        <ViewportTooltip ariaLabel="Usage details" content="Codex (Plus): semanal 14% · sessão 2%">
          14%
        </ViewportTooltip>
      </div>
    )

    await user.hover(screen.getByLabelText('Usage details'))
    const tooltip = await screen.findByRole('tooltip')

    expect(container.querySelector('[role="tooltip"]')).toBeNull()
    await waitFor(() => {
      expect(tooltip).toHaveStyle({ left: '92px', top: '111px', visibility: 'visible' })
    })
    expect(tooltip).toHaveAttribute('data-side', 'top')
    expect(tooltip.style.getPropertyValue('--viewport-tooltip-arrow-x')).toBe('203px')
  })

  test('flips below a top-edge anchor and supports focus plus Escape', async () => {
    mockViewport(360, 200)
    mockRects(
      { bottom: 24, height: 20, left: 12, right: 32, top: 4, width: 20 },
      { bottom: 40, height: 40, left: 0, right: 240, top: 0, width: 240 }
    )
    const user = userEvent.setup()
    render(
      <ViewportTooltip ariaLabel="Context details" content="A long context status message">
        ctx 80%
      </ViewportTooltip>
    )

    await user.tab()
    const tooltip = await screen.findByRole('tooltip')
    await waitFor(() => expect(tooltip).toHaveStyle({ left: '8px', top: '33px' }))
    expect(tooltip).toHaveAttribute('data-side', 'bottom')
    expect(screen.getByLabelText('Context details')).toHaveAttribute('aria-describedby', tooltip.id)

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})

function mockViewport(width: number, height: number): void {
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(width)
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(height)
}

function mockRects(anchor: Rect, tooltip: Rect): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return domRect(this.getAttribute('role') === 'tooltip' ? tooltip : anchor)
  })
}

interface Rect {
  bottom: number
  height: number
  left: number
  right: number
  top: number
  width: number
}

function domRect(rect: Rect): DOMRect {
  return {
    ...rect,
    x: rect.left,
    y: rect.top,
    toJSON: () => rect
  }
}
