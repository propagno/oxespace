import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { ApprovalAckInput, ApprovalAnswerInput, ApprovalRespondInput } from '../../../shared/types/approvals'
import type { ApprovalCenter } from '../services/approvals/approval-center'
import { parseRecord, parseText } from './ipc-guards'

/** B10 · The window's side of the approval center. Main frame only; a malformed call is an Error, a refused one a typed result. */
export function registerApprovalsIpc(center: ApprovalCenter): void {
  const answer = (value: unknown): ApprovalAnswerInput => {
    const input = parseRecord(value, 'Approval')
    if (!Number.isInteger(input.generation) || (input.generation as number) < 1) throw new Error('Approval generation must be a positive integer')
    return { id: parseText(input.id, 'Approval id', 200), generation: input.generation as number }
  }
  ipcMain.handle(IPC_CHANNELS.approvals.list, event => center.list())
  ipcMain.handle(IPC_CHANNELS.approvals.history, event => center.history())
  ipcMain.handle(IPC_CHANNELS.approvals.respond, (event, value: unknown) => {
    const input: ApprovalRespondInput = { ...answer(value), optionId: parseText((value as { optionId?: unknown }).optionId, 'Approval option', 100) }
    return center.respond(input)
  })
  ipcMain.handle(IPC_CHANNELS.approvals.ack, (event, value: unknown) => {
    const flags = parseRecord(value, 'Approval')
    // R3: the window's own visibility and focus; anything but a boolean true counts as false.
    const input: ApprovalAckInput = { ...answer(value), visible: flags.visible === true, focused: flags.focused === true }
    return center.ack(input)
  })
  ipcMain.handle(IPC_CHANNELS.approvals.unavailable, (event, value: unknown) => center.unavailable(answer(value)))
}
