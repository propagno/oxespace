/** Keep provider-generated context and attachment paths out of imported chat text.
 * This also runs when rendering older imports, whose events were saved verbatim. */
export function formatNativeUserText(text: string): string {
  return text
    .replace(/<environment_context>([\s\S]*?)<\/environment_context>\s*/gi, (block, body: string) =>
      /<(?:current_date|cwd|shell|timezone|filesystem|workspace_roots|permission_profile)\b/i.test(body) ? '' : block)
    .replace(/<image\s+name=\[([^\]\r\n]{1,80})\]\s+path="[^"\r\n]{1,2048}">\s*<\/image>/gi, (_match, name: string) => `[${name} attached]`)
    .trim()
}

/**
 * Claude Code tells the model a background task ended with a `<task-notification>` it adds to the
 * conversation as a user message. It is the agent's own bookkeeping, not something the person wrote:
 * it is shown as a note and never names the conversation.
 */
export function taskNotification(text: string): { status: string; summary: string } | null {
  if (!/^\s*<task-notification>[\s\S]*<\/task-notification>\s*$/i.test(text)) return null
  const field = (name: string) => new RegExp(String.raw`<${name}>([\s\S]*?)</${name}>`, 'i').exec(text)?.[1]?.replace(/\s+/g, ' ').trim() ?? ''
  return { status: field('status') || 'finished', summary: field('summary') }
}
