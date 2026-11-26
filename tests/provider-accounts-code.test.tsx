import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ProviderAccountsPanel } from '../src/components/Threads/ProviderAccountsPanel'
import { useAccountStore } from '../src/store/account.store'
import { i18n } from '../src/i18n'
import type { AgentAccountContext, AgentAccountSnapshot } from '../shared/types/agentAuth'

const tt = (key: string): string => i18n.t(key, { ns: 'thread' }) as string

function installAccountMock(
  snapshotsByProvider: Partial<Record<AgentAccountContext['provider'], Partial<AgentAccountSnapshot>>>,
  submitCode = vi.fn(async () => undefined)
) {
  Object.assign(window, {
    oxe: {
      ...(window as unknown as { oxe?: object }).oxe,
      agentAccount: {
        read: async (context: AgentAccountContext): Promise<AgentAccountSnapshot> => ({
          provider: context.provider,
          scopeId: `scope-${context.provider}`,
          state: 'signed-out',
          method: 'unknown',
          checkedAt: 1,
          ...snapshotsByProvider[context.provider]
        }),
        login: async () => undefined,
        logout: async () => undefined,
        cancel: async () => undefined,
        openBrowser: async () => undefined,
        submitCode,
        onChanged: () => () => undefined
      }
    }
  })
  return submitCode
}

beforeEach(() => {
  useAccountStore.setState({ scopes: {}, snapshots: {} })
})
afterEach(cleanup)

describe('OXE-419 · ProviderAccountsPanel manual and automatic sign-in code entry', () => {
  test('offers a manual paste-code toggle for Antigravity and Claude during awaiting-browser, but not Codex', async () => {
    const submitCode = installAccountMock({
      antigravity: { state: 'awaiting-browser', attemptId: 'att-agy', canOpenBrowser: true },
      claude: { state: 'awaiting-browser', attemptId: 'att-claude', canOpenBrowser: true },
      codex: { state: 'awaiting-browser', attemptId: 'att-codex', canOpenBrowser: true }
    })

    render(<ProviderAccountsPanel workspaceId="ws-1" onClose={() => undefined} />)

    const agyCard = (await screen.findByText('Antigravity')).closest('.thread-account-card') as HTMLElement
    const claudeCard = screen.getByText('Claude Code').closest('.thread-account-card') as HTMLElement
    const codexCard = screen.getByText('Codex').closest('.thread-account-card') as HTMLElement

    const toggleLabel = tt('accounts.pasteCodeToggle')
    const agyToggle = await within(agyCard).findByRole('button', { name: toggleLabel })
    expect(within(claudeCard).getByRole('button', { name: toggleLabel })).toBeVisible()
    expect(within(codexCard).queryByRole('button', { name: toggleLabel })).toBeNull()
    expect(agyCard.querySelector('.thread-auth-code')).toBeNull()

    fireEvent.click(agyToggle)
    const form = agyCard.querySelector('.thread-auth-code') as HTMLFormElement
    expect(form).not.toBeNull()
    const input = within(form).getByLabelText(tt('accounts.code')) as HTMLInputElement
    expect(input.type).toBe('password')

    fireEvent.change(input, { target: { value: '   ' } })
    expect(within(form).getByRole('button', { name: tt('accounts.continue') })).toBeDisabled()

    fireEvent.change(input, { target: { value: '4/0A-agy-code' } })
    fireEvent.click(within(form).getByRole('button', { name: tt('accounts.continue') }))

    await waitFor(() => expect(submitCode).toHaveBeenCalledWith('att-agy', '4/0A-agy-code'))
    await waitFor(() => expect(input.value).toBe(''))

    // Ending the attempt resets the manual toggle state.
    act(() => {
      useAccountStore.getState().changed({
        provider: 'antigravity',
        scopeId: 'scope-antigravity',
        state: 'connected',
        method: 'subscription',
        checkedAt: 2
      })
    })
    await waitFor(() => expect(agyCard.querySelector('.thread-auth-code')).toBeNull())
  })

  test('renders the code form immediately when Antigravity transitions to awaiting-code', async () => {
    const submitCode = installAccountMock({
      antigravity: { state: 'awaiting-code', attemptId: 'att-agy-2', canOpenBrowser: true }
    })

    render(<ProviderAccountsPanel workspaceId="ws-1" onClose={() => undefined} />)

    const agyCard = (await screen.findByText('Antigravity')).closest('.thread-account-card') as HTMLElement
    const input = (await within(agyCard).findByLabelText(tt('accounts.code'))) as HTMLInputElement
    expect(within(agyCard).queryByRole('button', { name: tt('accounts.pasteCodeToggle') })).toBeNull()

    fireEvent.change(input, { target: { value: '4/0A-auto-code' } })
    fireEvent.click(within(agyCard).getByRole('button', { name: tt('accounts.continue') }))

    await waitFor(() => expect(submitCode).toHaveBeenCalledWith('att-agy-2', '4/0A-auto-code'))
  })
})
