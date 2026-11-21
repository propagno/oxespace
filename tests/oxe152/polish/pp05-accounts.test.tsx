// Frozen acceptance test for 1.5.2 Polimento 2 (Jira OXE-268, PP-05·13, CA-2; A11). Written by the planner; the executor
// must not edit it. A state never rests on a lone decorative icon (RN-2): on main f65fa5374 a connected account card
// (src/components/Threads/ProviderAccountsPanel.tsx) shows a bare lucide <Check size={16} /> with no name, and
// ThreadView.css pads the card 15px 16px with 10px gaps, off the 4 px scale.
// Contract: a connected (subscription) account shows the src/ui Badge with intent="success" and the new catalog text
// thread:accounts.connected ("Conectada" / "Connected"), no bare check icon; every ThreadView.css rule on
// .thread-account-card pads it with var(--space-4) and spaces it with var(--space-2), never 15px nor 10px.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { ProviderAccountsPanel } from '../../../src/components/Threads/ProviderAccountsPanel'
import { Badge } from '../../../src/ui'
import { useAccountStore } from '../../../src/store/account.store'
import { i18n } from '../../../src/i18n'
import type { AgentAccountContext } from '../../../shared/types/agentAuth'

const tt = (key: string): string => i18n.t(key, { ns: 'thread' }) as string
const CSS = readFileSync(join(process.cwd(), 'src/components/Threads/ThreadView.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
/** The declarations of every rule whose selector mentions .thread-account-card. */
const cardRules = (): Array<{ selector: string; body: string }> => [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(match => ({ selector: match[1].trim(), body: match[2] })).filter(rule => rule.selector.includes('.thread-account-card'))
const decl = (body: string, property: string): string | undefined => body.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`))?.[1].trim()

beforeEach(() => {
  useAccountStore.setState({ scopes: {}, snapshots: {} })
  Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, agentAccount: {
    read: async (context: AgentAccountContext) => context.provider === 'claude'
      ? { provider: 'claude', scopeId: `scope-${context.provider}`, state: 'connected', method: 'subscription', checkedAt: 1, accountLabel: 'dev@example.com' }
      : { provider: context.provider, scopeId: `scope-${context.provider}`, state: 'disconnected', method: 'unknown', checkedAt: 1 },
    login: async () => undefined, logout: async () => undefined, cancel: async () => undefined, openBrowser: async () => undefined, submitCode: async () => undefined, onChanged: () => () => undefined
  } } })
})
afterEach(cleanup)

describe('OXE-268 · PP-05·13 a connected account says so in words', () => {
  test('[css] connected account renders Badge intent="success" with text and .thread-account-card uses --space-4 padding and --space-2 spacing', async () => {
    const reference = [...render(<Badge intent="success">x</Badge>).container.firstElementChild!.classList]
    cleanup()
    render(<ProviderAccountsPanel workspaceId="ws-1" onClose={() => undefined} />)
    const connectedText = tt('accounts.connected')
    expect(connectedText, 'thread:accounts.connected exists').not.toBe('accounts.connected')
    const badge = await screen.findByText(connectedText)
    const card = badge.closest('.thread-account-card') as HTMLElement
    expect(card, 'the badge is in an account card').not.toBeNull()
    for (const name of reference) expect(badge.closest('span')!.classList.contains(name), `the success Badge class ${name}`).toBe(true)
    // No bare decorative check: the words carry the state.
    expect(card.querySelector('svg.lucide-check')).toBeNull()
    await waitFor(() => expect(screen.getAllByText(connectedText)).toHaveLength(1))
    expect(within(card).getByText(connectedText)).toBeVisible()

    const rules = cardRules()
    expect(rules.length).toBeGreaterThan(0)
    for (const { selector, body } of rules) {
      expect(body, `${selector} has no 15px or 10px`).not.toMatch(/\b(?:15|10)px\b/)
      if (/\.thread-account-card$/.test(selector.split(',').at(-1)!.trim())) {
        const padding = decl(body, 'padding')
        if (padding !== undefined) expect(padding, `${selector} padding`).toBe('var(--space-4)')
        for (const property of ['margin-bottom', 'gap']) {
          const value = decl(body, property)
          if (value !== undefined) expect(value, `${selector} ${property}`).toBe('var(--space-2)')
        }
      }
    }
    expect(rules.some(rule => decl(rule.body, 'padding') === 'var(--space-4)'), 'the card is padded with --space-4').toBe(true)
  })
})
