import { expect, it, vi } from 'vitest'
import type { AgentAccountSnapshot } from '../shared/types/agentAuth'
import { selectAccount, useAccountStore } from '../src/store/account.store'

it('retains the completed account event when an older login response arrives later', async () => {
  useAccountStore.setState({ snapshots: {}, scopes: {} })
  const context = { provider: 'codex' as const, workspaceId: 'race-test' }
  let resolve!: (value: AgentAccountSnapshot) => void
  Object.defineProperty(window, 'oxe', { configurable: true, value: { agentAccount: { login: vi.fn(() => new Promise<AgentAccountSnapshot>(done => { resolve = done })) } } })
  const pending = useAccountStore.getState().login(context)
  useAccountStore.getState().changed({ provider: 'codex', scopeId: 'race-scope', state: 'connected', method: 'subscription', checkedAt: 2 })
  resolve({ provider: 'codex', scopeId: 'race-scope', state: 'awaiting-browser', method: 'unknown', checkedAt: 1, attemptId: 'obsolete' })
  await pending
  expect(selectAccount(context)(useAccountStore.getState())).toMatchObject({ state: 'connected', method: 'subscription' })
})
