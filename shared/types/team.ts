export type TeamRole = 'coordinator' | 'project-manager' | 'product-manager' | 'developer' | 'reviewer'
export interface TeamMember { id: string; teamId: string; name: string; role: TeamRole; archived: boolean; connection?: { owner: { kind: 'thread' | 'pane'; id: string }; deliveryEnabled?: boolean; state: 'connected' | 'disconnected'; /** Connected Thread that is idle-suspended; a message starts it again. */ suspended?: boolean } }
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
