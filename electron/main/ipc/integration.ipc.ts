import { ipcMain } from 'electron'
import type { AppDatabase } from '../db/index'
import { IntegrationService } from '../services/integration.service'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { AgentProvider } from '../../../shared/types/agent'
import { ALL_PROVIDERS } from '../../../shared/types/agent'
import type { IntegrationRole, IntegrationStatus } from '../../../shared/types/integration'

const ROLES = new Set<IntegrationRole>(['srv', 'bff', 'fed', 'db', 'infra', 'docs', 'lib', 'api', 'aut', 'apim', 'mktapi', 'other'])
const STATUSES = new Set<IntegrationStatus>(['active', 'paused', 'done'])
const PROVIDERS = new Set<AgentProvider>(ALL_PROVIDERS)

export function registerIntegrationIpc(db: AppDatabase, service = new IntegrationService(db)): IntegrationService {
  ipcMain.handle(IPC_CHANNELS.integration.listGroups, (_event, input: unknown) => {
    const workspaceId = readOptionalWorkspaceId(input)
    return service.listGroups(workspaceId)
  })
  ipcMain.handle(IPC_CHANNELS.integration.createGroup, (_event, input: unknown) => {
    const value = record(input, 'integration:create-group input')
    return service.createGroup({
      name: nonEmpty(value.name, 'name'),
      goal: nonEmpty(value.goal, 'goal'),
      description: nullableString(value.description),
      activeWorkspaceId: nullableString(value.activeWorkspaceId)
    })
  })
  ipcMain.handle(IPC_CHANNELS.integration.updateGroup, (_event, input: unknown) => {
    const value = record(input, 'integration:update-group input')
    return service.updateGroup({
      groupId: nonEmpty(value.groupId, 'groupId'),
      name: value.name === undefined ? undefined : nonEmpty(value.name, 'name'),
      goal: value.goal === undefined ? undefined : nonEmpty(value.goal, 'goal'),
      description: value.description === undefined ? undefined : nullableString(value.description),
      status: value.status === undefined ? undefined : status(value.status),
      activeWorkspaceId: value.activeWorkspaceId === undefined ? undefined : nullableString(value.activeWorkspaceId)
    })
  })
  ipcMain.handle(IPC_CHANNELS.integration.deleteGroup, (_event, id: unknown) => service.deleteGroup(nonEmpty(id, 'groupId')))
  ipcMain.handle(IPC_CHANNELS.integration.addMember, (_event, input: unknown) => {
    const value = record(input, 'integration:add-member input')
    return service.addMember({
      groupId: nonEmpty(value.groupId, 'groupId'),
      workspaceId: nonEmpty(value.workspaceId, 'workspaceId'),
      paneId: nullableString(value.paneId),
      role: role(value.role),
      alias: nullableString(value.alias),
      rootPath: nullableString(value.rootPath)
    })
  })
  ipcMain.handle(IPC_CHANNELS.integration.updateMember, (_event, input: unknown) => {
    const value = record(input, 'integration:update-member input')
    return service.updateMember({
      memberId: nonEmpty(value.memberId, 'memberId'),
      role: value.role === undefined ? undefined : role(value.role),
      alias: value.alias === undefined ? undefined : nonEmpty(value.alias, 'alias'),
      paneId: value.paneId === undefined ? undefined : nullableString(value.paneId),
      rootPath: value.rootPath === undefined ? undefined : nullableString(value.rootPath),
      lastIntent: value.lastIntent === undefined ? undefined : nullableString(value.lastIntent),
      lastResult: value.lastResult === undefined ? undefined : nullableString(value.lastResult),
      blockers: value.blockers === undefined ? undefined : nullableString(value.blockers)
    })
  })
  ipcMain.handle(IPC_CHANNELS.integration.removeMember, (_event, id: unknown) => service.removeMember(nonEmpty(id, 'memberId')))
  ipcMain.handle(IPC_CHANNELS.integration.attachSession, (_event, input: unknown) => {
    const value = record(input, 'integration:attach-session input')
    return service.attachSession({
      groupId: nonEmpty(value.groupId, 'groupId'),
      memberId: nonEmpty(value.memberId, 'memberId'),
      workspaceId: nonEmpty(value.workspaceId, 'workspaceId'),
      rootPath: nonEmpty(value.rootPath, 'rootPath'),
      provider: provider(value.provider),
      sessionId: nonEmpty(value.sessionId, 'sessionId'),
      label: nullableString(value.label)
    })
  })
  ipcMain.handle(IPC_CHANNELS.integration.listHandoffs, (_event, groupId: unknown) => service.listHandoffs(nonEmpty(groupId, 'groupId')))
  ipcMain.handle(IPC_CHANNELS.integration.createHandoff, (_event, input: unknown) => {
    const value = record(input, 'integration:create-handoff input')
    return service.createHandoff({
      groupId: nonEmpty(value.groupId, 'groupId'),
      fromMemberId: nonEmpty(value.fromMemberId, 'fromMemberId'),
      toMemberId: nonEmpty(value.toMemberId, 'toMemberId'),
      title: nonEmpty(value.title, 'title'),
      content: nonEmpty(value.content, 'content'),
      status: value.status === 'sent' || value.status === 'saved' ? value.status : 'draft'
    })
  })
  ipcMain.handle(IPC_CHANNELS.integration.updateHandoff, (_event, input: unknown) => {
    const value = record(input, 'integration:update-handoff input')
    return service.updateHandoff({
      handoffId: nonEmpty(value.handoffId, 'handoffId'),
      status: value.status === undefined
        ? undefined
        : value.status === 'draft' || value.status === 'sent' || value.status === 'saved'
          ? value.status
          : (() => { throw new Error('status must be draft, sent or saved') })(),
      title: value.title === undefined ? undefined : nonEmpty(value.title, 'title'),
      content: value.content === undefined ? undefined : nonEmpty(value.content, 'content')
    })
  })
  ipcMain.handle(IPC_CHANNELS.integration.buildContext, (_event, input: unknown) => {
    const value = record(input, 'integration:build-context input')
    return service.buildContext(nonEmpty(value.groupId, 'groupId'), nullableString(value.currentMemberId))
  })
  return service
}

function readOptionalWorkspaceId(input: unknown): string | null {
  if (input === undefined || input === null) return null
  const value = record(input, 'integration:list-groups input')
  return nullableString(value.workspaceId)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must not be empty`)
  return value.trim()
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new Error('value must be a string')
  return value.trim() || null
}

function role(value: unknown): IntegrationRole {
  if (typeof value !== 'string' || !ROLES.has(value as IntegrationRole)) throw new Error('role must be one of srv, bff, fed, db, infra, docs, lib, api, aut, apim, mktapi, other')
  return value as IntegrationRole
}

function status(value: unknown): IntegrationStatus {
  if (typeof value !== 'string' || !STATUSES.has(value as IntegrationStatus)) throw new Error('status must be active, paused or done')
  return value as IntegrationStatus
}

function provider(value: unknown): AgentProvider {
  if (typeof value !== 'string' || !PROVIDERS.has(value as AgentProvider)) throw new Error('provider must be a supported agent provider')
  return value as AgentProvider
}
