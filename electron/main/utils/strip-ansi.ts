/**
 * Strips ANSI escape sequences from CLI output so it can be shown or searched as plain text. Covers the most
 * common SGR (color) + control sequences; good enough for `gh run view --log`, which uses standard escapes.
 *
 * Kept apart from the GitHub parsers: the MCP read tools, which load with the main entry, need only this.
 */
export function stripAnsi(text: string): string {
  // CSI (Control Sequence Introducer) — `\x1b[ ... letter` (most colors/cursors)
  // OSC (Operating System Command) — `\x1b] ... BEL` or `\x1b] ... ST`
  // Other Fe escapes (single-byte after ESC)
  return text
    .replace(/\x1B\[[\x3C-\x3F]*[\d;]*[\x20-\x2F]*[\x40-\x7E]/g, '')
    .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '')
    .replace(/\x1B[@-_]/g, '')
}
