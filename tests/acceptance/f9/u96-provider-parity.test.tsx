// Frozen acceptance test for 1.5.0 A64 on screen (DESIGN U9.6, OXE program, phase F9, task
// FE-A64). Written by the planner; the executor must not edit it.
// Spec: .claude/roadmap-1.4/team/plans/1.5.0-f9-design.md (U9.5, U9.6 and the 08/11 update).
// Contract (BACKEND #721 @ f2d713da §A64): ThreadCapabilityManifest.features gains fork, branch, alwaysAllowBeyondSession,
// paneConversation and effort ({ enabled, messageCode? }); shared/provider-parity has PARITY_FEATURES and
// parityFor(provider, feature) → { available: true } | { available: false, refusal: { code: 'parity.notAvailable', params:
// { provider } } }. The renderer parts:
// - FirstRun({ folder, agents: [{ provider, status: 'ready' | 'missing' | 'signed-out' | 'signing-in', model? }],
//   onOpenFolder(), onSignIn(provider), onCancelSignIn(provider), onNewConversation(), onOpenMode(mode) }) in
//   src/components/Onboarding/FirstRun.tsx;
// - parityState({ manifest?, provider }, feature) → { enabled, reason } and ParityButton({ manifest?, provider, feature,
//   onClick, children }) in src/components/Threads/parity.tsx: disabled, never hidden, the reason as tooltip and
//   accessible description. U9.6a (a Claude and a Codex conversation side by side, every case) is the e2e run.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { changeLanguage } from '../../../src/i18n'

type Row = Record<string, unknown>
async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => join(process.cwd(), `${rel}${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}
const CODEX_MANIFEST = {
  provider: 'codex', platform: 'win32', authentication: 'subscription',
  features: { branch: { enabled: false, availability: 'unsupported', authorized: true, implemented: false, messageCode: { code: 'parity.notAvailable', params: { provider: 'Codex' } } }, fork: { enabled: true, availability: 'available', authorized: true, implemented: true } }
}

afterEach(async () => { cleanup(); await changeLanguage('en') })

describe('U9.6 · Provider parity', () => {
  test("parity is read from the conversation's manifest, and without one from the shared table, never from the provider name alone", async () => {
    const { parityState } = await load<{ parityState: (source: { manifest?: unknown; provider: string }, feature: string) => { enabled: boolean; reason: string | null } }>('src/components/Threads/parity')
    expect(parityState({ manifest: CODEX_MANIFEST, provider: 'codex' }, 'branch')).toEqual({ enabled: false, reason: 'Not available in Codex' })
    expect(parityState({ manifest: CODEX_MANIFEST, provider: 'codex' }, 'fork')).toEqual({ enabled: true, reason: null })
    expect(parityState({ provider: 'codex' }, 'alwaysAllowBeyondSession')).toEqual({ enabled: false, reason: 'Not available in Codex' })
    expect(parityState({ provider: 'claude' }, 'branch')).toEqual({ enabled: true, reason: null })
    // The manifest wins: a Codex build that can branch is enabled whatever the table says.
    const canBranch = { ...CODEX_MANIFEST, features: { ...CODEX_MANIFEST.features, branch: { enabled: true, availability: 'available', authorized: true, implemented: true } } }
    expect(parityState({ manifest: canBranch, provider: 'codex' }, 'branch')).toEqual({ enabled: true, reason: null })
  })

  test('an unsupported feature stays visible and disabled, with the reason as its tooltip and accessible description', async () => {
    const { ParityButton } = await load<{ ParityButton: (props: Row) => JSX.Element }>('src/components/Threads/parity')
    const onClick = vi.fn()
    render(<><ParityButton manifest={CODEX_MANIFEST} provider="codex" feature="branch" onClick={onClick}>Branch</ParityButton><ParityButton provider="claude" feature="branch" onClick={onClick}>Branch here</ParityButton></>)
    const codex = screen.getByRole('button', { name: 'Branch' })
    expect(codex).toBeDisabled()
    expect(codex).toHaveAccessibleDescription('Not available in Codex')
    expect(codex.getAttribute('title') ?? codex.closest('[title]')?.getAttribute('title')).toBe('Not available in Codex')
    const claude = screen.getByRole('button', { name: 'Branch here' })
    expect(claude).toBeEnabled()
    await userEvent.click(claude)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  test('the parity reason reads in pt-BR', async () => {
    await changeLanguage('pt-BR')
    const { parityState } = await load<{ parityState: (source: { manifest?: unknown; provider: string }, feature: string) => { enabled: boolean; reason: string | null } }>('src/components/Threads/parity')
    expect(parityState({ provider: 'codex' }, 'branch')).toEqual({ enabled: false, reason: 'Indisponível no Codex' })
  })
})
