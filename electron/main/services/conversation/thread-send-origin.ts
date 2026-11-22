import { hasDesktopCommand } from '../../../../shared/threadDesktopCommands'
import { assertThreadMessage } from '../../../../shared/threadLimits'
import type { ThreadProvider } from '../../../../shared/types/thread'
import { MainRefusal } from '../main-refusal'

/**
 * Who a send speaks for. `window` is the person in the app's own window, and only the window's IPC handlers pass it.
 * No origin is everyone else: an agent, the phone, a schedule, a team, a delegation, the app sending again by itself.
 */
export type ThreadSendOrigin = 'window' | 'execute-plan'

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
