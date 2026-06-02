import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { CopilotCredits } from '../../shared/types/copilot'
import { CopilotCreditsStatus } from '../../src/components/Terminal/CopilotCreditsStatus'
import { useCopilotCreditsStore } from '../../src/store/copilotCredits.store'

function mockCredits(credits: CopilotCredits | null): void {
  ;(window as unknown as { oxe: { copilot: { credits: ReturnType<typeof vi.fn> } } }).oxe = {
    copilot: { credits: vi.fn().mockResolvedValue(credits ?? undefined) }
  } as never
  useCopilotCreditsStore.setState({ credits, loading: false })
}

const BASE: CopilotCredits = {
  available: true,
  installed: true,
  plan: 'business',
  sku: 'copilot_for_business_seat',
  credits: null,
  resetDate: '2026-07-01',
  tokenBasedBilling: true,
  error: null
}

describe('CopilotCreditsStatus', () => {
  beforeEach(() => useCopilotCreditsStore.setState({ credits: null, loading: false }))

  test('paid plan: shows AI credits used out of the allowance', () => {
    // 23% used of 300 → 69 used.
    mockCredits({ ...BASE, credits: { usedPct: 23, remaining: 231, entitlement: 300, unlimited: false, overagePermitted: true } })
    render(<CopilotCreditsStatus />)
    expect(screen.getByText('69/300')).toBeInTheDocument()
  })

  test('free plan: shows the 200 AI-credits allowance (not the 2000 completions)', () => {
    mockCredits({ ...BASE, plan: 'individual', credits: { usedPct: 0, remaining: 200, entitlement: 200, unlimited: false, overagePermitted: false } })
    render(<CopilotCreditsStatus />)
    expect(screen.getByText('0/200')).toBeInTheDocument()
  })

  test('shows fractional credits used (matches the Copilot CLI 18.8 figure)', () => {
    // remaining 180.8 of 200 → 19.2 used.
    mockCredits({ ...BASE, plan: 'individual', credits: { usedPct: 10, remaining: 180.8, entitlement: 200, unlimited: false, overagePermitted: false } })
    render(<CopilotCreditsStatus />)
    expect(screen.getByText('19.2/200')).toBeInTheDocument()
  })

  test('no allowance reported: falls back to a muted plan label', () => {
    mockCredits({ ...BASE, plan: 'individual', credits: { usedPct: 0, remaining: 0, entitlement: 0, unlimited: false, overagePermitted: false } })
    render(<CopilotCreditsStatus />)
    expect(screen.getByText('individual')).toBeInTheDocument()
  })

  test('renders nothing when Copilot is unreachable', () => {
    mockCredits({ ...BASE, available: false })
    const { container } = render(<CopilotCreditsStatus />)
    expect(container).toBeEmptyDOMElement()
  })

  test('is a passive indicator, not a button', () => {
    mockCredits({ ...BASE, credits: { usedPct: 23, remaining: 231, entitlement: 300, unlimited: false, overagePermitted: false } })
    render(<CopilotCreditsStatus />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
