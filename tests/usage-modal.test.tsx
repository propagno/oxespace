import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { UsageModal } from '../src/components/Usage/UsageModal'
import type { AgentCreditsSnapshot } from '../shared/types/agentCredits'

afterEach(() => { cleanup(); delete (window as { oxe?: unknown }).oxe })

const snapshot = (source: AgentCreditsSnapshot['source']): AgentCreditsSnapshot => ({
  installed: true, source, windows: [{ kind: 'session', usedPct: 40, resetsAtMs: null }], observedAtMs: null, stale: false
} as unknown as AgentCreditsSnapshot)

describe('UsageModal', () => {
  it('names the account after its provider (G-06: Codex\'s quota said "Claude account")', async () => {
    ;(window as unknown as { oxe: unknown }).oxe = {
      agentCredits: { get: async () => snapshot('oauth') },
      copilot: { credits: async () => null }
    }
    render(<UsageModal open onOpenChange={() => undefined} />)
    const codex = await screen.findByTestId('usage-card-codex')
    expect(await within(codex).findByText('Codex account')).toBeTruthy()
    expect(within(codex).queryByText(/Claude account/)).toBeNull()
    expect(within(screen.getByTestId('usage-card-claude')).getByText('Claude account')).toBeTruthy()
  })

  it('Antigravity has its own card, asked for by its own name; without a sign-in it says it was not detected', async () => {
    const asked: string[] = []
    ;(window as unknown as { oxe: unknown }).oxe = {
      agentCredits: { get: async ({ provider }: { provider: string }) => { asked.push(provider); return provider === 'antigravity' ? { ...snapshot('oauth'), planLabel: 'Google AI Ultra' } : { installed: false, windows: [] } } },
      copilot: { credits: async () => null }
    }
    render(<UsageModal open onOpenChange={() => undefined} />)
    const card = await screen.findByTestId('usage-card-antigravity')
    expect(await within(card).findByText('Antigravity account')).toBeTruthy()
    expect(within(card).getByText('Google AI Ultra')).toBeTruthy()
    expect(asked).toEqual(['claude', 'codex', 'antigravity'])
    expect(within(screen.getByTestId('usage-card-codex')).getByText('Not detected on this machine.')).toBeTruthy()
  })
})
