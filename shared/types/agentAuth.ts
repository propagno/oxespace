import type { ThreadProvider } from './thread'

export interface AgentAccountContext {
  provider: ThreadProvider
  workspaceId: string
  paneId?: string
  threadId?: string
}
export type AccountState = 'checking' | 'missing-cli' | 'signed-out' | 'connecting' | 'awaiting-browser' | 'awaiting-code' | 'connected' | 'expired' | 'unsupported' | 'error'
export interface AgentAccountSnapshot {
  provider: ThreadProvider
  scopeId: string
  state: AccountState
  method: 'subscription' | 'api' | 'other' | 'unknown'
  accountLabel?: string
  planLabel?: string
  checkedAt: number
  attemptId?: string
  canOpenBrowser?: boolean
  errorCode?: 'installation' | 'connection' | 'configuration' | 'timeout' | 'cancelled' | 'active-turn'
}
export interface AgentAccountApi {
  read(context: AgentAccountContext): Promise<AgentAccountSnapshot>
  login(context: AgentAccountContext): Promise<AgentAccountSnapshot>
  logout(context: AgentAccountContext): Promise<AgentAccountSnapshot>
  cancel(attemptId: string): Promise<void>
  submitCode(attemptId: string, code: string): Promise<void>
  openBrowser(attemptId: string): Promise<void>
  onChanged(listener: (snapshot: AgentAccountSnapshot) => void): () => void
}
