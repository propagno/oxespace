/**
 * F7 A55 / U7.4: "What agents can do": the always-allowed rules, the database access, the HTTP hosts agents called
 * and the Policy rows, in one read model. Everything but the Policy is revocable from the page, with an undo.
 */
import type { MessageCode } from '../messages'
import type { AgentAccess } from './oxequery'

export type AgentHostAccess = 'allowed' | 'ask' | 'blocked'
export const AGENT_HOST_ACCESS_LEVELS: readonly AgentHostAccess[] = ['allowed', 'ask', 'blocked']
export type AgentHostDecision = 'allow' | 'ask' | 'deny'

export interface AgentPermissionRule {
  id: string
  provider: 'claude' | 'codex'
  /** The rule exactly as the provider reads it, e.g. `Bash(npm test:*)`. */
  text: string
  /** Claude rules live in the project's settings file; Codex rules last for the conversation. */
  scope: 'project' | 'session'
  project?: string
  addedAt: number
}

export interface AgentPermissionDatabase {
  id: string
  name: string
  env: string
  access: AgentAccess | string
}

export interface AgentPermissionHost {
  host: string
  access: AgentHostAccess
  callsToday: number
  production: boolean
  insecure: boolean
}

export interface AgentPermissionPolicyRow {
  section: 'hosts' | 'databases' | 'commands' | 'tools'
  text: string
}

export interface AgentPermissionsPage {
  rules: AgentPermissionRule[]
  databases: AgentPermissionDatabase[]
  hosts: AgentPermissionHost[]
  policy: AgentPermissionPolicyRow[]
}

export type AgentPermissionsChange =
  | { ok: true; undoToken: string; code?: undefined }
  | { ok: false; code: MessageCode; undoToken?: undefined }

export type AgentPermissionsUndo = { ok: true; code?: undefined } | { ok: false; code: MessageCode }
