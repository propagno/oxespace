import type { AgentProvider } from './agent'

export type IntegrationRole =
  | 'srv'
  | 'bff'
  | 'fed'
  | 'db'
  | 'infra'
  | 'docs'
  | 'lib'
  | 'api'
  | 'aut'
  | 'apim'
  | 'mktapi'
  | 'other'
export type IntegrationStatus = 'active' | 'paused' | 'done'

export interface IntegrationGroup {
  id: string
  name: string
  goal: string
  description: string | null
  status: IntegrationStatus
  activeWorkspaceId: string | null
  createdAt: number
  updatedAt: number
  members: IntegrationMember[]
}

export interface IntegrationMember {
  id: string
  groupId: string
  workspaceId: string
  workspaceName: string
  workspaceRootPath: string
  paneId: string | null
  rootPath: string
  role: IntegrationRole
  alias: string
  branch: string | null
  activeProvider: AgentProvider | null
  activeSessionId: string | null
  lastIntent: string | null
  lastResult: string | null
  blockers: string | null
  updatedAt: number
}

export interface IntegrationSession {
  id: string
  groupId: string
  memberId: string
  workspaceId: string
  rootPath: string
  provider: AgentProvider
  sessionId: string
  label: string | null
  updatedAt: number
}

export interface IntegrationHandoff {
  id: string
  groupId: string
  fromMemberId: string
  toMemberId: string
  title: string
  content: string
  status: 'draft' | 'sent' | 'saved'
  createdAt: number
}

export interface CreateIntegrationGroupInput {
  name: string
  goal: string
  description?: string | null
  activeWorkspaceId?: string | null
}

export interface UpdateIntegrationGroupInput {
  groupId: string
  name?: string
  goal?: string
  description?: string | null
  status?: IntegrationStatus
  activeWorkspaceId?: string | null
}

export interface AddIntegrationMemberInput {
  groupId: string
  workspaceId: string
  paneId?: string | null
  role: IntegrationRole
  alias?: string | null
  rootPath?: string | null
}

export interface UpdateIntegrationMemberInput {
  memberId: string
  role?: IntegrationRole
  alias?: string
  paneId?: string | null
  rootPath?: string | null
  lastIntent?: string | null
  lastResult?: string | null
  blockers?: string | null
}

export interface AttachIntegrationSessionInput {
  groupId: string
  memberId: string
  workspaceId: string
  rootPath: string
  provider: AgentProvider
  sessionId: string
  label?: string | null
}

export interface CreateIntegrationHandoffInput {
  groupId: string
  fromMemberId: string
  toMemberId: string
  title: string
  content: string
  status?: 'draft' | 'sent' | 'saved'
}

export interface UpdateIntegrationHandoffInput {
  handoffId: string
  status?: 'draft' | 'sent' | 'saved'
  title?: string
  content?: string
}

export interface IntegrationContextInput {
  groupId: string
  currentMemberId?: string | null
}

export interface IntegrationContextResult {
  groupId: string
  text: string
}
