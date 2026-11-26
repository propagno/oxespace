import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { UsageModal, fmtReset, formatCheckedStamp, formatProviderError } from '../src/components/Usage/UsageModal'
import type { AgentCreditsSnapshot } from '../shared/types/agentCredits'
import { useAgentCreditsStore } from '../src/store/agentCredits.store'
import { changeLanguage } from '../src/i18n'

beforeEach(() => {
  useAgentCreditsStore.setState({ byProvider: {}, loading: {} })
})
afterEach(async () => {
  cleanup()
  delete (window as { oxe?: unknown }).oxe
  useAgentCreditsStore.setState({ byProvider: {}, loading: {} })
  await changeLanguage('en')
})

const snapshot = (source: AgentCreditsSnapshot['source'], overrides: Partial<AgentCreditsSnapshot> = {}): AgentCreditsSnapshot => ({
  provider: 'claude',
  available: true,
  installed: true,
  planLabel: null,
  display: { kind: 'session', usedPct: 40, resetsAtMs: null },
  source,
  windows: [{ kind: 'session', usedPct: 40, resetsAtMs: null }],
  observedAtMs: undefined,
  stale: false,
  error: null,
  ...overrides
})

describe('UsageModal', () => {
  it('names the account after its provider (G-06: Codex\'s quota said "Claude account") and syncs with useAgentCreditsStore', async () => {
    ;(window as unknown as { oxe: unknown }).oxe = {
      agentCredits: { get: async ({ provider }: { provider: AgentCreditsSnapshot['provider'] }) => snapshot('oauth', { provider }) },
      copilot: { credits: async () => null }
    }
    render(<UsageModal open onOpenChange={() => undefined} />)
    const codex = await screen.findByTestId('usage-card-codex')
    expect(await within(codex).findByText('Codex account')).toBeTruthy()
    expect(within(codex).queryByText(/Claude account/)).toBeNull()
    expect(within(screen.getByTestId('usage-card-claude')).getByText('Claude account')).toBeTruthy()
    expect(useAgentCreditsStore.getState().byProvider.codex?.provider).toBe('codex')
    expect(useAgentCreditsStore.getState().byProvider.claude?.provider).toBe('claude')
  })

  it('Antigravity has its own card, asked for by its own name; without a sign-in it says it was not detected', async () => {
    const asked: string[] = []
    ;(window as unknown as { oxe: unknown }).oxe = {
      agentCredits: { get: async ({ provider }: { provider: AgentCreditsSnapshot['provider'] }) => { asked.push(provider); return provider === 'antigravity' ? snapshot('oauth', { provider, planLabel: 'Google AI Ultra' }) : { provider, available: false, installed: false, planLabel: null, display: null, windows: [], error: null } } },
      copilot: { credits: async () => null }
    }
    render(<UsageModal open onOpenChange={() => undefined} />)
    const card = await screen.findByTestId('usage-card-antigravity')
    expect(await within(card).findByText('Antigravity account')).toBeTruthy()
    expect(within(card).getByText('Google AI Ultra')).toBeTruthy()
    expect(asked).toEqual(['claude', 'codex', 'antigravity'])
    expect(within(screen.getByTestId('usage-card-codex')).getByText('Not detected on this machine.')).toBeTruthy()
  })

  it('formats reset labels, past checked stamps and humanized errors in EN and PT-BR (OXE-439)', async () => {
    const now = Date.UTC(2026, 10, 25, 15, 0)
    expect(fmtReset({ kind: 'session', usedPct: 0, resetsAtMs: null }, false, now)).toBe('Quota available')
    expect(fmtReset({ kind: 'session', usedPct: 25, resetsAtMs: null }, false, now)).toBe('Reset time unknown')
    expect(fmtReset({ kind: 'session', usedPct: 5, resetsAtMs: now - 60_000 }, true, now)).toBe('Window ended')
    expect(fmtReset({ kind: 'session', usedPct: 5, resetsAtMs: now - 60_000 }, false, now)).toBe('Resetting')

    expect(formatCheckedStamp(now - 13 * 86_400_000, now)).toContain('13d ago')
    expect(formatProviderError('usage endpoint 429', now + 5 * 60_000, now)).toBe('Rate limit reached — retrying in ~5m.')
    expect(formatProviderError('oauth_expired', null, now)).toBe('Session expired — run claude to sign in again.')

    await changeLanguage('pt-BR')
    expect(fmtReset({ kind: 'session', usedPct: 0, resetsAtMs: null }, false, now)).toBe('Cota disponível')
    expect(fmtReset({ kind: 'session', usedPct: 5, resetsAtMs: now - 60_000 }, true, now)).toBe('Janela encerrada')
    expect(formatCheckedStamp(now - 13 * 86_400_000, now)).toContain('há 13 d')
    expect(formatProviderError('usage endpoint 429', now + 5 * 60_000, now)).toBe('Limite de consultas atingido — nova tentativa em ~5 min.')
    expect(formatProviderError('oauth_expired', null, now)).toBe('Sessão expirada — execute claude para renovar o login.')
  })

  it('shows official icons, keeps planLabel beside Last known reading, humanizes 429/expired/local copy and Antigravity hint (OXE-439)', async () => {
    const now = Date.now()
    ;(window as unknown as { oxe: unknown }).oxe = {
      agentCredits: {
        get: async ({ provider }: { provider: AgentCreditsSnapshot['provider'] }) => {
          if (provider === 'claude') {
            return snapshot('oauth', {
              provider: 'claude',
              available: false,
              planLabel: 'max',
              windows: [],
              display: null,
              error: 'usage endpoint 429',
              retryAtMs: now + 4 * 60_000
            })
          }
          if (provider === 'codex') {
            return snapshot('local-session', {
              provider: 'codex',
              available: false,
              planLabel: 'free',
              windows: [],
              display: null,
              observedAtMs: now - 13 * 86_400_000,
              windowsExpired: true
            })
          }
          return snapshot('oauth', {
            provider: 'antigravity',
            planLabel: 'Google AI Ultra',
            stale: true,
            observedAtMs: now - 10 * 60_000,
            geminiWeeklyUnavailable: true,
            windows: [{ kind: 'session', usedPct: 0, resetsAtMs: null, group: 'gemini' }]
          })
        }
      },
      copilot: { credits: async () => ({ installed: true, plan: 'Pro', error: null, credits: null }) }
    }

    render(<UsageModal open onOpenChange={() => undefined} />)

    const claudeCard = await screen.findByTestId('usage-card-claude')
    expect(await within(claudeCard).findByText(/Rate limit reached — retrying in ~4m/)).toBeTruthy()
    expect(within(claudeCard).queryByText(/usage endpoint 429/)).toBeNull()
    expect(claudeCard.querySelector('[data-provider="claude"]')).toBeTruthy()

    const codexCard = screen.getByTestId('usage-card-codex')
    expect(within(codexCard).getByText('free')).toBeTruthy()
    expect(within(codexCard).getByText('Quota reset since your last local session.')).toBeTruthy()
    expect(codexCard.textContent).toContain('13d ago')
    expect(codexCard.querySelector('[data-provider="codex"]')).toBeTruthy()

    const agCard = screen.getByTestId('usage-card-antigravity')
    expect(within(agCard).getByText('Google AI Ultra')).toBeTruthy()
    expect(within(agCard).getByText('Last known reading')).toBeTruthy()
    expect(within(agCard).getByText('Quota available')).toBeTruthy()
    expect(within(agCard).getByText('Gemini weekly limit is currently only reported in agy /usage.')).toBeTruthy()
    expect(agCard.querySelector('[data-provider="antigravity"]')).toBeTruthy()

    const copilotCard = screen.getByTestId('usage-card-copilot')
    expect(copilotCard.querySelector('[data-provider="copilot"]')).toBeTruthy()
  })

  it('shows honest local-session stale copy instead of "Could not refresh" for active local Codex readings', async () => {
    const now = Date.now()
    ;(window as unknown as { oxe: unknown }).oxe = {
      agentCredits: {
        get: async ({ provider }: { provider: AgentCreditsSnapshot['provider'] }) => {
          if (provider === 'codex') {
            return snapshot('local-session', {
              provider: 'codex',
              planLabel: 'plus',
              stale: true,
              observedAtMs: now - 2 * 3_600_000,
              windows: [{ kind: 'weekly', usedPct: 12, resetsAtMs: now + 3 * 86_400_000 }]
            })
          }
          return { provider, available: false, installed: false, planLabel: null, display: null, windows: [], error: null }
        }
      },
      copilot: { credits: async () => null }
    }
    render(<UsageModal open onOpenChange={() => undefined} />)
    const codexCard = await screen.findByTestId('usage-card-codex')
    expect(await within(codexCard).findByText('Showing usage from your last local Codex session.')).toBeTruthy()
    expect(within(codexCard).queryByText(/Could not refresh/)).toBeNull()
  })
})
