export type TeamRole = 'coordinator' | 'project-manager' | 'product-manager' | 'developer' | 'reviewer'
export type TeamScope = { kind: 'code' | 'thread'; id: string }
export interface TeamApi {
  read(scope: TeamScope): Promise<AgentTeam>
  add(scope: TeamScope, revision: number, name: string, role: TeamRole): Promise<AgentTeam>
  coordinator(scope: TeamScope, revision: number, memberId: string): Promise<AgentTeam>
  archive(scope: TeamScope, revision: number, memberId: string): Promise<AgentTeam>
  connect(scope: TeamScope, revision: number, memberId: string, owner: { kind: 'thread' | 'pane'; id: string }): Promise<AgentTeam>
  disconnect(scope: TeamScope, revision: number, memberId: string): Promise<AgentTeam>
  delivery(scope: TeamScope, revision: number, memberId: string, enabled: boolean): Promise<AgentTeam>
  messages(scope: TeamScope, memberId: string, before?: number): Promise<TeamMessage[]>
  send(scope: TeamScope, memberId: string, key: string, body: string): Promise<TeamMessage>
}
export interface TeamMember { id: string; teamId: string; name: string; role: TeamRole; archived: boolean; connection?: { owner: { kind: 'thread' | 'pane'; id: string }; deliveryEnabled?: boolean; state: 'connected' | 'disconnected' } }
export interface TeamBinding {
  memberId: string; provider: 'codex' | 'claude'; nativeSessionId: string; canonicalRoot: string
  surface: 'thread' | 'pane'; surfaceId: string; generation: number
}
export interface AgentTeam { id: string; projectIdentity: string; name: string; revision: number; members: TeamMember[] }
export type TeamMessageKind = 'request' | 'progress' | 'question' | 'answer' | 'result' | 'decision'
export interface TeamMessage {
  deliveryState?: 'dispatching' | 'submitted' | 'unknown'
  sequence: number; id: string; teamId: string; senderId: string | null; recipientId: string
  kind: TeamMessageKind; body: string; createdAt: number; receivedAt: number | null; replyTo: string | null
}
