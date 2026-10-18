import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThreadDeliveryNote } from '../src/components/Threads/ThreadDeliveryNote'

describe('ThreadDeliveryNote', () => {
  it('stays silent for delivered messages', () => {
    const { container } = render(<ThreadDeliveryNote delivery={{ state: 'delivered', updatedAt: 1 }} disabled={false} onResend={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows progress without offering a resend', () => {
    render(<ThreadDeliveryNote delivery={{ state: 'sending', updatedAt: 1 }} disabled={false} onResend={() => {}} />)
    expect(screen.getByRole('status')).toHaveTextContent('Sending…')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('says an unconfirmed message may not have arrived and lets the user decide', () => {
    const onResend = vi.fn()
    render(<ThreadDeliveryNote delivery={{ state: 'unconfirmed', error: 'the app closed', updatedAt: 1 }} disabled={false} onResend={onResend} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Not confirmed')
    expect(screen.getByRole('alert')).toHaveTextContent('the app closed')
    fireEvent.click(screen.getByRole('button', { name: 'Send again' }))
    expect(onResend).toHaveBeenCalledTimes(1)
  })

  it('reports a rejected message with its reason and disables resend while busy', () => {
    render(<ThreadDeliveryNote delivery={{ state: 'rejected', error: 'Sign in again', updatedAt: 1 }} disabled onResend={() => {}} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Not sent: Sign in again')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDisabled()
  })
})
