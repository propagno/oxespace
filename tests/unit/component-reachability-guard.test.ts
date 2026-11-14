import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.css']

/**
 * Modules intentionally kept unmounted from `src/main.tsx`:
 * - `src/components/OxePod/*`: frozen F2 contract (`tests/acceptance/f2/r15-oxepod-mode-removed.test.tsx`)
 *   explicitly forbids importing `src/components/OxePod/` outside that folder.
 * - `approvalsMock.ts`, `Threads/side/*`: standalone unit/integration test subjects.
 * - The conversation's Terminal and Pull request tabs and its background shell list left the UI in 1.5.2 (product
 *   owner, 13/11); frozen tests still render these components alone (f4/u44, f4/u46, f4/crf4-d, f6/u64), so they stay
 *   until those tests are released with them.
 */
const ALLOWED_UNMOUNTED_PREFIXES = ['src/components/OxePod/', 'src/components/Threads/side/']
const ALLOWED_UNMOUNTED_FILES = new Set([
  'src/components/Approvals/approvalsMock.ts',
  'src/components/Threads/PullRequestTab.tsx',
  'src/components/Threads/pullRequestModel.ts',
  'src/components/Threads/ThreadTerminalTab.tsx',
  'src/components/Threads/ThreadBackgroundShells.tsx'
])

function walk(dir: string, predicate: (fullPath: string) => boolean): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) results.push(...walk(full, predicate))
    else if (predicate(full)) results.push(full)
  }
  return results
}

function resolveImport(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  const candidate = resolve(dirname(fromFile), specifier)
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  for (const ext of EXTENSIONS) {
    if (existsSync(candidate + ext) && statSync(candidate + ext).isFile()) return candidate + ext
  }
  for (const ext of EXTENSIONS) {
    const indexPath = join(candidate, `index${ext}`)
    if (existsSync(indexPath) && statSync(indexPath).isFile()) return indexPath
  }
  return null
}

describe('G14 · component reachability guard', () => {
  it('reaches every production module in src/components/** from src/main.tsx', () => {
    const visited = new Set<string>()
    const queue: string[] = [join(SRC, 'main.tsx')]

    while (queue.length > 0) {
      const current = queue.pop()
      if (!current || visited.has(current)) continue
      visited.add(current)
      if (!/\.(ts|tsx|js|jsx)$/.test(current)) continue

      const source = readFileSync(current, 'utf8')
      const specifiers = new Set<string>()
      for (const match of source.matchAll(/(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g)) {
        specifiers.add(match[1])
      }
      for (const match of source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        specifiers.add(match[1])
      }
      for (const spec of specifiers) {
        const resolved = resolveImport(current, spec)
        if (resolved && !visited.has(resolved)) queue.push(resolved)
      }
    }

    const componentModules = walk(
      join(SRC, 'components'),
      file => /\.(ts|tsx)$/.test(file) && !file.endsWith('.d.ts') && !/\.test\.tsx?$/.test(file)
    )

    const unreachable = componentModules
      .filter(file => !visited.has(file))
      .map(file => relative(ROOT, file).replace(/\\/g, '/'))
      .filter(rel => !ALLOWED_UNMOUNTED_FILES.has(rel) && !ALLOWED_UNMOUNTED_PREFIXES.some(prefix => rel.startsWith(prefix)))
      .sort()

    expect(unreachable).toEqual([])
  })
})
