/**
 * SECURITY S3 (F4, A60): a branch name that reaches gh, az or git as an argument. Follows git check-ref-format for a
 * branch, so nothing that could be read as an option, a revision expression or a path trick gets through.
 */
const FORBIDDEN_CHARACTERS = new Set([' ', '~', '^', ':', '?', '*', '[', '\\'])

export function isSafeBranchName(name: string): boolean {
  if (typeof name !== 'string' || name.length === 0 || name.length > 255) return false
  if (name === '@' || name.startsWith('-')) return false
  if (name.includes('..') || name.includes('@{') || name.includes('//')) return false
  for (const character of name) {
    const code = character.charCodeAt(0)
    if (code < 0x20 || code === 0x7f || FORBIDDEN_CHARACTERS.has(character)) return false
  }
  if (name.startsWith('/') || name.endsWith('/') || name.endsWith('.')) return false
  for (const segment of name.split('/')) {
    if (segment.startsWith('.') || segment.endsWith('.lock')) return false
  }
  return true
}
