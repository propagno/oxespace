import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrandLoader, ErrorState, FieldError, LoadingState, Notice, OfflineState, Skeleton, Spinner, SuccessState } from '../src/ui'
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

describe('success, offline and notices', () => {
  it('SuccessState says what was done, politely, with what to do next', () => {
    render(<SuccessState title="Worktree created" message="It is ready in its own folder." actions={<button type="button">Open it</button>} />)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Worktree created')
    expect(status).toHaveTextContent('It is ready in its own folder.')
    expect(screen.getByRole('button', { name: 'Open it' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('OfflineState has translated defaults, waits with the brand loader and checks again', () => {
    const retry = vi.fn()
    const { container, rerender } = render(<OfflineState onRetry={retry} />)
    expect(screen.getByRole('status')).toHaveTextContent('You are offline')
    expect(container.querySelector('[data-brand-loader]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(retry).toHaveBeenCalledOnce()
    rerender(<OfflineState compact />)
    expect(container.querySelector('[data-brand-loader]')).toBeNull()
    expect(screen.getByRole('status')).not.toHaveTextContent('comes back by itself')
  })

  it('Notice interrupts only for a warning or a failure', () => {
    const { rerender } = render(<Notice intent="warning" title="2 worktrees have changes">Removing them discards them.</Notice>)
    expect(screen.getByRole('alert')).toHaveTextContent('2 worktrees have changes')
    rerender(<Notice intent="danger">Could not apply the policy.</Notice>)
    expect(screen.getByRole('alert')).toHaveTextContent('Could not apply the policy.')
    rerender(<Notice intent="info">Agents use your shell profile.</Notice>)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Agents use your shell profile.')
  })

  it('FieldError is announced and can be pointed at by its control', () => {
    render(<><textarea aria-label="Filter" aria-invalid aria-describedby="filter-error" /><FieldError id="filter-error">Not valid JSON.</FieldError></>)
    expect(screen.getByRole('alert')).toHaveTextContent('Not valid JSON.')
    expect(screen.getByLabelText('Filter')).toHaveAccessibleDescription('Not valid JSON.')
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

  it('carries the brand mark, and at the root covers the window with a way to reload', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const reload = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload })
    function Child(): JSX.Element { throw new Error('render failed') }
    const { container } = render(<ErrorBoundary page label="OXESpace"><Child /></ErrorBoundary>)
    expect(container.querySelector('.error-boundary-page')).not.toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent('OXESpace could not show this window.')
    expect(screen.getByRole('alert').querySelector('svg')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Reload window' }))
    expect(reload).toHaveBeenCalledOnce()
  })
})
