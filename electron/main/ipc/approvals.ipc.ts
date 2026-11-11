import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type {
  ApprovalAckInput,
  ApprovalAlwaysAllowResult,
  ApprovalAnswerInput,
  ApprovalDatabasePreview,
  ApprovalRespondInput
} from '../../../shared/types/approvals'
import type { ApprovalCenter } from '../services/approvals/approval-center'
import { parseRecord, parseText } from './ipc-guards'

export interface ApprovalsIpcExtras {
  preview?: (requestId: string) => Promise<ApprovalDatabasePreview>
  alwaysAllow?: (requestId: string) => Promise<ApprovalAlwaysAllowResult>
}

/** B10 + F7 · The window's side of the approval center. Main frame only; a malformed call is an Error, a refused one a typed result. */
export function registerApprovalsIpc(center: ApprovalCenter, extras: ApprovalsIpcExtras = {}): void {
  const answer = (value: unknown): ApprovalAnswerInput => {
    const input = parseRecord(value, 'Approval')
    if (!Number.isInteger(input.generation) || (input.generation as number) < 1) throw new Error('Approval generation must be a positive integer')
    return { id: parseText(input.id, 'Approval id', 200), generation: input.generation as number }
  }
  ipcMain.handle(IPC_CHANNELS.approvals.list, () => center.list())
  ipcMain.handle(IPC_CHANNELS.approvals.history, () => center.history())
  ipcMain.handle(IPC_CHANNELS.approvals.respond, (_event, value: unknown) => {
    const input: ApprovalRespondInput = { ...answer(value), optionId: parseText((value as { optionId?: unknown }).optionId, 'Approval option', 100) }
    return center.respond(input)
  })
  ipcMain.handle(IPC_CHANNELS.approvals.ack, (_event, value: unknown) => {
    const flags = parseRecord(value, 'Approval')
    // R3: the window's own visibility and focus; anything but a boolean true counts as false.
    const input: ApprovalAckInput = { ...answer(value), visible: flags.visible === true, focused: flags.focused === true }
    return center.ack(input)
  })
  ipcMain.handle(IPC_CHANNELS.approvals.unavailable, (_event, value: unknown) => center.unavailable(answer(value)))
  ipcMain.handle(IPC_CHANNELS.approvals.preview, async (_event, value: unknown): Promise<ApprovalDatabasePreview> => {
    const requestId = parseText(value, 'Approval id', 200)
    if (!extras.preview) return { status: 'failed', count: null, reason: 'unavailable' }
    return extras.preview(requestId)
  })
  ipcMain.handle(IPC_CHANNELS.approvals.alwaysAllow, async (_event, value: unknown): Promise<ApprovalAlwaysAllowResult> => {
    const requestId = parseText(value, 'Approval id', 200)
    if (!extras.alwaysAllow) return { ok: false, code: 'approvals.alwaysAllow.notOffered' }
    return extras.alwaysAllow(requestId)
  })
}
