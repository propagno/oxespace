/**
 * B10 · The system dialog, used only as the approval center's fallback (no app window, the window reported
 * `unavailable`, or the crash handshake was not acknowledged). It speaks the same C3 codes in the interface's language.
 *
 * The system dialog cannot be trusted to show a long text (Windows drops a long `detail`), so above NATIVE_TEXT_MAX it
 * offers deny only: a person never approves in it what it may not have shown. A critical request is deny-only too: the
 * 2-second hold on Allow cannot be enforced in a system dialog.
 */
import { BrowserWindow, dialog, type MessageBoxOptions } from 'electron'
import { mainMessage, messageKey, messageValues, type MainMessage } from '../../../../shared/messages'
import type { ApprovalRequest } from '../../../../shared/types/approvals'
import { mainLanguage, tMain } from '../../i18n'
import type { NativeReason } from './approval-center'

export const NATIVE_TEXT_MAX = 1_500

function say(message: MainMessage): string {
  return tMain(messageKey(message.code) as never, messageValues(message, mainLanguage()))
}

export function nativeOptions(request: ApprovalRequest, reason: NativeReason): MessageBoxOptions & { optionIds: string[] } {
  const showable = !request.agentText.truncated && request.agentText.length <= NATIVE_TEXT_MAX
  // The 2 s hold cannot be enforced in a system dialog, so a critical request is deny-only here.
  const critical = request.risk === 'critical'
  const options = showable && !critical ? request.options : request.options.filter(option => option.intent === 'deny')
  const notes = [
    ...(reason === 'unavailable' ? [mainMessage('approvals.unavailable', {})] : []),
    ...(critical ? [mainMessage('approvals.note.nativeCriticalDenyOnly', {})] : []),
    ...(showable ? [] : [mainMessage('approvals.note.textCut', { max: NATIVE_TEXT_MAX })]),
    ...request.appNotes
  ]
  const defaultId = Math.max(0, options.findIndex(option => option.id === request.defaultOptionId))
  const detail = [
    say(request.requester.label),
    request.target ?? '',
    notes.map(note => `• ${say(note)}`).join('\n'),
    showable && request.agentText.text ? `────────\n${request.agentText.text}` : ''
  ].filter(Boolean).join('\n\n')
  return {
    type: request.kind === 'crash' ? 'error' : request.risk === 'low' ? 'question' : 'warning',
    title: say(request.title), message: say(request.summary), detail,
    buttons: options.map(option => say(option.label)), defaultId, cancelId: defaultId, noLink: true,
    optionIds: options.map(option => option.id)
  }
}

export async function nativeApproval(request: ApprovalRequest, reason: NativeReason, signal: AbortSignal): Promise<string | null> {
  const { optionIds, ...base } = nativeOptions(request, reason)
  const plain: MessageBoxOptions = { ...base, signal }
  // The app icon on the crash dialog, when it loads; never a reason not to ask.
  const shown = request.kind === 'crash'
    ? await import('../../dialog-icon').then(({ withDialogIcon }) => { try { return withDialogIcon(plain) } catch { return plain } }, () => plain)
    : plain
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().find(item => !item.isDestroyed())
  try {
    const { response } = window ? await dialog.showMessageBox(window, shown) : await dialog.showMessageBox(shown)
    if (signal.aborted) return null
    const chosen = optionIds[response] ?? request.defaultOptionId
    // Belt and braces: whatever the dialog returned, a critical request is never allowed from it.
    return request.risk === 'critical' && request.options.find(option => option.id === chosen)?.intent !== 'deny' ? request.defaultOptionId : chosen
  } catch {
    return signal.aborted ? null : request.defaultOptionId
  }
}
