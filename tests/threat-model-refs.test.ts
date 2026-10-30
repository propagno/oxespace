import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..')

describe('threat model', () => {
  const text = readFileSync(join(root, 'docs', 'security', 'threat-model-owasp-agentic-1.4.md'), 'utf8')

  it('names every file it points to in code font, and each exists', () => {
    const paths = [...text.matchAll(/`((?:electron|shared|src|tests|docs)\/[\w./-]+\.(?:ts|tsx|md|json))`/g)].map(match => match[1])
    expect(paths.length).toBeGreaterThan(25)
    expect(paths.filter(path => !existsSync(join(root, path)))).toEqual([])
  })

  it('covers ASI01 to ASI10', () => {
    for (let n = 1; n <= 10; n++) expect(text).toContain(`## ASI${String(n).padStart(2, '0')} `)
  })
})
