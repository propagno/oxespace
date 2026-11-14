/**
 * The note a conversation's agent gets with a message while it can see the conversation's preview (the Browser's
 * "Auto-verify"). The Browser service registers how to ask when it is first used; a conversation that never opened
 * the Browser has no note, and nothing of the Browser is loaded to find that out.
 */
let source: ((threadId: string) => string | null) | null = null

export function setPreviewNoteSource(next: ((threadId: string) => string | null) | null): void {
  source = next
}

/** The block appended to the agent's input, or '' when there is no preview to check. The stored message keeps the text as typed. */
export function previewNoteFor(threadId: string): string {
  try { return source?.(threadId) ?? '' } catch { return '' }
}
