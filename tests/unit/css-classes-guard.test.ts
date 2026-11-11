import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

function walk(dir: string, predicate: (fullPath: string) => boolean): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) results.push(...walk(full, predicate))
    else if (predicate(full)) results.push(full)
  }
  return results
}

describe('G14 · static CSS class guard', () => {
  it('defines every literal className token in src/components/**/*.tsx in at least one CSS stylesheet', () => {
    const cssFiles = walk(SRC, file => file.endsWith('.css') && !file.endsWith('.module.css'))
    const definedClasses = new Set<string>()
    for (const file of cssFiles) {
      const stripped = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      for (const match of stripped.matchAll(/\.([a-zA-Z_-][a-zA-Z0-9_-]*)/g)) {
        definedClasses.add(match[1])
      }
    }

    const tsxFiles = walk(join(SRC, 'components'), file => file.endsWith('.tsx'))
    const missing: string[] = []
    for (const file of tsxFiles) {
      const source = readFileSync(file, 'utf8')
      const rel = relative(ROOT, file).replace(/\\/g, '/')
      const fileMissing = new Set<string>()
      for (const match of source.matchAll(/className\s*=\s*"([^"]+)"/g)) {
        for (const token of match[1].trim().split(/\s+/)) {
          if (token && !definedClasses.has(token)) fileMissing.add(token)
        }
      }
      if (fileMissing.size > 0) {
        missing.push(`${rel}: ${[...fileMissing].sort().join(', ')}`)
      }
    }

    expect(missing.sort()).toEqual([])
  })
})
