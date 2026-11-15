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
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
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
  // Released 15/11 (coordination, BRD-12): the card's step titles, and no disabled button in a future step.
  test('three steps in order, and the conversation step waits for an agent with no dead button', async () => {
    await renderFirstRun([{ provider: 'claude', status: 'signed-out' }])
    const steps = [...document.querySelectorAll<HTMLElement>('[data-ui="first-run-step"]')]
    expect(steps).toHaveLength(3)
    for (const step of steps) expect(within(step).getAllByRole('heading')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'New conversation' })).toBeNull()
    expect(document.querySelectorAll('[data-ui="first-run-step"][data-state="next"] button:disabled')).toHaveLength(0)
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

  // Released 15/11 (coordination, BRD-12): one line with OxeCode and OxeQuery, no mode tiles.
  test('the line below the steps offers only OxeCode and OxeQuery', async () => {
    const props = await renderFirstRun([{ provider: 'claude', status: 'ready', model: 'Opus 5.5' }])
    const opens = ['OxeCode', 'OxeQuery'].map(name => screen.getAllByText(name).map(el => el.closest('a, button')).find(Boolean) as HTMLElement)
    expect(opens.every(Boolean)).toBe(true)
    expect(screen.queryByText(/OxeChat|OxePod|OxePost/)).toBeNull()
    await userEvent.click(opens[1])
    expect(props.onOpenMode).toHaveBeenCalledWith('data')
  })

  test('first run reads in pt-BR', async () => {
    await changeLanguage('pt-BR')
    await renderFirstRun([{ provider: 'claude', status: 'signed-out' }])
    // Released 15/11 (coordination, BRD-12): the card's pt-BR copy.
    for (const step of ['Pasta do projeto', 'Conectar um agente', 'Primeira conversa']) expect(screen.getByRole('heading', { name: step })).toBeInTheDocument()
    expect([...document.querySelectorAll('*')].some(el => (el.textContent ?? '').replace(/\s+/g, ' ').trim() === 'Ou abra o OxeCode ou o OxeQuery sozinhos')).toBe(true)
    expect(screen.getByText('Abre quando um agente estiver conectado')).toBeInTheDocument()
  })

  test('when the agent becomes ready after sign-in, focus goes to the next step, not nowhere', async () => {
    const { FirstRun } = await load<{ FirstRun: (props: Row) => JSX.Element }>('src/components/Onboarding/FirstRun')
    const props = { folder: '/repo/shop', onOpenFolder: vi.fn(), onSignIn: vi.fn(), onCancelSignIn: vi.fn(), onNewConversation: vi.fn(), onOpenMode: vi.fn() }
    const view = render(<FirstRun {...props} agents={[{ provider: 'claude', status: 'signing-in' }]} />)
    ;(document.activeElement as HTMLElement | null)?.blur()
    view.rerender(<FirstRun {...props} agents={[{ provider: 'claude', status: 'ready', model: 'Opus 5.5' }]} />)
    // Released 15/11 (coordination, BRD-12): the conversation step's heading, whatever its copy.
    const heading = within(document.querySelectorAll<HTMLElement>('[data-ui="first-run-step"]')[2]).getByRole('heading')
    const start = screen.getByRole('button', { name: 'New conversation' })
    await waitFor(() => expect([heading, start]).toContain(document.activeElement))
  })

})
