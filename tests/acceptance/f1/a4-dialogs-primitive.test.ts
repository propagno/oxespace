// Frozen acceptance test for 1.5.0 A4 (U5a/U5b/U5c, OXE phase F1). The executor must not edit it.
// Every <Dialog> keeps the primitive's box: no className restyling anywhere under src/, and every Dialog has a size.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'

const ROOT = join(__dirname, '..', '..', '..')
const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? walk(path) : path.endsWith('.tsx') ? [path] : []
})
const files = walk(join(ROOT, 'src')).filter(path => !path.includes(`${join('src', 'ui')}`))

/** The attributes of each <Dialog …> tag, read to its end and skipping what is inside braces (same reader as design-lint U1). */
function dialogTags(source: string): string[] {
  return [...source.matchAll(/<Dialog\b/g)].map(match => {
    let depth = 0, quote: string | null = null, attributes = ''
    for (let index = (match.index ?? 0) + '<Dialog'.length; index < source.length; index++) {
      const char = source[index]
      if (quote) { if (char === quote && source[index - 1] !== '\\') quote = null; continue }
      if (char === '"' || char === "'" || char === '`') { quote = char; continue }
      if (char === '{') depth++
      else if (char === '}') depth--
      else if (char === '>' && depth === 0) break
      else if (depth === 0) attributes += char
    }
    return attributes
  })
}

describe('A4 · every dialog is the U1 primitive', () => {
  test('no <Dialog> under src/ is restyled with className (ratchet reaches 0)', () => {
    const restyled = files.filter(path => dialogTags(readFileSync(path, 'utf8')).some(attrs => /\sclassName=/.test(attrs)))
    expect(restyled.map(path => relative(ROOT, path))).toEqual([])
  })

  test('every file that renders <Dialog> takes it from ui/Dialog (the src/ui barrel), never a local copy', () => {
    const local = files.filter(path => {
      const source = readFileSync(path, 'utf8')
      return /<Dialog\b/.test(source) && !/import\s*\{[^}]*\bDialog\b[^}]*\}\s*from\s*['"][./]*ui['"]/.test(source)
    })
    expect(local.map(path => relative(ROOT, path))).toEqual([])
  })

  test('every <Dialog> under src/ declares its size', () => {
    const unsized = files.filter(path => dialogTags(readFileSync(path, 'utf8')).some(attrs => !/\ssize=/.test(attrs)))
    expect(unsized.map(path => relative(ROOT, path))).toEqual([])
  })

  test('the OxeQuery scoped dialog overrides are gone (U5b)', () => {
    const css = walk(join(ROOT, 'src', 'components', 'OxeQuery')).length >= 0
      ? readdirSync(join(ROOT, 'src', 'components', 'OxeQuery')).filter(name => name.endsWith('.css'))
        .map(name => readFileSync(join(ROOT, 'src', 'components', 'OxeQuery', name), 'utf8')).join('\n')
      : ''
    expect(css).not.toMatch(/\.oq-scope[^{]*\[role=["']?dialog/)
  })
})
