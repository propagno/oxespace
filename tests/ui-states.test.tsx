import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrandLoader, ErrorState, LoadingState, Skeleton, Spinner } from '../src/ui'
import { ErrorBoundary } from '../src/components/common/ErrorBoundary'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('state primitives', () => {
  it('ErrorState says what failed and why, keeps the detail folded and retries', () => {
    const retry = vi.fn()
    render(<ErrorState title="Could not load pull requests" message="GitHub did not answer." detail="HTTP 502" onRetry={retry} />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Could not load pull requests')
    expect(alert).toHaveTextContent('GitHub did not answer.')
    expect(screen.getByText('HTTP 502').closest('details')).not.toHaveAttribute('open')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledOnce()
  })

  it('Skeleton is announced once as loading and its bars are hidden from assistive technology', () => {
    render(<Skeleton lines={4} label="Loading branches" />)
    const status = screen.getByRole('status', { name: 'Loading branches' })
    expect(status.querySelectorAll('[aria-hidden="true"]')).toHaveLength(4)
  })

  it('Spinner is a labelled status, or hidden when the text next to it already says it', () => {
    const { container, rerender } = render(<Spinner label="Loading models" />)
    expect(screen.getByRole('status', { name: 'Loading models' })).toBeInTheDocument()
    rerender(<Spinner decorative size="sm" />)
    expect(screen.queryByRole('status')).toBeNull()
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('brand loader', () => {
  it('is a labelled status drawn from the mark, or hidden when decorative', () => {
    const { container, rerender } = render(<BrandLoader label="Loading OxePost" />)
    expect(screen.getByRole('status', { name: 'Loading OxePost' })).toBeInTheDocument()
    // The trunk, two sprouting arms and the sun.
    expect(container.querySelectorAll('path')).toHaveLength(3)
    expect(container.querySelector('circle')).not.toBeNull()
    rerender(<BrandLoader decorative />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('LoadingState brand shows the loader above the text and is announced once', () => {
    const { container } = render(<LoadingState brand label="Loading OxeQuery…" />)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Loading OxeQuery…')
    expect(container.querySelector('[data-brand-loader]')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getAllByRole('status')).toHaveLength(1)
  })
})

describe('ErrorBoundary', () => {
  it('keeps a crash inside its part of the app and recovers with Try again', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let crash = true
    function Child(): JSX.Element { if (crash) throw new Error('render failed'); return <p>Recovered</p> }
    render(<div><p>Outside</p><ErrorBoundary label="the panel"><Child /></ErrorBoundary></div>)
    expect(screen.getByText('Outside')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong while showing the panel.')
    expect(screen.getByText('render failed')).toBeInTheDocument()
    crash = false
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByText('Recovered')).toBeInTheDocument()
  })
})
