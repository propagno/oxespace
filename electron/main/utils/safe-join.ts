import { isAbsolute, normalize, resolve, sep } from 'node:path'

export function safeJoin(rootPath: string, ...segments: string[]): string {
  const root = resolve(rootPath)
  const target = resolve(root, ...segments)

  if (!isInsideRoot(root, target)) {
    throw new Error('Path escapes workspace root')
  }

  return normalize(target)
}

function isInsideRoot(root: string, target: string): boolean {
  const normalizedRoot = normalize(root)
  const normalizedTarget = normalize(target)
  const rootWithSeparator = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`

  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(rootWithSeparator)
}
