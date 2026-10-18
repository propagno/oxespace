import { BrowserWindow, dialog, type MessageBoxOptions } from 'electron'
import type { ApprovalDecision, ApprovalPrompter, ApprovalRequest } from './approval-broker'

const VERBS: Record<ApprovalRequest['risk'], string> = {
  read: 'read data',
  write: 'CHANGE data',
  action: 'run a container action'
}

/**
 * Asks in a native modal dialog, which shows regardless of which view is open and
 * cannot be dismissed by the agent. The default button is Deny.
 */
export const nativeApprovalPrompter: ApprovalPrompter = {
  async ask(request: ApprovalRequest, signal: AbortSignal): Promise<ApprovalDecision> {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const buttons = request.risk === 'read' ? ['Deny', 'Allow once', 'Allow reads on this connection for this run'] : ['Deny', 'Allow once']
    const warnings = request.reasons.length ? `\n\n${request.reasons.map(reason => `• ${reason}`).join('\n')}` : ''
    const options: MessageBoxOptions = {
      type: request.risk === 'read' ? 'question' : 'warning',
      title: 'OxeQuery — request from an agent',
      message: `${request.actor} wants to ${VERBS[request.risk]}`,
      detail: `${request.connectionName} · ${request.engine} · ${request.environment}${warnings}\n\n${request.text}`,
      buttons, defaultId: 0, cancelId: 0, noLink: true, signal
    }
    const result = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options)
    return result.response === 1 ? 'allow-once' : result.response === 2 ? 'allow-session' : 'deny'
  }
}
