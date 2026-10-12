import { create } from 'zustand'
import type { AgentAccountContext, AgentAccountSnapshot } from '../../shared/types/agentAuth'
const key = (context: AgentAccountContext) => JSON.stringify(context)
const pending = new Map<string, Promise<void>>()
let eventVersion = 0
const scopeVersions = new Map<string, number>()
function response(state: AccountState, contextKey: string, status: AgentAccountSnapshot, started: number) {
  return { scopes: { ...state.scopes, [contextKey]: status.scopeId }, snapshots: {
    ...state.snapshots, [status.scopeId]: (scopeVersions.get(status.scopeId) ?? 0) > started ? state.snapshots[status.scopeId] : status
  } }
}
interface AccountState {
  scopes: Record<string, string>; snapshots: Record<string, AgentAccountSnapshot>
  read(context: AgentAccountContext): Promise<void>
  login(context: AgentAccountContext): Promise<void>
  logout(context: AgentAccountContext): Promise<void>
  changed(snapshot: AgentAccountSnapshot): void
}
export const useAccountStore = create<AccountState>((set, get) => ({
  scopes: {}, snapshots: {},
  changed: snapshot => {
    scopeVersions.set(snapshot.scopeId, ++eventVersion)
    set(state => ({ snapshots: { ...state.snapshots, [snapshot.scopeId]: snapshot } }))
  },
  read: async context => {
    const contextKey = key(context)
    if (pending.has(contextKey)) return pending.get(contextKey)
    const started = eventVersion
    const run = async () => {
      try {
        const api = window.oxe?.agentAccount
        if (!api) throw Error('Unavailable')
        const status = await api.read(context)
        set(state => response(state, contextKey, status, started))
      } catch {
        const status: AgentAccountSnapshot = { provider: context.provider, scopeId: contextKey, state: 'error', method: 'unknown', checkedAt: Date.now(), errorCode: 'connection' }
        set(state => ({ scopes: { ...state.scopes, [contextKey]: contextKey }, snapshots: { ...state.snapshots, [contextKey]: status } }))
      }
    }
    const promise = run().finally(() => pending.delete(contextKey)); pending.set(contextKey, promise); await promise
  },
  login: async context => {
    const started = eventVersion
    const status = await window.oxe!.agentAccount!.login(context)
    set(state => response(state, key(context), status, started))
  },
  logout: async context => {
    const started = eventVersion
    const status = await window.oxe!.agentAccount!.logout(context)
    set(state => response(state, key(context), status, started))
  }
}))
export function selectAccount(context: AgentAccountContext) { return (state: AccountState) => state.snapshots[state.scopes[key(context)]] }
