/** Keep provider-generated context and attachment paths out of imported chat text.
 * This also runs when rendering older imports, whose events were saved verbatim. */
export function formatNativeUserText(text: string): string {
  return text
    .replace(/<environment_context>([\s\S]*?)<\/environment_context>\s*/gi, (block, body: string) =>
      /<(?:current_date|cwd|shell|timezone|filesystem|workspace_roots|permission_profile)\b/i.test(body) ? '' : block)
    .replace(/<image\s+name=\[([^\]\r\n]{1,80})\]\s+path="[^"\r\n]{1,2048}">\s*<\/image>/gi, (_match, name: string) => `[${name} attached]`)
    .trim()
}
