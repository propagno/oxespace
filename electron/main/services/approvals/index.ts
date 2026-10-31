/**
 * B10 · The app's approval center: the window's modal first, the system dialog only as the fallback.
 */
import { BrowserWindow, Notification } from 'electron'
import { ApprovalCenter } from './approval-center'
import { askForAttention, endAttention } from './attention'

function liveWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter(window => !window.isDestroyed() && !window.webContents.isDestroyed() && !window.webContents.isCrashed())
}

export const approvalCenter = new ApprovalCenter({
  send: (channel, payload) => { for (const window of liveWindows()) window.webContents.send(channel, payload) },
  hasWindow: () => liveWindows().length > 0,
  attention: () => askForAttention(liveWindows(), {
    supported: () => Notification.isSupported(),
    show: title => { new Notification({ title, silent: false }).show() },
    title: () => import('../../i18n').then(({ tMain }) => tMain('messages.approvals.notify.waiting' as never))
  }),
  attentionEnd: () => endAttention(liveWindows()),
  native: (request, reason, signal) => import('./native-approval').then(({ nativeApproval }) => nativeApproval(request, reason, signal)),
  // Loaded on first use, so importing the center has no logging side effects (tests mock Electron).
  log: (event, detail) => { void import('electron-log/main.js').then(({ default: log }) => log.warn(`[approvals] ${event}`, detail), () => undefined) }
})
