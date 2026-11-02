import type { MessageCode, MessageParams } from '../../../shared/messages'

/**
 * A refusal the window turns into words (C3): the error's message is the code, and `params` fill the catalog's
 * placeholders. Use it for anything a person may read. Plain `Error` stays only for programming mistakes the app's
 * own window cannot produce; input from an agent or an MCP tool (an id, a message) gets a code too, since a person can
 * see that refusal.
 */
export class MainRefusal<Code extends MessageCode = MessageCode> extends Error {
  constructor(readonly code: Code, readonly params: MessageParams[Code]) {
    // The name stays `Error`, so the window reads the code after the IPC prefix like any other message.
    super(code)
  }
}
