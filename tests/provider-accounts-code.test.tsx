import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ProviderAccountsPanel } from '../src/components/Threads/ProviderAccountsPanel'
import { resolveAccountWorkspaceId } from '../src/app/useAppThread'
import { useAccountStore } from '../src/store/account.store'
import { useThreadStore } from '../src/store/thread.store'
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
  useThreadStore.setState({ snapshot: null } as never)
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

describe('OXE-435 · ProviderAccountsPanel error handling, stale error clearing, and workspace resolution', () => {
  test('displays humanized IPC error messages, falls back on empty errors, and clears stale errors when checkedAt updates', async () => {
    const login = vi.fn()
      .mockRejectedValueOnce(new Error("Error invoking remote method 'agent-account:login': Error: Configure the provider in Agent Settings"))
      .mockRejectedValueOnce(new Error(''))
    Object.assign(window, {
      oxe: {
        ...(window as unknown as { oxe?: object }).oxe,
        agentAccount: {
          read: async (context: AgentAccountContext): Promise<AgentAccountSnapshot> => ({
            provider: context.provider,
            scopeId: `scope-${context.provider}`,
            state: 'signed-out',
            method: 'unknown',
            checkedAt: 10
          }),
          login,
          logout: async () => undefined,
          cancel: async () => undefined,
          openBrowser: async () => undefined,
          submitCode: async () => undefined,
          onChanged: () => () => undefined
        }
      }
    })

    render(<ProviderAccountsPanel workspaceId="thread:proj-1" onClose={() => undefined} />)
    const agyCard = (await screen.findByText('Antigravity')).closest('.thread-account-card') as HTMLElement
    const connectBtn = await within(agyCard).findByRole('button', { name: tt('accounts.connect') })

    fireEvent.click(connectBtn)
    expect(await within(agyCard).findByText('Configure the provider in Agent Settings')).toBeVisible()

    // A fresh status snapshot clears the stale error notice automatically.
    act(() => {
      useAccountStore.getState().changed({
        provider: 'antigravity',
        scopeId: 'scope-antigravity',
        state: 'signed-out',
        method: 'unknown',
        checkedAt: 20
      })
    })
    await waitFor(() => expect(within(agyCard).queryByText('Configure the provider in Agent Settings')).toBeNull())

    // Empty error message falls back to translated accounts.failed.
    fireEvent.click(connectBtn)
    expect(await within(agyCard).findByText(tt('accounts.failed'))).toBeVisible()
  })

  test('does not attach a mismatched hidden-project threadId to another project workspaceId, but keeps matching project threads', async () => {
    const read = vi.fn(async (context: AgentAccountContext): Promise<AgentAccountSnapshot> => ({
      provider: context.provider,
      scopeId: `scope-${context.provider}`,
      state: 'signed-out',
      method: 'unknown',
      checkedAt: 1
    }))
    Object.assign(window, {
      oxe: {
        ...(window as unknown as { oxe?: object }).oxe,
        agentAccount: {
          read,
          login: async () => undefined,
          logout: async () => undefined,
          cancel: async () => undefined,
          openBrowser: async () => undefined,
          submitCode: async () => undefined,
          onChanged: () => () => undefined
        }
      }
    })

    useThreadStore.setState({
      snapshot: { thread: { id: 't-hidden', projectId: 'proj-hidden', workspaceId: 'thread:proj-hidden', provider: 'antigravity' } }
    } as never)
    const { unmount } = render(<ProviderAccountsPanel workspaceId="thread:proj-visible" onClose={() => undefined} />)
    await waitFor(() => expect(read).toHaveBeenCalledWith({ provider: 'antigravity', workspaceId: 'thread:proj-visible' }))
    unmount()

    read.mockClear()
    useAccountStore.setState({ scopes: {}, snapshots: {} })
    useThreadStore.setState({
      snapshot: { thread: { id: 't-legacy', projectId: 'proj-visible', workspaceId: 'deleted-code-ws-uuid', provider: 'antigravity' } }
    } as never)
    render(<ProviderAccountsPanel workspaceId="thread:proj-visible" onClose={() => undefined} />)
    await waitFor(() => expect(read).toHaveBeenCalledWith({ provider: 'antigravity', workspaceId: 'thread:proj-visible', threadId: 't-legacy' }))
  })

  test('resolveAccountWorkspaceId skips hidden projects and prefers thread:<projectId> over a stale Code workspace UUID', () => {
    const hidden = { projectId: 'p-hidden', hidden: true }
    const visible = { projectId: 'p-visible', hidden: false }
    expect(resolveAccountWorkspaceId([hidden, visible], null)).toBe('thread:p-visible')
    expect(resolveAccountWorkspaceId([hidden, visible], { projectId: 'p-hidden', workspaceId: 'thread:p-hidden' })).toBe('thread:p-visible')
    expect(resolveAccountWorkspaceId([hidden, visible], { projectId: 'p-visible', workspaceId: 'deleted-ws-uuid' })).toBe('thread:p-visible')
    expect(resolveAccountWorkspaceId([hidden], null)).toBeUndefined()
    expect(resolveAccountWorkspaceId([hidden], { projectId: 'p-hidden', workspaceId: 'deleted-ws-uuid' })).toBe('deleted-ws-uuid')
  })
})
