import { BrowserWindow, dialog, type MessageBoxOptions } from 'electron'
import { tMain } from '../../i18n'
import type { ApprovalDecision, ApprovalPrompter, ApprovalRequest } from './approval-broker'

/**
 * Asks in a native modal dialog, which shows regardless of which view is open and
 * cannot be dismissed by the agent. The default button is Deny. The buttons are in the interface's language; the
 * title, summary and text describe the request and stay as the requester wrote them.
 */
export const nativeApprovalPrompter: ApprovalPrompter = {
  async ask(request: ApprovalRequest, signal: AbortSignal): Promise<ApprovalDecision> {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const answers = [tMain('dialogs.approval.deny'), tMain('dialogs.approval.allowOnce')]
    const buttons = request.risk === 'read' ? [...answers, request.sessionLabel ?? tMain('dialogs.approval.allowSession')] : answers
    const warnings = request.reasons.length ? `\n\n${request.reasons.map(reason => `• ${reason}`).join('\n')}` : ''
    const options: MessageBoxOptions = {
      type: request.risk === 'read' ? 'question' : 'warning',
      title: request.title,
      message: request.summary,
      detail: `${request.target}${warnings}\n\n${request.text}`,
      buttons, defaultId: 0, cancelId: 0, noLink: true, signal
    }
    const result = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options)
    return result.response === 1 ? 'allow-once' : result.response === 2 ? 'allow-session' : 'deny'
  }
}
