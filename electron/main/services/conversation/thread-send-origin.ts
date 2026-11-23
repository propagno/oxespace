import { hasDesktopCommand, THREAD_TEXT_TYPED } from '../../../../shared/threadDesktopCommands'
import { assertThreadMessage } from '../../../../shared/threadLimits'
import type { ThreadProvider } from '../../../../shared/types/thread'
import { MainRefusal } from '../main-refusal'

/**
 * Who a send speaks for. `window` is text the person just typed in the app's own window: only windowOrigin gives it.
 * No origin is everyone else: an agent, the phone, a schedule, a team, a delegation, stored text sent again by anyone.
 */
export type ThreadSendOrigin = 'window' | 'execute-plan'

/** The origin of a send or steer over the window's IPC. Fails closed: anything but the typed marker is no origin. */
export function windowOrigin(marker: unknown): 'window' | undefined {
  return marker === THREAD_TEXT_TYPED ? 'window' : undefined
}

/**
 * A message's checks before it is queued, sent or steered. Only the window's message may be a desktop command
 * (/permissions, /plan, /delete…): those change the conversation with the person's authority, so from any other
 * caller they are refused. `compact` and `review` are turns of the agent, never desktop commands here.
 */
export function assertThreadSend(provider: ThreadProvider, text: string, origin?: ThreadSendOrigin): void {
  assertThreadMessage(text)
  if (origin === 'window') return
  // As wide as the dispatcher or wider: the command router reads names in any case.
  const name = /^\/([\w:-]+)(?=\s|$)/.exec(text.trim())?.[1].toLowerCase()
  if (name && name !== 'compact' && name !== 'review' && hasDesktopCommand(provider, name)) throw new MainRefusal('thread.command.windowOnly', {})
}
