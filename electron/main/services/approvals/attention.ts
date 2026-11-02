/**
 * B10 R3 · When a request reaches the window and the window is not focused: flash its frame and show an OS notification
 * with fixed app text ("OXESpace: approval waiting"). Nothing from the request (agent text, requester, target) is ever
 * in it, which is why this takes no request.
 */
export interface AttentionWindow {
  isFocused(): boolean
  flashFrame(flag: boolean): void
  /** S4: the window stops flashing when it gains focus. */
  once?(event: 'focus', listener: () => void): unknown
}

export interface AttentionNotifier {
  supported(): boolean
  show(title: string): void
  /** The fixed C3 text `approvals.notify.waiting`, in the interface's language. */
  title(): Promise<string>
}

/** S4 · Stops the taskbar flash on every window (a focused ack arrived, or nothing waits any more). */
export function endAttention(windows: AttentionWindow[]): void {
  for (const window of windows) window.flashFrame(false)
}

/** True when it asked for attention (no window was focused). */
export function askForAttention(windows: AttentionWindow[], notifier: AttentionNotifier): boolean {
  if (windows.length === 0 || windows.some(window => window.isFocused())) return false
  for (const window of windows) {
    window.flashFrame(true)
    window.once?.('focus', () => window.flashFrame(false))
  }
  if (notifier.supported()) void notifier.title().then(title => notifier.show(title), () => undefined)
  return true
}
