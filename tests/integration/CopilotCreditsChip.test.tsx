import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { CopilotCredits } from '../../shared/types/copilot'
import { CopilotCreditsChip } from '../../src/components/Sidebar/CopilotCreditsChip'
import { useCopilotCreditsStore } from '../../src/store/copilotCredits.store'

function mockCredits(credits: CopilotCredits | null): void {
  ;(window as unknown as { oxe: { copilot: { credits: ReturnType<typeof vi.fn> } } }).oxe = {
    copilot: { credits: vi.fn().mockResolvedValue(credits ?? undefined) }
  } as never
  useCopilotCreditsStore.setState({ credits, loading: false })
}

const BUSINESS: CopilotCredits = {
  available: true,
  installed: true,
  plan: 'business',
  sku: 'copilot_for_business_seat',
  premium: { usedPct: 23, remaining: 231, entitlement: 300, unlimited: false, overagePermitted: true },
  resetDate: '2026-07-01',
  tokenBasedBilling: true,
  error: null
}

describe('CopilotCreditsChip', () => {
  beforeEach(() => useCopilotCreditsStore.setState({ credits: null, loading: false }))

  test('renders the premium-credits used% when available', () => {
    mockCredits(BUSINESS)
    render(<CopilotCreditsChip />)
    expect(screen.getByText('23%')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Copilot credits 23% usado/i })).toBeInTheDocument()
  })

  test('renders a muted plan pill (no % bar) when there is no premium allowance (free plan)', () => {
    mockCredits({ ...BUSINESS, plan: 'individual', premium: { usedPct: 0, remaining: 0, entitlement: 0, unlimited: false, overagePermitted: false } })
    render(<CopilotCreditsChip />)
    // Visible + names the plan, but no premium "%" readout.
    expect(screen.getByText('individual')).toBeInTheDocument()
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument()
  })

  test('compact rail pip hides when there is no premium allowance', () => {
    mockCredits({ ...BUSINESS, plan: 'individual', premium: { usedPct: 0, remaining: 0, entitlement: 0, unlimited: false, overagePermitted: false } })
    const { container } = render(<CopilotCreditsChip compact />)
    expect(container).toBeEmptyDOMElement()
  })

  test('renders nothing when gh is unavailable', () => {
    mockCredits({ available: false, installed: false, plan: null, sku: null, premium: null, resetDate: null, tokenBasedBilling: false, error: null })
    const { container } = render(<CopilotCreditsChip />)
    expect(container).toBeEmptyDOMElement()
  })
})
