/**
 * The first `<placeholder>` left in an MCP server's arguments (for example `<postgres-url>`, `<secret>`), or null. A
 * server started with one fails at run time, so the form refuses it. A placeholder has no space inside the brackets,
 * which keeps shell redirections and comparisons (`a < b > c`) out (OXE-356).
 */
export function firstArgPlaceholder(argsText: string): string | null {
  return /<[^<>\s]+>/.exec(argsText)?.[0] ?? null
}
