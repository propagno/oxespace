/** The longest prompt a Thread message may carry, in UTF-16 characters. Shared by the composer and the IPC check. */
export const THREAD_MESSAGE_MAX_CHARS = 1_000_000

/** What reaches the provider: the message plus `@file` content (256 KiB at most) and the project brief. */
export const THREAD_PROMPT_MAX_CHARS = THREAD_MESSAGE_MAX_CHARS + 512 * 1024

/** The same message checks for every entry point: send, steer, queued edits. */
export function assertThreadMessage(text: string, limit = THREAD_MESSAGE_MAX_CHARS): void {
  if (!text.trim()) throw new Error('Message is empty')
  if (text.length > limit) throw new Error(`This message has ${text.length.toLocaleString('en-US')} characters; the limit is ${limit.toLocaleString('en-US')}. Attach long text as a file instead.`)
}
