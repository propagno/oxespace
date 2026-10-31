import type { MessageCode, MessageParams } from '../../../shared/messages'

/**
 * A refusal the window turns into words (C3): the error's message is the code, and `params` fill the catalog's
 * placeholders. Use it for anything a person should read; plain `Error` stays for invalid requests.
 */
export class MainRefusal<Code extends MessageCode = MessageCode> extends Error {
  constructor(readonly code: Code, readonly params: MessageParams[Code]) {
    // The name stays `Error`, so the window reads the code after the IPC prefix like any other message.
    super(code)
  }
}
