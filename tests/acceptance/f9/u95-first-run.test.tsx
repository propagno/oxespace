// Frozen acceptance test for 1.5.0 A1 and A34's first run on screen (DESIGN U9.5, OXE program, phase F9, task
// FE-A1). Written by the planner; the executor must not edit it.
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
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { changeLanguage } from '../../../src/i18n'

type Row = Record<string, unknown>
async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => join(process.cwd(), `${rel}${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}
async function renderFirstRun(agents: Row[], folder: string | null = '/repo/shop') {
  const { FirstRun } = await load<{ FirstRun: (props: Row) => JSX.Element }>('src/components/Onboarding/FirstRun')
  const props = { folder, agents, onOpenFolder: vi.fn(), onSignIn: vi.fn(), onCancelSignIn: vi.fn(), onNewConversation: vi.fn(), onOpenMode: vi.fn() }
  render(<FirstRun {...props} />)
  return props
}

afterEach(async () => { cleanup(); await changeLanguage('en') })

describe('U9.5 · First run', () => {
  test('three steps in order, and New conversation waits for an agent with its reason', async () => {
    await renderFirstRun([{ provider: 'claude', status: 'signed-out' }])
    for (const step of ['Open a project folder', 'Connect an agent', 'Start your first conversation']) expect(screen.getByRole('heading', { name: step })).toBeInTheDocument()
    const start = screen.getByRole('button', { name: 'New conversation' })
    expect(start).toBeDisabled()
    expect(start.getAttribute('title') ?? start.getAttribute('aria-description') ?? document.getElementById(start.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Connect an agent first')
  })

  test('signing in waits in the browser with Cancel; once ready it shows the model and New conversation starts', async () => {
    const waiting = await renderFirstRun([{ provider: 'claude', status: 'signing-in' }])
    expect(screen.getByText('Waiting for sign-in in your browser…')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(waiting.onCancelSignIn).toHaveBeenCalledWith('claude')
    cleanup()
    const ready = await renderFirstRun([{ provider: 'claude', status: 'ready', model: 'Opus 5.5' }])
    expect(screen.getByText('Ready · Opus 5.5')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'New conversation' }))
    expect(ready.onNewConversation).toHaveBeenCalledTimes(1)
  })

  test('a missing CLI offers How to install, and Sign in starts the sign-in', async () => {
    const props = await renderFirstRun([{ provider: 'codex', status: 'missing' }, { provider: 'claude', status: 'signed-out' }])
    expect(screen.getByText(/How to install/).closest('a, button')).not.toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /^Sign in/ }))
    expect(props.onSignIn).toHaveBeenCalledWith('claude')
  })

  test('"Or open a mode on its own" offers only OxeCode and OxeQuery', async () => {
    const props = await renderFirstRun([{ provider: 'claude', status: 'ready', model: 'Opus 5.5' }])
    expect(screen.getByText('Or open a mode on its own')).toBeInTheDocument()
    const tiles = screen.getAllByRole('button').filter(button => /^(OxeCode|OxeQuery|OxeChat|OxePod|OxePost)/.test(button.textContent?.trim() ?? ''))
    expect(tiles.map(tile => tile.textContent?.trim().split(/\s/)[0])).toEqual(['OxeCode', 'OxeQuery'])
    await userEvent.click(tiles[1])
    expect(props.onOpenMode).toHaveBeenCalledWith('data')
  })

  test('first run reads in pt-BR', async () => {
    await changeLanguage('pt-BR')
    await renderFirstRun([{ provider: 'claude', status: 'signed-out' }])
    for (const step of ['Abra uma pasta de projeto', 'Conecte um agente', 'Comece sua primeira conversa']) expect(screen.getByRole('heading', { name: step })).toBeInTheDocument()
    expect(screen.getByText('Ou abra um modo sozinho')).toBeInTheDocument()
    const start = screen.getByRole('button', { name: 'Nova conversa' })
    expect(start.getAttribute('title') ?? start.getAttribute('aria-description') ?? document.getElementById(start.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Conecte um agente primeiro')
  })

  test('when the agent becomes ready after sign-in, focus goes to the next step, not nowhere', async () => {
    const { FirstRun } = await load<{ FirstRun: (props: Row) => JSX.Element }>('src/components/Onboarding/FirstRun')
    const props = { folder: '/repo/shop', onOpenFolder: vi.fn(), onSignIn: vi.fn(), onCancelSignIn: vi.fn(), onNewConversation: vi.fn(), onOpenMode: vi.fn() }
    const view = render(<FirstRun {...props} agents={[{ provider: 'claude', status: 'signing-in' }]} />)
    ;(document.activeElement as HTMLElement | null)?.blur()
    view.rerender(<FirstRun {...props} agents={[{ provider: 'claude', status: 'ready', model: 'Opus 5.5' }]} />)
    const heading = screen.getByRole('heading', { name: 'Start your first conversation' })
    const start = screen.getByRole('button', { name: 'New conversation' })
    await waitFor(() => expect([heading, start]).toContain(document.activeElement))
  })

})
