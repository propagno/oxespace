import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { DelegationBranchIntent, DelegationInput, DelegationRecoveryAction } from '../../../shared/types/delegation'
import type { DelegationService } from '../services/delegation.service'
import { expectBoolean, expectPositiveInteger, expectRecord, parseBoundedId, parseId, parseText } from './validation'

const ACTIONS: readonly DelegationRecoveryAction[] = ['open', 'continue', 'resume', 'retry', 'new-session', 'cancel', 'approve']

/** Checked, then passed on as sent: create compares the intent's JSON with the previewed one. */
function parseBranchIntent(value: unknown): DelegationBranchIntent | undefined {
  if (value === undefined || value === null) return undefined
  const intent = expectRecord(value, 'branchIntent')
  if (intent.strategy !== 'existing' && intent.strategy !== 'create' && intent.strategy !== 'generated') throw new Error('Invalid branch intent')
  for (const key of ['name', 'baseRef', 'remote', 'reference', 'workLabel', 'template']) if (intent[key] !== undefined) parseText(intent[key], key, 4096)
  for (const key of ['fetchBase', 'reuseExistingWorktree']) if (intent[key] !== undefined) expectBoolean(intent[key], key)
  return intent as unknown as DelegationBranchIntent
}

function parseOrigin(value: unknown): { kind: 'pane' | 'thread'; id: string } {
  const origin = expectRecord(value, 'origin')
  if (origin.kind !== 'pane' && origin.kind !== 'thread') throw new Error('Invalid delegation origin')
  return { kind: origin.kind, id: parseBoundedId(origin.id, 'origin id', 128) }
}

/** The envelope only: the service checks each field, for agents' delegations too. */
function parseCreateInput(value: unknown): DelegationInput {
  const input = expectRecord(value, 'delegation:create input')
  parseBranchIntent(input.branchIntent)
  return input as unknown as DelegationInput
}

function parseAction(value: unknown): DelegationRecoveryAction {
  const action = ACTIONS.find(item => item === value)
  if (!action) throw new Error('Unknown control action')
  return action
}

export function registerDelegationIpc(service: DelegationService): void {
  ipcMain.handle(IPC_CHANNELS.delegation.create, (_event, ws, origin, input) => service.createFromSurface(parseId(ws), parseOrigin(origin), parseCreateInput(input)))
  ipcMain.handle(IPC_CHANNELS.delegation.configureTarget, (_event, ws, path, enabled, evidence) =>
    service.configureTarget(parseId(ws), parseBoundedId(path, 'rootPath', 4096), expectBoolean(enabled, 'enabled'), expectBoolean(evidence, 'allowEvidence')))
  ipcMain.handle(IPC_CHANNELS.delegation.adopt, (_event, ws, task, pane) => service.adopt(parseId(ws), parseId(task), parseId(pane)))
  ipcMain.handle(IPC_CHANNELS.delegation.status, (_event, id, cursor, limit) =>
    service.status(parseId(id), cursor === undefined || cursor === null ? undefined : parseText(cursor, 'cursor', 256), limit === undefined || limit === null ? undefined : expectPositiveInteger(limit, 'limit')))
  ipcMain.handle(IPC_CHANNELS.delegation.preview, (_event, id, objective, branchIntent) => service.preview(parseId(id), parseText(objective, 'objective', 2000), parseBranchIntent(branchIntent)))
  ipcMain.handle(IPC_CHANNELS.delegation.configure, (_event, id, enabled) => service.configure(parseId(id), expectBoolean(enabled, 'enabled')))
  ipcMain.handle(IPC_CHANNELS.delegation.control, (_event, ws, task, action) => service.control(parseId(ws), parseId(task), parseAction(action)))
}
